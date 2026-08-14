# chatroast 🔥

Turn a WhatsApp group chat export into a long-form roast report, written by **Otis** —
an AI persona with no filter, too many opinions and nowhere else to be.

Export a group chat → drop the `.zip` on the page → get a magazine-style report:
a cold open about your group's true nature, a member-by-member Roster with your
actual messages rendered as chat bubbles, Awards, a Lexicon of your group's private
vocabulary, an Honest Power Map, and a prediction of how each of you will react to
reading it. Print the page and it's a clean PDF.

**Local-first and private by design.** Your chat never has to leave your machine:
the zip is unpacked *in your browser* (media is never uploaded anywhere — only the
text transcript is read), parsing happens on your own local server, and report
generation currently runs in "file mode," where you or a coding agent write the
report locally. No accounts, no cloud, no telemetry.

## Quick start

```sh
git clone https://github.com/ankitpasayat/chatroast
cd chatroast
npm install
npm run dev        # → http://localhost:8787
```

## Generating a report, step by step

### 1. Export your chat from WhatsApp

On the phone: open the group → group name → **Export chat**. Either "Without media"
(small, fastest) or "With media" works — chatroast only ever reads the transcript.
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
| `chat.json` | Every message, parsed and numbered — quote indices refer to these |
| `transcript.md` | A numbered, human-readable transcript for whoever writes the report |
| `PROMPT.md` | The Otis persona spec + per-chat stats + authoring instructions |

### 3. Author the report

A report is a single JSON file, `work/<slug>/report.json`, following the `Report`
type in [shared/types.ts](shared/types.ts). The critical design rule: **quotes are
message indices, never pasted text.** A quote block is
`{ "type": "quote", "msgIndexes": [412, 413] }` and the renderer prints the real
messages — so a report physically cannot misquote anyone.

Ways to produce it:

- **With a coding agent (recommended today).** Open the repo in Claude Code (or any
  agent that can read/write files) and say: *"author the report for `<slug>`"*. The
  agent reads `transcript.md` + `PROMPT.md`, writes `report.json`, and the page goes
  live immediately — the server re-reads `work/` on every request, no restart needed.
- **By hand**, if you are feeling literary. `fixtures/sample-report.json` is a small
  worked example against `fixtures/sample-chat.json`.
- **Via an LLM API** — a built-in generator (one structured-output call, prompt =
  `PROMPT.md`) plus a Cloudflare Workers deployment are the planned next phase; the
  routes are already portable (Hono) and all filesystem access is isolated in
  `src/server/storage.ts`.

### 4. Read, share, print

- `GET /` — landing page with upload + your report library
- `GET /r/<id>` — the report (Cmd/Ctrl+P for the PDF version)
- `GET /api/reports` — machine-readable list

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
  that reads only the transcript entry from the archive — a 100 MB export with
  media costs ~5 ms and never uploads a single photo.
- **Test suite** across parser, storage, renderer and routes: `npm test`.

## Privacy notes

- `work/` (parsed chats + reports) and `sources/` (your export zips) are gitignored —
  they exist only on your machine.
- All bundled fixtures are synthetic; no real chat data ships with this repo.
- If you author reports with a cloud-hosted agent or LLM, the transcript is shared
  with that provider — that's your call to make, per chat.

## Development

```sh
npm test           # vitest: parser, storage, renderer, routes
npm run typecheck  # tsc --noEmit
```

`CONTRACTS.md` documents the internal module boundaries, the transcript format, and
the report visual spec. `shared/types.ts` is the single source of truth for data
shapes; `shared/persona.md` is the Otis voice spec.

## License

[AGPL-3.0-or-later](LICENSE). Free as in freedom: you can use, study, modify and
share chatroast, commercially or not — but if you distribute it or run a modified
version as a network service, you must offer your users the source under the same
terms. It stays free for everyone, forever.
