# NERTator

NERTator is a local-first Electron desktop app for creating and maintaining named-entity recognition (NER) training datasets. Import text records, define entity labels, annotate manually or with AI assistance, review work, and export JSONL training data.

Projects are portable SQLite files with the `.nerdb` extension. Dataset text and annotations stay on the local machine unless you explicitly ask an AI provider for suggestions.

A web app version with the same UI and logic, running as a local Node/Express server instead of an Electron shell, is available in [`web/`](web/README.md).

## Features

- Portable `.nerdb` SQLite projects and recent-project list
- Import `.txt`, `.csv`, and `.jsonl` datasets
- Paginated document queue for large datasets; only the active batch is loaded
- Manual text selection and character-offset annotations
- Configurable labels with name, description, color, editing, and safe deletion
- Draft/review workflow, next-document navigation, and draft-record navigation
- Copy text, clear annotations, and delete records
- JSONL export with `text` and ordered character-offset entity spans
- AI suggestions through OpenAI or Google Gemini
- Per-provider model selection, custom annotation instructions, request logs, token usage, elapsed time, and local pricing estimates

## Requirements

- Node.js 20 or later
- npm
- A supported desktop platform for Electron
- An OpenAI API key or a Google AI Studio Gemini API key for optional AI assistance

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and Electron together.

To create production web and Electron build artifacts:

```bash
npm run build
```

Run the test suite with:

```bash
npm test
```

### Native SQLite module errors

`better-sqlite3` must be built against Electron's Node ABI. If Electron reports `ERR_DLOPEN_FAILED` or a module-version mismatch, rebuild it:

```bash
npm run rebuild:native
```

Then restart Electron.

## Workflow

1. Create a project or open an existing `.nerdb` file.
2. Add labels in **Manage labels**. A label has a name, description, and color.
3. Import documents from a supported source.
4. Select text and apply a label, or use **Suggest entities** in the AI sidebar.
5. Review records and mark them reviewed when complete.
6. Export reviewed records as JSONL.

The footer includes **Open next draft**, which opens the lowest-index draft record. Deleting a record advances to the next draft record and wraps to the earliest remaining draft when necessary.

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

Open **AI settings** to choose a provider, enter its API key, select a model, and add custom annotation instructions.

- **OpenAI** uses LangChain's OpenAI integration and can load models available to the saved OpenAI key.
- **Google Gemini** uses LangChain's Google Generative AI integration and provides supported Gemini model choices.
- API keys are encrypted using Electron `safeStorage`; they are not written to project databases or exposed to the renderer.
- Suggestions are ephemeral until accepted. **Apply all** adds all non-overlapping valid suggestions at once.
- The shared prompt requires exact source-text spans, uses only defined labels, and requests at most one highest-confidence candidate per label. Your custom instructions are appended to that contract.
- Requests time out after 60 seconds and show a user-facing error without changing existing annotations.

### AI request logs

The Electron terminal logs the system prompt, source-text payload, structured provider response, normalized suggestions, usage, and errors for each AI request. API keys are never logged.

These logs intentionally include document text. Do not share them if the dataset contains sensitive information.

### Pricing estimates

NERTator reads [data/pricing.csv](data/pricing.csv) locally and calculates estimated request cost from reported token usage. Pricing is matched by exact model name. A model missing from the table shows **Cost unavailable**.

## Architecture

```text
React renderer
  -> context-isolated Electron preload bridge
  -> Electron main process
      -> SQLite project database (.nerdb)
      -> LangChain AI service
          -> OpenAI or Google Gemini
```

The renderer never receives API keys. The main process fetches the canonical document from SQLite before an AI request, validates returned spans against that source text, and only accepted suggestions are saved as annotations.

## Project structure

```text
electron/
  main.cjs       Electron lifecycle, IPC, encrypted settings
  preload.cjs    Narrow renderer-to-main API
  database.cjs   SQLite project persistence
  ai.cjs         LangChain providers, prompt, validation, usage, pricing
src/
  main.tsx       React application UI
  shared.ts      Shared types and span/export helpers
data/
  pricing.csv    Local per-model token pricing table
```

## Security and privacy

- `.nerdb` files contain local project data and annotations.
- An AI request sends only the currently open document, its label schema, and your custom instructions to the selected provider.
- Requests occur only after you click **Suggest entities**.
- API keys are encrypted with the operating system's secure storage when available.
