# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

NERTator is a local-first app for building named-entity recognition (NER) training datasets: import text, define labels, annotate manually or with AI assistance, review, and export JSONL. This is an npm-workspaces monorepo with three packages:

- **`desktop/`** — the original Electron + React desktop app. Projects are portable SQLite files (`.nerdb`).
- **`mobile/`** — an Expo/React Native app scaffold offering the same core workflow on a phone, minus the desktop-only local coding-agent AI provider.
- **`shared/`** (`@nertator/shared`) — logic common to both: types, span validation, JSONL export/import, the NER prompt and suggestion-validation logic, and pricing.

Dataset text never leaves the device unless the user explicitly requests AI suggestions.

## Commands

```bash
npm install               # workspace-wide install; also runs desktop's postinstall -> rebuild:native
npm run dev                # builds shared, then runs desktop's Vite dev server + Electron together
npm run dev:mobile          # builds shared, then runs `expo start` for mobile
npm run build                # builds shared, then desktop (tsc -b && vite build && build-electron.mjs)
npm run build:mobile          # builds shared, then mobile
npm test                       # runs each workspace's test script (--workspaces --if-present)
npm run rebuild:native          # electron-rebuild -f -w better-sqlite3, scoped to desktop
```

- Single test file: `npx vitest run src/span.test.ts --dir shared` or, from within a workspace, `cd shared && npx vitest run src/span.test.ts`. Same pattern for `desktop` (e.g. `cd desktop && npx vitest run electron/local-agent.test.ts`).
- Single test by name: `npx vitest run -t "name of test"` (run from within the relevant workspace).
- Watch mode: `npx vitest` (no `run`), or `npm run dev --workspace=@nertator/shared` for a `tsc -b -w` watcher on the shared package specifically.
- No lint/format tooling is configured in this repo.
- **`shared/` must be built (`npm run build --workspace=@nertator/shared`) before `desktop` or `mobile` can resolve `@nertator/shared`** — both consume its compiled `dist/`, not its TypeScript source directly. The root `dev`/`build` scripts do this automatically; if you run a workspace script directly (`cd desktop && npm run dev`), build shared first or you'll get "Cannot find module" / stale-export errors.
- After changing `desktop/electron/main.cjs` or `desktop/electron/preload.cjs`, restart Electron — Vite hot reload only covers the renderer, not the Electron main process.
- If Electron reports `ERR_DLOPEN_FAILED` or a native-module ABI mismatch, run `npm run rebuild:native` and restart. `better-sqlite3` must be compiled against Electron's Node ABI, not the system Node ABI — don't debug the database with plain `node` scripts unless you've rebuilt for Node first.
- `desktop/vite.config.ts` sets `resolve.preserveSymlinks: true`. This is required, not cosmetic: npm workspaces links `@nertator/shared` via a symlink outside `desktop/`, and without `preserveSymlinks` Vite/Rollup resolve to the real path, stop treating it as a `node_modules` dependency, and silently fail to detect its named exports (`"X" is not exported by ".../shared/dist/index.js"`) in production builds. If you ever need to touch this setting, know why it's there first.

## Architecture

```text
                          shared/  (@nertator/shared — types, span validation,
                                    JSONL export/import, NER prompt + suggestion
                                    validation, pricing; built once to CommonJS,
                                    consumed by both apps below)
                             |
          -------------------------------------
          |                                    |
     desktop/                              mobile/
  React renderer (src/main.tsx)          Expo/React Native (App.tsx)
    -> contextBridge preload               -> src/db/ProjectStore.ts (expo-sqlite)
       (electron/preload.cjs)              -> src/ai/ (direct fetch to
    -> Electron main (electron/main.cjs)      OpenAI/Gemini REST APIs)
       -> SQLite (.nerdb, better-sqlite3)   -> expo-secure-store (API keys)
       -> AI dispatch (electron/ai.cjs)
          -> OpenAI/Gemini via LangChain
          -> local coding agent
             (electron/local-agent.cjs
              -> electron/acp-agent.cjs)
```

