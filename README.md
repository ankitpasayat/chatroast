# chatroast

Turn a WhatsApp group chat export into a long-form roast report, written by **Otis** -
an AI persona with no filter, too many opinions and nowhere else to be.

Export a group chat → drop the `.zip` on the page → get a magazine-style report:
a cold open about your group's true nature, a member-by-member Roster with your
actual messages rendered as chat bubbles, Awards, a Lexicon of your group's private
vocabulary, an Honest Power Map, and a prediction of how each of you will react to
reading it. Print the page and it's a clean PDF.

**Local-first and private by design.** Your chat never has to leave your machine:
the zip is unpacked *in your browser* (media is never uploaded anywhere - only the
text transcript is read). There are two ways to run it: a hosted static page where
you bring your own API key, or a local server in "file mode" where you or a coding
agent write the report on your machine. No accounts, no backend, no telemetry
either way.

## Use it in your browser (bring your own key)

The hosted version at **<https://ankitpasayat.github.io/chatroast/>** needs no
install. Drop your export, paste an API key, and Otis writes the report right
there - streamed into the page.

Supported providers: Anthropic (best results, the persona was tuned on Claude),
OpenAI, OpenRouter, xAI, local Ollama or LM Studio, or any custom
OpenAI-compatible endpoint. The provider must allow direct browser (CORS)
requests; all of the listed ones do, and OpenRouter reaches nearly any model if
yours does not.

**What happens to your data and your key.** The page is static files served by
GitHub Pages - there is no server of ours to send anything to. The transcript and
your key go to exactly one place, the API provider you picked, when you click
Generate or List models. Chats and reports are stored in your own browser (IndexedDB);
settings live in localStorage; the key is kept in memory only, unless you
explicitly tick "remember".

**Pasting an API key into a website means trusting that website's code.** Do not
take our word for it: the deployed files are built from this repo by a
[public GitHub Action](https://github.com/ankitpasayat/chatroast/actions) you can
audit, the JavaScript bundle is deliberately unminified so you can read exactly
what is deployed, and DevTools' Network tab shows every request the page makes.
Use a key with a spending limit, and avoid pasting keys on shared computers.

## Run it locally

Local "file mode" needs no API key at all: a coding agent (or you) authors the
report as a file, and the local server renders it.

```sh
git clone https://github.com/ankitpasayat/chatroast
cd chatroast
npm install
npm run dev        # → http://localhost:8787
```

## Generating a report, step by step

### 1. Export your chat from WhatsApp

On the phone: open the group → group name → **Export chat**. Either "Without media"
(small, fastest) or "With media" works - chatroast only ever reads the transcript.
Both iOS and Android export formats are supported.

### 2. Ingest it

Either drop the `.zip` (or the `_chat.txt`) onto the landing page at
`http://localhost:8787`, or use the CLI:

```sh
npm run ingest -- "path/to/WhatsApp Chat - My Group.zip"
```

Ingestion parses the export and writes `work/<slug>/`:

| File | What it is |
|---|---|
| `chat.json` | Every message, parsed and numbered - quote indices refer to these |
| `transcript.md` | A numbered, human-readable transcript for whoever writes the report |
| `PROMPT.md` | The Otis persona spec + per-chat stats + authoring instructions |

### 3. Author the report

A report is a single JSON file, `work/<slug>/report.json`, following the `Report`
type in [shared/types.ts](shared/types.ts). The critical design rule: **quotes are
message indices, never pasted text.** A quote block is
`{ "type": "quote", "msgIndexes": [412, 413] }` and the renderer prints the real
messages - so a report physically cannot misquote anyone.

Ways to produce it:

- **With a coding agent (recommended today).** Open the repo in Claude Code (or any
  agent that can read/write files) and say: *"author the report for `<slug>`"*. The
  agent reads `transcript.md` + `PROMPT.md`, writes `report.json`, and the page goes
  live immediately - the server re-reads `work/` on every request, no restart needed.
- **By hand**, if you are feeling literary. `fixtures/sample-report.json` is a small
  worked example against `fixtures/sample-chat.json`.
- **Via an LLM API** - the [hosted version](https://ankitpasayat.github.io/chatroast/)
  does exactly this in the browser with your own key. The same prompt and
  validation code is shared between both modes (`shared/`), so a chat reads
  identically everywhere.

### 4. Read, share, print

- `GET /` - landing page with upload + your report library
- `GET /r/<id>` - the report (Cmd/Ctrl+P for the PDF version)
- `GET /api/reports` - machine-readable list

Validation is automatic: a `report.json` only goes live if it parses, matches its
chat, and every quoted index exists. Check a chat's status with
`curl localhost:8787/api/chats/<slug>`.

## What's in the box

- **Parser** for both WhatsApp export dialects (iOS `[dd/mm/yy, hh:mm:ss]` and
  Android `dd/mm/yy, hh:mm -`), including multiline messages, edited markers,
  attachment/media typing, locations, contact cards, deleted-message tombstones,
  group renames, and the invisible directional marks iOS sprinkles everywhere.
  Every input line is accounted for; anything unparseable is surfaced as a
  diagnostic instead of silently dropped.
- **Renderer** producing a single self-contained HTML page (no scripts, no external
  assets, all user text HTML-escaped) with print CSS.
- **Browser-side zip extraction** ([fflate](https://github.com/101arrowz/fflate))
  that reads only the transcript entry from the archive - a 100 MB export with
  media costs ~5 ms and never uploads a single photo.
- **Static BYOK app** (`web/`, built by `npm run build:web` into `site/`,
  deployed by [Actions](.github/workflows/pages.yml)): hash-routed single-page
  app, no framework, streaming generation against Anthropic or any
  OpenAI-compatible API, one automatic repair round trip when a model's reply
  does not validate.
- **Test suite** across parser, storage, renderer, routes and the web app:
  `npm test`.

## Privacy notes

- `work/` (parsed chats + reports) and `sources/` (your export zips) are gitignored -
  they exist only on your machine.
- All bundled fixtures are synthetic; no real chat data ships with this repo.
- If you author reports with a cloud-hosted agent or LLM (including the hosted
  BYOK page), the transcript is shared with that provider - that's your call to
  make, per chat. Reports quote real messages, so treat a finished report as
  being as private as the chat itself.
- The hosted page stores everything client-side. To erase it, clear the site's
  data in your browser.

## Development

```sh
npm test           # vitest: parser, storage, renderer, routes, web app
npm run typecheck  # tsc --noEmit
npm run build:web  # esbuild → site/ (what GitHub Pages serves)
```

`CONTRACTS.md` documents the internal module boundaries, the transcript format, and
the report visual spec. `shared/types.ts` is the single source of truth for data
shapes; `shared/persona.md` is the Otis voice spec.

## License

[MIT](LICENSE). Use it however you want - fork it, sell it, host it, embed it,
closed or open - just keep the copyright notice with the source.
