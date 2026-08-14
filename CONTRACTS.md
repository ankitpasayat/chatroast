# CONTRACTS — read this first

Local-first web app: WhatsApp chat export zip → parsed transcript → "Otis" roast
report (JSON) → styled report page at `/r/<id>` (print CSS = PDF). Reports are authored
out-of-band for now (a human/LLM writes `work/<slug>/report.json`); an API generator
comes later. Stack: TypeScript, Hono on `@hono/node-server` (will move to Cloudflare
Workers later — keep Node-specific code in the server entry & a storage module, keep
Hono routes portable). Deps are installed; do not add new dependencies.

**Type + API + filesystem contract:** `shared/types.ts` (frozen — do not edit).
**Report voice spec:** `shared/persona.md` (context only).
**Fixtures:** `fixtures/chats/*.txt` (synthetic exports; real ones may exist locally
under the gitignored `fixtures/chats/private/`), `fixtures/sample-chat.json`,
`fixtures/sample-report.json` (hand-authored; renderer's golden input).

## File ownership — hard boundaries

| Owner   | Paths (exclusive write access) |
|---------|-------------------------------|
| Agent A | `src/parser/**`, `src/cli/**`, `test/parser/**`, `fixtures/chats/android-*.txt` (new synthetic fixtures only) |
| Agent B | `src/server/**`, `src/renderer/**`, `test/server/**` |
| Agent C | `public/**` |
| Orchestrator | everything else (`shared/`, `CONTRACTS.md`, `package.json`, root configs) |

Never edit another agent's paths or the orchestrator's files. If a contract seems wrong
or blocking, note it in your final report instead of changing it.

## Cross-module imports

- Everyone imports types from `../../shared/types.js` (NodeNext ESM — use `.js`
  extension in imports).
- Agent B imports the parser as `parseChat(filename: string, text: string): ParsedChat`
  from `src/parser/index.ts`. Agent A must export exactly that. Until A lands, B codes
  against the fixtures and the type signature (do not stub inside `src/parser/`).
- Agent A's CLI reuses the same ingest logic the server uses. To avoid a circular
  dependency: Agent A owns `src/parser/ingest.ts` exporting
  `ingestChat(filename: string, text: string, workDir: string): Promise<ParsedChat>`
  which parses AND writes `work/<slug>/chat.json` + `transcript.md` + `PROMPT.md`.
  Agent B's POST /api/chats calls `ingestChat`.

## transcript.md format (Agent A writes it; humans/LLMs read it to author reports)

```
# <Group name> — transcript
<messageCount> messages | <senders summary: Name (count), ...> | <first date> → <last date>

## <YYYY-MM-DD>
[12] Ishaan Grewal: chai peene aaja
[13] Zoya Khan: <photo>
[14] * Kabir Bose added Aarav Shah
```

- `[i]` = ChatMessage.index (quote key). System lines prefixed `* `. Media as
  `<photo>` / `<video>` etc. with caption appended if present. Multiline messages
  indent continuation lines two spaces.

## PROMPT.md (Agent A writes per chat)

Concatenate: `shared/persona.md` + a stats block (group name, slug, counts, date range,
sender table) + instructions: "Write work/<slug>/report.json following the Report type
in shared/types.ts. chatSlug must be '<slug>'. Generate a UUID for id. Quote only by
msgIndexes from transcript.md."

## Definition of done

- `npm run typecheck` and `npm test` pass with your changes.
- Agent A: `npm run ingest -- fixtures/chats/chai-chat.txt` produces work files; tests
  cover both formats + edge cases; no input line is silently dropped (every line is
  attributed to a message or counted as a parse anomaly in a returned diagnostics list).
- Agent B: `npm run dev` serves `/` (static), `/r/<sample id>` renders
  `fixtures/sample-report.json` against `fixtures/sample-chat.json` when copied into
  `work/sample-chat/` (write a test doing this via the storage module, and a
  `test/server/` snapshot of key HTML structure).
- Agent C: static-only; `public/index.html` works when served by any static server;
  degrade gracefully if API endpoints 404 (server not integrated yet).

## Visual spec for the report page (Agent B) and landing (Agent C)

Reference visual spec — match this:

- Page: white background, single centered column, max-width ~680px, generous
  whitespace. Body font: system sans (-apple-system, Segoe UI, Roboto). ~17px/1.6.
- Title: large serif (Georgia, 'Times New Roman', serif), bold, ~40px, tight leading.
- Above title: small pill/chip "Classic Report" (rounded border, 14px).
- Byline card: light gray rounded box, small round avatar placeholder (emoji 🕶 on
  amber circle), persona name bold + tagline muted.
- Section headings: centered; a ~64px circle (very light gray border, white bg) with
  the emoji inside, then serif title ~32px, then a small divider `—— ◆ ——` muted.
- Chat bubbles: WhatsApp-style — light green `#d9fdd3`, rounded 12px (4px top-left),
  padding 10px 14px, max-width ~85%, left-aligned, dark text, preserving newlines;
  bottom-right inside the bubble a small blue double-check `✓✓` (`#53bdeb`, 11px).
  Consecutive quotes in one `quote` block stack with 8px gap.
- `entry` blocks: bold label + normal text, like "**Best Deadpan:** ...".
- `lexicon` terms: monospace chips, light gray bg `#f0f0f0`, rounded 6px, padding
  2px 8px, joined into flowing prose with the notes.
- Inline markup: **bold**, *italic*, `code` (same chip style). Escape all HTML.
- Print CSS: `@media print` — hide any nav/footer chrome, keep colors
  (`print-color-adjust: exact`), sensible page margins; the page should print to a
  clean PDF matching the screen layout.
- Landing page (C): same typography family; drop zone card, file picker fallback,
  progress states, and a "reports" list section fed by GET /api/reports when available.
