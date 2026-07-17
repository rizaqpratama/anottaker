# NERTator mobile

An Expo/React Native app offering NERTator's core NER annotation workflow on a phone: create a project, import documents, define labels, annotate manually (or with AI assistance), review, and export JSONL.

See the [root README](../README.md) for the overall monorepo layout and [`CLAUDE.md`](../CLAUDE.md) for the full architecture writeup, including exactly what this app shares with `desktop/` (via `@nertator/shared`) and what's implemented separately per platform.

## Setup

From the repo root (not this directory) — installing here alone won't link `@nertator/shared`:

```bash
npm install
```

## Running

```bash
npm run dev:mobile
```

(from the repo root — this builds `shared` first, which `mobile` needs at runtime). Or, from inside `mobile/`, after `shared` has been built at least once:

```bash
npx expo start
```

Scan the QR code with the [Expo Go](https://expo.dev/go) app on your phone, or press `i` for an iOS simulator / `a` for an Android emulator. `shared/` isn't automatically rebuilt on every save — if you're editing files under `shared/src/`, run `npm run build --workspace=@nertator/shared` (or `npm run dev --workspace=@nertator/shared` for a watcher) alongside `expo start`.

## What's different from desktop

- **AI providers**: OpenAI and Gemini only, called directly via `fetch()` against their REST APIs (`src/ai/openai.ts`, `src/ai/gemini.ts`) rather than through LangChain. Desktop's local coding-agent provider (Codex, Claude Code, Cursor Agent, etc.) needs a spawned CLI subprocess and has no mobile equivalent — there's no UI for it here, by design.
- **Storage**: one project per install, in an app-sandboxed SQLite database (`expo-sqlite`, `src/db/ProjectStore.ts`) — not desktop's "open any `.nerdb` file from disk" model. Import documents via the document picker; export via the OS share sheet.
- **Manual annotation**: desktop captures a DOM text selection (`window.getSelection()`); that API doesn't exist in React Native. This app toggles into a "select" mode showing a read-only, multiline `TextInput` — `onSelectionChange` gives native character offsets directly, which feed the same `validateSpan`/`EntitySpan` model as desktop. See `src/screens/Annotator.tsx`.
- **Navigation**: no navigation library. One root component (`App.tsx`) holds screen state (`'queue' | 'annotator'`) with `Labels`/`Settings` as modal overlays, matching desktop's own router-less style.

## Known gaps

This scaffold was built and typechecked in a sandboxed environment with no GUI, no simulator, and no network access to Expo's SDK-compatibility API (so `expo install` couldn't be used — the `expo-*` package versions in `package.json` were pinned by hand against the npm registry instead; double-check them if you bump the `expo` SDK version). It has **not** been booted in Expo Go or a simulator. Before relying on it:

- Boot the app and walk through create project → import → label → annotate → AI suggest → review → export end to end.
- Confirm `TextInput.onSelectionChange` behaves as expected for offset capture on both iOS and Android — selection-handle behavior can differ subtly by platform.
- Confirm `expo-sqlite` pagination (`ProjectStore.snapshot`) stays responsive at a realistic document count; desktop's `pageSize = 100` default is carried over unverified for mobile.
- If you want LangChain parity with desktop instead of raw `fetch()` calls, verify `@langchain/openai`/`@langchain/google-genai` actually work under Hermes/Metro before switching — this was judged too likely to hit Node-only APIs to be worth the integration risk for a first pass, not verified to definitely fail.