### Sharing boundaries — what's in `shared/` and what deliberately isn't

`shared/src/` (barrel-exported from `shared/src/index.ts`, all pure, no platform APIs):

- `types.ts` — `Project`, `Label`, `EntitySpan`, `DatasetDocument`, `AiSuggestion`, `DocumentStatus`.
- `id.ts` — `uid()`, with an **injectable generator** (`setIdGenerator`). Defaults to `crypto.randomUUID()` (fine under Node/Chromium); `mobile/src/id.ts` overrides it with `expo-crypto`'s synchronous `randomUUID()` at startup, since Hermes has no built-in `crypto.randomUUID()`. Don't hardcode `crypto.randomUUID()` anywhere new in `shared/` — use `uid()`.
- `span.ts`, `export.ts`, `import.ts` — `validateSpan`, `toJsonl`, `parseImports`.
- `ai/prompt.ts`, `ai/schema.ts`, `ai/validate.ts`, `ai/pricing.ts` — the NER system prompt, the Zod response schema, `validateSuggestions`/`closestTextOffset`, and `parsePricingCsv`/`estimateCost`/`loadPricingTable`. The pricing CSV is embedded as a string constant (`PRICING_CSV_CONTENT`) rather than read from disk, so mobile (no arbitrary filesystem access) can use it too; keep it in sync with `shared/data/pricing.csv` by hand if you edit pricing.
- `db/schema.ts` — **documentation-as-code, not a runtime dependency.** `PROJECT_SCHEMA_SQL` and the `ProjectDataStore` interface describe the four-table contract (`project`/`labels`/`documents`/`entities`) both platforms' data layers should honor. Desktop (`better-sqlite3`) and mobile (`expo-sqlite`) each implement their own binding against entirely different APIs — don't try to unify them into shared code.

**Deliberately desktop-only** (stays in `desktop/electron/`): the local coding-agent/ACP provider (`local-agent.cjs`, `acp-agent.cjs` — spawns CLI subprocesses, meaningless on mobile), LangChain client construction and key decryption (`providerModel`/`suggestEntities` in `ai.cjs`), the `better-sqlite3` binding, Electron `safeStorage`.

**Deliberately mobile-only** (stays in `mobile/src/`): the `expo-sqlite` binding, `expo-secure-store` key storage, the text-selection-via-`TextInput.onSelectionChange` annotation capture UI, and direct-`fetch()` OpenAI/Gemini REST calls (see "AI suggestion pipeline" below).

**Not shared, by design, on either side:** visual styling. `desktop/src/styles.css` (CSS) and `mobile/src/theme.ts`/RN `StyleSheet` are independent, hand-rolled per platform — there's no shared design-system package. The label color palette (`desktop/src/main.tsx`'s `colors` array, mirrored in `mobile/src/palette.ts`) is duplicated in two places on purpose for this reason; keep them in sync by hand if it changes.

**shared package build:** plain `tsc` to a single CommonJS output (`shared/dist/`, `main`/`types` fields), not a dual ESM/CJS tool. Electron's main process needs `require()`-able CJS with zero bundler; Vite and Metro both handle CJS-via-`import` from a workspace-linked package fine. Barrel re-exports in `shared/src/index.ts` must be **explicit named re-exports** (`export { x } from './y'`), not `export * from './y'` — `tsc`'s CJS output for `export *` compiles to a `for...in`-based `__exportStar` helper that Rollup's CJS interop can't statically analyze, which breaks desktop's production Vite build with "X is not exported by" errors even though it works fine under plain Node `require()`.

### Desktop: process boundary is the security boundary

