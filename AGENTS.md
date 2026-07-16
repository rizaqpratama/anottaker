# NERTator agent guide

## Project overview

NERTator is a local-first Electron desktop application for NER dataset annotation.

- Renderer: React + TypeScript + Vite in `src/`
- Desktop/main process: Electron CommonJS in `electron/`
- Project data: portable SQLite `.nerdb` files through `better-sqlite3`
- AI: LangChain, OpenAI, and Google Gemini in `electron/ai.cjs`
- Pricing: local model table in `data/pricing.csv`

## Important commands

```bash
npm run dev
npm run build
npm test
npm run rebuild:native
```

Run `npm run build` after application changes. `better-sqlite3` is compiled for Electron, so do not use plain Node database scripts unless the native module has been rebuilt for Node. Use `npm run rebuild:native` when Electron reports an ABI or `ERR_DLOPEN_FAILED` error.

## Architecture boundaries

```text
React renderer -> preload bridge -> Electron main -> SQLite / AI providers
```

- Keep `contextIsolation: true` and `nodeIntegration: false`.
- Expose only narrow, explicit IPC functions through `electron/preload.cjs`.
- Add matching typings to `src/vite-env.d.ts` for every new preload function.
- Implement persistence and privileged work in the main process, not the renderer.
- API keys must never enter React state, project databases, logs, or IPC responses. Encrypt them with Electron `safeStorage` in main-process settings.

## AI changes

- Keep provider requests in `electron/ai.cjs` and use LangChain integrations.
- Keep the shared structured-output schema and base NER prompt centralized there.
- User custom instructions are appended to the base prompt; do not allow them to bypass span validation.
- Always validate returned label names, source-text offsets, exact text matches, overlaps, and duplicate labels before suggestions reach the renderer.
- AI suggestions are ephemeral until accepted; accepted suggestions become normal SQLite entity spans.
- Maintain a timeout and clear user-facing error state for provider calls.
- Terminal request logs may contain document text but must never contain API keys.

## Data and performance

- Preserve the paginated queue: project snapshots load a small document batch and entity spans are fetched for the selected record.
- Do not add code that loads an entire project dataset into renderer memory.
- Keep export streaming where possible.
- Preserve character-offset semantics: zero-based, end-exclusive spans.
- Label edits must retain the label ID so existing entity rows remain valid.

## UI conventions

- Maintain the dark NERTator styling in `src/styles.css`.
- Use visible button styles for interactive controls; avoid text-only actions that look like labels.
- Keep document navigation controls in normal layout flow so they do not overlap the review control.
- When a main/preload file changes, restart Electron; Vite hot reload does not reload Electron main-process code.

## Validation checklist

Before handing off changes:

1. Run `npm run build`.
2. Verify every new IPC method exists in main, preload, and `vite-env.d.ts`.
3. Verify AI changes with a non-secret local smoke test where practical.
4. For SQLite changes, verify in Electron if the local `better-sqlite3` binary targets Electron.
5. Do not discard unrelated uncommitted work.
