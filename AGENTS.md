# NERTator agent guide

## Project overview

NERTator is a local-first app for NER dataset annotation, structured as an npm-workspaces monorepo:

- `desktop/` — Electron + React desktop app (the original app; portable `.nerdb` SQLite files).
- `mobile/` — Expo/React Native app scaffold, same core workflow minus the desktop-only local coding-agent AI provider.
- `shared/` (`@nertator/shared`) — types, span validation, JSONL export/import, NER prompt + suggestion validation, pricing. Built once (`tsc` to CommonJS) and consumed by both apps.

## Important commands

```bash
npm install               # workspace-wide install
npm run dev                # shared build + desktop dev (Vite + Electron)
npm run dev:mobile          # shared build + `expo start`
npm run build                 # shared build + desktop build
npm run build:mobile           # shared build + mobile build
npm test                        # runs each workspace's tests
npm run rebuild:native           # electron-rebuild, scoped to desktop
```

`shared/` must be built before `desktop`/`mobile` can resolve `@nertator/shared` — the root `dev`/`build` scripts handle this; running a workspace's own script directly does not. `better-sqlite3` is compiled for Electron, so do not use plain Node database scripts unless the native module has been rebuilt for Node. Use `npm run rebuild:native` when Electron reports an ABI or `ERR_DLOPEN_FAILED` error.

## Architecture boundaries

```text
shared/ (types, validation, prompt, pricing — no platform APIs)
  -> desktop: React renderer -> preload bridge -> Electron main -> SQLite / AI providers
  -> mobile:  React Native screens -> expo-sqlite / expo-secure-store / direct-fetch AI calls
```

- Keep `contextIsolation: true` and `nodeIntegration: false` in desktop.
- Expose only narrow, explicit IPC functions through `desktop/electron/preload.cjs`.
- Add matching typings to `desktop/src/vite-env.d.ts` for every new preload function.
- Implement persistence and privileged work in the main process (desktop) or platform module (mobile), not directly in UI components.
- API keys must never enter React/React-Native component state beyond the input field itself, never reach project databases, logs, or IPC responses. Desktop encrypts them with Electron `safeStorage`; mobile uses `expo-secure-store`.
- Don't add code to `shared/` that pulls in platform-specific APIs (Node `fs`, Electron modules, RN/Expo modules). If a function needs a platform API, it doesn't belong in `shared/` — see CLAUDE.md's "sharing boundaries" section for the exact list of what's shared vs. platform-specific.
- `shared/src/index.ts`'s barrel must use explicit named re-exports (`export { x } from './y'`), not `export * from './y'` — the latter breaks desktop's production Vite build (see CLAUDE.md for why).

## AI changes

- Keep the shared NER system prompt, JSON schema, and suggestion-validation logic centralized in `shared/src/ai/` — both platforms must use the same prompt contract and validation rules.
- User custom instructions are appended to the base prompt; do not allow them to bypass span validation.
- Always validate returned label names, source-text offsets, exact text matches, overlaps, and duplicate labels before suggestions reach the UI (`validateSuggestions` in `shared/src/ai/validate.ts` — don't reimplement this per platform).
- AI suggestions are ephemeral until accepted; accepted suggestions become normal SQLite entity spans.
- Maintain a timeout and clear user-facing error state for provider calls, on both platforms.
- Desktop's terminal request logs may contain document text but must never contain API keys.
- Mobile has no local coding-agent provider and never will — it needs a spawned CLI subprocess, which doesn't exist on a phone. Don't add UI for it in `mobile/`.

## Data and performance

- Preserve the paginated queue on both platforms: project snapshots load a small document batch (`pageSize = 100`) and entity spans are fetched for the selected record only.
- Do not add code that loads an entire project dataset into memory — the one sanctioned exception is mobile's `getAllDocumentsWithEntities()` in `ProjectStore.ts`, used only for JSONL export on mobile's expected phone-scale single-project dataset. Don't extend that exception elsewhere.
- Preserve character-offset semantics: zero-based, end-exclusive spans, on both platforms.
- Label edits must retain the label ID so existing entity rows remain valid.
- Desktop and mobile's SQLite bindings (`better-sqlite3`, `expo-sqlite`) are separate, hand-written implementations — keep their table shapes in sync with `shared/src/db/schema.ts`'s documented contract, but don't try to unify the binding code itself.

## UI conventions

- Maintain the dark NERTator styling in `desktop/src/styles.css` (desktop) and `mobile/src/theme.ts` (mobile) — these are intentionally separate, hand-rolled per platform; there's no shared design-system package.
- Use visible button styles for interactive controls; avoid text-only actions that look like labels.
- Keep document navigation controls in normal layout flow so they do not overlap the review control.
- When a desktop main/preload file changes, restart Electron; Vite hot reload does not reload Electron main-process code.
- Mobile has no navigation library by design (matches desktop's own router-less style) — don't add `expo-router`/React Navigation without a real need driven by screen count growth.

## Validation checklist

Before handing off changes:

1. Run `npm run build` (desktop) and/or `npm run build:mobile` depending on what you touched.
2. If you touched `shared/`, rebuild it first and confirm both `desktop` and `mobile` still typecheck (`npx tsc -b` / `npx tsc --noEmit` in each).
3. Verify every new desktop IPC method exists in main, preload, and `vite-env.d.ts`.
4. Verify AI changes with a non-secret local smoke test where practical, on whichever platform(s) you touched.
5. For SQLite changes, verify in Electron if the local `better-sqlite3` binary targets Electron; for mobile, verify against `expo-sqlite`'s actual API surface (check installed type declarations — don't assume an API shape from memory).
6. Do not discard unrelated uncommitted work.