- `contextIsolation: true`, `nodeIntegration: false` — do not weaken these.
- The renderer only ever talks to `window.ner`, the narrow surface `desktop/electron/preload.cjs` exposes via `contextBridge`. There is no direct IPC access from renderer code.
- Every preload method needs three matching pieces: the `ipcMain.handle('channel:name', ...)` in `main.cjs`, the exposed wrapper in `preload.cjs`, and a matching type entry in `desktop/src/vite-env.d.ts` (the `Window.ner` interface). Adding one without the others breaks the type contract or breaks the app.
- API keys (OpenAI, Gemini) are encrypted at rest with Electron `safeStorage` in `main.cjs` settings (`app.getPath('userData')/settings.json`, mode `0o600`). They must never reach React state, project databases, IPC responses, or logs. Only `desktop/electron/ai.cjs` decrypts them, immediately before a provider call. On mobile, the equivalent is `expo-secure-store` (`mobile/src/settings.ts`) — same rule: keys never enter component state beyond the input field, never get logged.
- `desktop/electron/ai.cjs` logs full AI request/response payloads (including document text) to the terminal for debugging — this is intentional, but API keys must never appear in those logs.

### Renderer / mobile app shape

`desktop/src/main.tsx` is a single-file React app (no router, no state library) containing `App` plus a handful of local components (document queue, editor, label manager, AI sidebar, `Settings` panel). `desktop/src/styles.css` is the app's dark theme — preserve it when touching UI.

`mobile/App.tsx` mirrors that same shape deliberately: one root component owning all state (project/doc/suggestions/busy/screen), with `Welcome`/`DocumentQueue`/`Annotator` as screens and `Labels`/`Settings` as RN `Modal` overlays — no navigation library, matching desktop's own router-less, minimal-dependency style. If mobile ever grows well past five screens, revisit that choice; don't add `expo-router`/React Navigation speculatively before then.

Desktop's manual annotation captures a DOM `Selection`/`Range` (`window.getSelection()`) and measures character offsets by cloning ranges — 100% web-only. Mobile's `Annotator` screen (`mobile/src/screens/Annotator.tsx`) replaces this with a read-only multiline `TextInput` in a toggled "select" mode; `onSelectionChange` gives native `{start, end}` character offsets directly, no DOM Range math needed. The two capture mechanisms are unrelated code, but both feed the same `validateSpan`/`EntitySpan` data model from `shared`.

### Data model

SQLite tables: `project`, `labels`, `documents`, `entities` (see `shared/src/db/schema.ts` for the canonical shape). Desktop's `database.cjs` runs WAL mode; the document queue is paginated at the database layer — `snapshot(page, pageSize)` uses `pageSize = 100` and only loads one page of documents into memory, with entity spans for a single document fetched on demand via `getDocument(id)`. **Never add code that loads an entire project's documents into renderer/component memory** — this is a deliberate scalability constraint for large datasets on desktop.

Mobile's `ProjectStore` (`mobile/src/db/ProjectStore.ts`) uses the same paginated `snapshot(page, pageSize)` shape for its normal document-queue view, but also has a `getAllDocumentsWithEntities()` method used **only** for JSONL export — mobile's single-project, phone-scale dataset is expected to be small enough to hold in memory for that one operation. Don't reuse that method for anything else, and don't add an equivalent "load everything" path to desktop's `database.cjs`.

Entity spans are zero-based, end-exclusive character offsets into document text (`validateSpan` in `shared/src/span.ts` enforces in-bounds, non-overlapping spans, used identically by both platforms). Label edits preserve the label `id` so existing `entities.label_id`/`entity.labelId` rows stay valid; deleting a label in use is rejected until its entities are removed.

### AI suggestion pipeline

**Desktop** (`desktop/electron/ai.cjs`), three provider paths selected by `settings.provider` (`openai` | `gemini` | `local-agent`):

