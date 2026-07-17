# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

NERTator is a local-first Electron desktop app for building named-entity recognition (NER) training datasets: import text, define labels, annotate manually or with AI assistance, review, and export JSONL. Projects are portable SQLite files (`.nerdb`). Dataset text never leaves the machine unless the user explicitly requests AI suggestions.

## Commands

```bash
npm install          # also runs postinstall -> rebuild:native
npm run dev           # Vite dev server + Electron together (concurrently)
npm run build          # tsc -b && vite build && scripts/build-electron.mjs
npm test               # vitest run (all tests, single pass)
npm run rebuild:native # electron-rebuild -f -w better-sqlite3
```

- Single test file: `npx vitest run src/shared.test.ts` or `npx vitest run electron/local-agent.test.ts`
- Single test by name: `npx vitest run -t "name of test"`
- Watch mode: `npx vitest` (no `run`)
- No lint/format tooling is configured in this repo.
- After changing `electron/main.cjs` or `electron/preload.cjs`, restart Electron — Vite hot reload only covers the renderer, not the Electron main process.
- If Electron reports `ERR_DLOPEN_FAILED` or a native-module ABI mismatch, run `npm run rebuild:native` and restart. `better-sqlite3` must be compiled against Electron's Node ABI, not the system Node ABI — don't debug the database with plain `node` scripts unless you've rebuilt for Node first.

## Architecture

```text
React renderer (src/main.tsx)
  -> contextBridge preload (electron/preload.cjs)     [window.ner API]
  -> Electron main (electron/main.cjs)                 [ipcMain.handle registry]
      -> SQLite project database (electron/database.cjs, .nerdb via better-sqlite3)
      -> AI dispatch (electron/ai.cjs)
          -> OpenAI / Gemini via LangChain structured output
          -> local coding agent via electron/local-agent.cjs -> electron/acp-agent.cjs
```

### Process boundary is the security boundary

- `contextIsolation: true`, `nodeIntegration: false` — do not weaken these.
- The renderer only ever talks to `window.ner`, the narrow surface `electron/preload.cjs` exposes via `contextBridge`. There is no direct IPC access from renderer code.
- Every preload method needs three matching pieces: the `ipcMain.handle('channel:name', ...)` in `main.cjs`, the exposed wrapper in `preload.cjs`, and a matching type entry in `src/vite-env.d.ts` (the `Window.ner` interface). Adding one without the others breaks the type contract or breaks the app.
- API keys (OpenAI, Gemini) are encrypted at rest with Electron `safeStorage` in `main.cjs` settings (`app.getPath('userData')/settings.json`, mode `0o600`). They must never reach React state, project databases, IPC responses, or logs. Only `electron/ai.cjs` decrypts them, immediately before a provider call.
- `electron/ai.cjs` logs full AI request/response payloads (including document text) to the terminal for debugging — this is intentional, but API keys must never appear in those logs.

### Renderer

`src/main.tsx` is a single-file React app (no router, no state library) containing `App` plus a handful of local components (document queue, editor, label manager, AI sidebar, `Settings` panel). `src/shared.ts` holds types shared conceptually with the main process (`Project`, `DatasetDocument`, `Label`, `EntitySpan`, `AiSuggestion`) plus pure helpers: `validateSpan`, `toJsonl`, `parseImports`. `src/styles.css` is the app's dark theme — preserve it when touching UI.

Because Electron's main process runs plain CommonJS (`.cjs`, no bundler) and cannot import from `src/`'s TypeScript/ESM, span-validation and JSONL/import logic is intentionally re-implemented in `electron/database.cjs` / `electron/ai.cjs` rather than shared at runtime. When changing semantics like span validity or JSONL shape, update both sides (`src/shared.ts` and the corresponding electron file) and keep their tests (`src/shared.test.ts`, `electron/local-agent.test.ts`) in sync.

### Data model (`electron/database.cjs`)

SQLite tables: `project`, `labels`, `documents`, `entities` (WAL mode). The document queue is paginated at the database layer — `snapshot(page, pageSize)` in `main.cjs` uses `pageSize = 100` and only loads one page of documents into memory; entity spans for a single document are fetched on demand via `getDocument(id)`. Never add code that loads an entire project's documents into renderer memory — this is a deliberate scalability constraint for large datasets.

Entity spans are zero-based, end-exclusive character offsets into document text (`validateSpan` enforces in-bounds, non-overlapping spans). Label edits preserve the label `id` so existing `entities.label_id` rows stay valid; deleting a label in use is rejected until its entities are removed.

### AI suggestion pipeline (`electron/ai.cjs`)

Three provider paths, selected by `settings.provider` (`openai` | `gemini` | `local-agent`):

- **OpenAI / Gemini**: LangChain `ChatOpenAI` / `ChatGoogleGenerativeAI` with `withStructuredOutput` against a strict Zod schema (`nerResponseSchema`). Token usage and per-model cost estimates come from `data/pricing.csv` (exact model-name match; unmatched models show "Cost unavailable").
- **Local coding agent**: routes through `electron/local-agent.cjs`, which dispatches by agent profile (`AGENT_PROFILES` — codex, claude, agy, cursor, opencode):
  - `codex`, `claude`, `opencode` are ACP (Agent Client Protocol) agents (`electron/acp-agent.cjs`): a persistent child process per agent is spawned once and reused (`runtimes` map), keeping a warm session across requests for latency. Requests to the same agent are serialized through a per-runtime promise queue. `codex`/`claude` run via bundled npm packages (`@agentclientprotocol/codex-acp`, `@agentclientprotocol/claude-agent-acp`) invoked with `ELECTRON_RUN_AS_NODE=1` so Electron's binary runs them as plain Node; `opencode` uses its own native `acp` subcommand.
  - `agy`, `cursor` are one-shot CLI agents invoked directly per request in a throwaway temp workspace (no session reuse); their transport quirks (e.g. Agy's stdin-vs-argument prompt handling by version, Cursor's binary-identity check) are handled in `buildAgentCommand` / `agyPromptTransportForVersion` / `isCursorAgentHelp`.
  - All local-agent prompts explicitly instruct the agent this is a one-shot data task ("do not plan, inspect your environment, call tools, read files, or modify files") since these are general coding agents being repurposed for structured extraction, not sandboxed NER models.
  - Local-agent responses are free-form text; `parseAgentResponse`/`findEntities`/`jsonCandidates` in `local-agent.cjs` extract the first valid `{"entities": [...]}` JSON object from plain, fenced, or nested/stringified output.

Regardless of provider, all returned suggestions pass through `validateSuggestions` in `ai.cjs` before reaching the renderer: label names must match a defined label (case-insensitive), spans must exactly match `sourceText.slice(start, end)` (falling back to nearest-occurrence matching via `closestTextOffset` if the provider's offset is off), overlaps are rejected, and only the highest-confidence suggestion per label is kept. Suggestions are ephemeral until the user accepts them in the renderer — only accepted suggestions become real `entities` rows.

### Build/packaging

`electron/*.cjs` are hand-written CommonJS and are not bundled — `npm run build` runs `tsc -b && vite build` (renderer only) then `scripts/build-electron.mjs`, which just copies the `electron/*.cjs` files and `data/` verbatim into `dist-electron/`. If you add a new `electron/*.cjs` file, add it to `scripts/build-electron.mjs`'s copy list or it won't ship in production builds.
