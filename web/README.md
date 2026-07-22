# NERTator (web app)

The web app version of NERTator: the same UI and annotation logic as the Electron
desktop app, running as a local Node/Express server with SQLite storage instead of
an Electron shell. Run it on your own machine and open it in any browser.

Projects, settings, and encrypted cloud-provider API keys all live under
`~/.nertator/` on the machine running the server — nothing leaves your device
except a request to the AI provider or local coding agent you select after you
explicitly click **Suggest entities**.

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts the Express API server and the Vite dev server together; open
the printed Vite URL (`http://localhost:5174`) in a browser.

For a single-port production build:

```bash
npm run build
npm start
```

`npm start` serves both the built frontend and the API from one port (`PORT`,
default `4001`).

## What's different from the desktop app

Everything else — labels, manual and AI-assisted annotation, keyboard shortcuts,
case-insensitive paginated document search, draft/review workflow, JSONL export
format, and the local coding-agent AI provider
— behaves identically. Only what genuinely requires a native OS dialog changed:

- **Create project**: still just a name; the server places the `.nerdb` file under
  a managed `~/.nertator/projects/` folder instead of a native "save as" dialog.
- **Open project**: use your browser's native file picker to upload a `.nerdb`
  file (from this app or the desktop app) instead of a native "open" dialog.
- **Import documents / Export dataset**: use the browser's native file picker to
  upload `.txt`/`.csv`/`.jsonl`, and a normal browser download for the exported
  `.jsonl` — no native dialogs needed for these one-shot transfers.

## AI providers and local agents

Choose OpenAI, Google Gemini, or a local coding agent in **AI settings**. OpenAI
and Gemini keys are encrypted at rest. The local-agent option uses an already
authenticated local CLI and stores no provider key in NERTator.

Supported local agents are Codex, Claude Code, Google Antigravity, Cursor Agent,
and OpenCode. Codex, Claude Code, and OpenCode keep an ACP session until you use
**Clear agent context**; the next suggestion then starts a fresh session. Other
agents run a one-shot annotation request in an empty temporary workspace.

Suggestions remain ephemeral until accepted. Every response is validated against
the original text for label names, exact zero-based end-exclusive offsets,
overlaps, and duplicate labels before it can be applied.

## Architecture

```text
React renderer (identical to src/main.tsx in the desktop app)
  -> ner-bridge.ts (fetch + Server-Sent Events, replaces the Electron preload bridge)
  -> Express server (server/routes.cjs, replaces electron/main.cjs's IPC handlers)
      -> SQLite project database (server/database.cjs, copied from electron/database.cjs)
      -> AI service (server/ai.cjs + local-agent.cjs + acp-agent.cjs, copied from electron/)
          -> OpenAI, Google Gemini, or a local CLI coding agent
```

Cloud-provider API keys are encrypted at rest with a locally generated AES-256-GCM
key (`~/.nertator/secret.key`) and never leave the server process. Local-agent
requests use an empty temporary workspace, which is removed after a direct
one-shot request.
