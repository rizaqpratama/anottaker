# NERTator

NERTator is a local-first toolkit for creating and maintaining named-entity recognition (NER) training datasets: import text records, define entity labels, annotate manually or with AI assistance, review work, and export JSONL training data.

Dataset text and annotations stay on the local machine unless you explicitly ask an AI provider for suggestions.

This is an npm-workspaces monorepo with three packages:

| Package | What it is |
| --- | --- |
| [`desktop/`](desktop) | The original Electron + React desktop app. Projects are portable SQLite files with the `.nerdb` extension. |
| [`mobile/`](mobile) | An Expo/React Native app offering the same core workflow on a phone — import, label, annotate, get AI suggestions, review, export — minus desktop's local coding-agent AI provider, which needs a spawned CLI subprocess that doesn't exist on mobile. |
| [`shared/`](shared) (`@nertator/shared`) | Logic shared by both apps: types, span validation, JSONL export/import, the NER prompt and suggestion-validation logic, and pricing. |

## Requirements

- Node.js 20 or later
- npm
- For desktop: a supported desktop platform for Electron
- For mobile: the [Expo Go](https://expo.dev/go) app or a simulator/emulator
- An OpenAI API key or a Google AI Studio Gemini API key for optional AI assistance

## Getting started

Install once at the repo root — this installs and links all three workspaces:

```bash
npm install
```

### Desktop

```bash
npm run dev
```

Builds `shared`, then starts Vite and Electron together.

```bash
npm run build   # production build (renderer + Electron main files)
npm test        # runs shared's and desktop's test suites
```

See [`desktop/`](desktop) for the app itself. `better-sqlite3` must be built against Electron's Node ABI — if Electron reports `ERR_DLOPEN_FAILED` or a module-version mismatch, run `npm run rebuild:native` and restart.

### Mobile

```bash
npm run dev:mobile
```

Builds `shared`, then runs `expo start`. Scan the QR code with Expo Go, or press `i`/`a` for a simulator. See [`mobile/README.md`](mobile/README.md) for setup details and current limitations.

## Workflow

1. Create a project (desktop: create or open a `.nerdb` file; mobile: name a new on-device project).
2. Add labels in **Manage labels**. A label has a name, description, and color.
3. Import documents from a `.txt`, `.csv`, or `.jsonl` file.
4. Select text and apply a label, or use **Suggest entities** for AI assistance.
5. Review records and mark them reviewed when complete.
6. Export reviewed (or all) records as JSONL.

## Import formats

| Format | Behavior |
| --- | --- |
| `.txt` | Each non-empty line becomes one document. |
| `.csv` | The first column of each data row becomes one document; the first row is treated as a header. |
| `.jsonl` | Each line must be valid JSON with a non-empty `text` string. |

## Export format

Export produces one JSON object per line:

```json
{"text":"Jalan Cibogo, Purwakarta","entities":[{"start":0,"end":13,"label":"ADDRESS"}]}
```

Entity offsets are zero-based and end-exclusive.

## AI assistance

Both apps let you choose a provider, enter its API key, select a model, and add custom annotation instructions appended to a shared base prompt that requires exact source-text spans, uses only defined labels, and requests at most one highest-confidence candidate per label.

- **OpenAI** and **Google Gemini** are supported on both desktop and mobile.
- Desktop additionally supports routing requests through a **local coding agent** (Codex, Claude Code, Cursor Agent, OpenCode, or Google Antigravity) already installed and authenticated on your machine, instead of a hosted API — this only makes sense on desktop, since it spawns a CLI subprocess.
- Suggestions are ephemeral until accepted; accepting one writes a normal entity row.
- API keys are encrypted at rest (Electron `safeStorage` on desktop, the device keychain via `expo-secure-store` on mobile) and never written to project data.

### Pricing estimates

Both apps estimate request cost from reported token usage against a shared per-model pricing table (`shared/data/pricing.csv`). Pricing is matched by exact model name; a model missing from the table shows **Cost unavailable**.

## Architecture

```text
                     shared/  (types, validation, prompt, pricing)
                        |
      ------------------------------------
      |                                  |
   desktop/                           mobile/
React renderer                    React Native screens
  -> Electron preload bridge         -> expo-sqlite
  -> Electron main                   -> expo-secure-store
     -> SQLite (.nerdb)              -> direct fetch() to
     -> LangChain / local agent         OpenAI or Gemini
```

See [`CLAUDE.md`](CLAUDE.md) for the full architecture writeup, including exactly what's shared between the two apps and what's deliberately platform-specific.

## Security and privacy

- Desktop's `.nerdb` files and mobile's on-device SQLite database contain local project data and annotations.
- An AI request sends only the currently open document, its label schema, and your custom instructions to the selected provider.
- Requests occur only after you tap/click **Suggest entities**.
- API keys are encrypted with the operating system's (or device's) secure storage.