- **OpenAI / Gemini**: LangChain `ChatOpenAI` / `ChatGoogleGenerativeAI` with `withStructuredOutput` against `nerResponseSchema` (from `@nertator/shared`). Token usage and per-model cost estimates come from `shared`'s pricing table, sourced from `desktop/data/pricing.csv` on disk when present, falling back to `shared`'s embedded copy.
- **Local coding agent** (desktop-only): routes through `desktop/electron/local-agent.cjs`, which dispatches by agent profile (`AGENT_PROFILES` — codex, claude, agy, cursor, opencode):
  - `codex`, `claude`, `opencode` are ACP (Agent Client Protocol) agents (`desktop/electron/acp-agent.cjs`): a persistent child process per agent is spawned once and reused (`runtimes` map), keeping a warm session across requests for latency. Requests to the same agent are serialized through a per-runtime promise queue. `codex`/`claude` run via bundled npm packages invoked with `ELECTRON_RUN_AS_NODE=1`; `opencode` uses its own native `acp` subcommand.
  - `agy`, `cursor` are one-shot CLI agents invoked directly per request in a throwaway temp workspace (no session reuse).
  - All local-agent prompts explicitly instruct the agent this is a one-shot data task ("do not plan, inspect your environment, call tools, read files, or modify files").
  - Local-agent responses are free-form text; `parseAgentResponse`/`findEntities`/`jsonCandidates` extract the first valid `{"entities": [...]}` JSON object from plain, fenced, or nested/stringified output.

**Mobile** (`mobile/src/ai/`), OpenAI/Gemini only:

- `mobile/src/ai/openai.ts` / `mobile/src/ai/gemini.ts` call the providers' REST APIs directly with `fetch()` — no LangChain — using a hand-rolled JSON Schema (`mobile/src/ai/schema.ts`) mirroring `shared`'s Zod `nerResponseSchema` for OpenAI's `response_format: json_schema` and Gemini's `generationConfig.responseSchema`. LangChain's Node-oriented SDK was judged too likely to hit Node-only APIs under Hermes/Metro to be worth the integration risk for a first pass; if you want to try it later, verify it actually works before committing to it.
- `mobile/src/ai/index.ts`'s `suggestEntities()` is the mobile equivalent of desktop's `suggestEntities` orchestrator — builds the prompt via `shared`'s `buildNerPrompt`/`buildSystemPrompt`, calls the selected provider, and computes cost the same way desktop does.

**Regardless of platform**, all returned suggestions pass through `validateSuggestions` (`shared/src/ai/validate.ts`) before reaching the UI: label names must match a defined label (case-insensitive), spans must exactly match `sourceText.slice(start, end)` (falling back to nearest-occurrence matching via `closestTextOffset` if the provider's offset is off), overlaps are rejected, and only the highest-confidence suggestion per label is kept. Suggestions are ephemeral until the user accepts them — only accepted suggestions become real `entities` rows.

### Build/packaging

`desktop/electron/*.cjs` are hand-written CommonJS and are not bundled — `desktop`'s `build` script runs `tsc -b && vite build` (renderer only) then `desktop/scripts/build-electron.mjs`, which copies the `electron/*.cjs` files verbatim into `dist-electron/`. If you add a new `electron/*.cjs` file, add it to `build-electron.mjs`'s copy list or it won't ship in production builds. The root `build` script builds `shared` first — `desktop`'s Electron main process `require()`s `@nertator/shared`'s compiled `dist/` at runtime, not source.

## Known gaps / things not yet verified

This monorepo split and the mobile scaffold were built and typechecked in a sandboxed environment without a GUI or simulator access, and without network access to Expo's own compatibility-check API (`expo install` couldn't be used; package versions were pinned by hand from the npm registry instead — double check them against the installed Expo SDK if you bump `expo`). Before relying on the mobile app: boot it in Expo Go or a simulator, exercise the annotation flow on a real device (confirm `TextInput.onSelectionChange` behaves as expected for offset capture), and confirm `expo-sqlite` pagination stays responsive at a realistic dataset size.
