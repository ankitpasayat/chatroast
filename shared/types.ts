// ============================================================
// FROZEN CONTRACT - do not change shapes without orchestrator
// approval. All three agents code against this file.
// ============================================================

/** One parsed WhatsApp message. Index is the quote-reference key. */
export interface ChatMessage {
  /** Stable 0-based position in ParsedChat.messages. Reports quote by this. */
  index: number;
  /** ISO 8601 timestamp (assume local time as written in the export). */
  ts: string;
  /** Sender display name; null for system messages (group created, X added Y, ...). */
  sender: string | null;
  kind: 'text' | 'media' | 'system';
  /** For media messages, best-effort type from the attachment filename / marker. */
  mediaType?:
    | 'photo'
    | 'video'
    | 'gif'
    | 'sticker'
    | 'audio'
    | 'document'
    | 'contact'
    | 'location'
    | 'unknown';
  /**
   * text kind  -> full message text (multiline joined with '\n')
   * media kind -> caption if present, else the attachment filename / '<Media omitted>'
   * system     -> the raw system line
   */
  text: string;
  /** True if the export marked this '<This message was edited>'. */
  edited?: boolean;
}

export interface SenderStat {
  name: string;
  /** Count of non-system messages (text + media). */
  count: number;
}

export interface ParsedChat {
  /** kebab-case of groupName, e.g. "chai-chat". Filesystem + URL safe. */
  slug: string;
  groupName: string;
  format: 'ios' | 'android';
  messages: ChatMessage[];
  /** Sorted descending by count. */
  senders: SenderStat[];
  /** ISO timestamps of first/last message. */
  firstTs: string;
  lastTs: string;
  /** Count of non-system messages. */
  messageCount: number;
}

// ------------------------------------------------------------
// Report schema. A report is a flat stream of blocks; 'heading'
// blocks delimit the big sections (Roster, Awards, ...).
// Inline markup allowed in any Inline string: **bold**, *italic*,
// `code`. Nothing else. Renderer must escape all HTML.
// ------------------------------------------------------------

export type Inline = string;

export type Block =
  | { type: 'paragraph'; text: Inline }
  /** One WhatsApp-style bubble per index, rendered verbatim from ParsedChat. */
  | { type: 'quote'; msgIndexes: number[] }
  /** Big centered section divider: emoji medallion + serif title. */
  | { type: 'heading'; emoji: string; title: string }
  /** Bold-label entry, used for Awards and Power Map items. */
  | { type: 'entry'; label: Inline; text: Inline }
  /** The Lexicon: term chips with optional notes, rendered as flowing prose. */
  | { type: 'lexicon'; terms: { term: string; note?: Inline }[] };

export interface Report {
  /** UUID v4. Report URL is /r/<id>. */
  id: string;
  /** Must match the ParsedChat slug this report was authored against. */
  chatSlug: string;
  reportType: 'classic';
  /** Roast headline, e.g. "Nobody has ever booked the villa - a report on Chai Chat". */
  title: string;
  groupName: string;
  persona: { name: string; tagline: string };
  blocks: Block[];
  createdAt: string;
}

// ------------------------------------------------------------
// HTTP API (local server now; same shapes on Workers later)
// ------------------------------------------------------------
// POST /api/chats            body: { filename: string, text: string }
//                            -> 200 { slug, status: 'pending'|'ready', reportId?: string,
//                                     stats: { groupName, messageCount, senders, firstTs, lastTs } }
//                            (text is the raw chat .txt content; browser unzips client-side)
// GET  /api/chats/:slug      -> { slug, status: 'pending'|'ready', reportId?: string }
// GET  /api/reports          -> { reports: { id, title, groupName, createdAt }[] }
// GET  /api/reports/:id      -> Report JSON
// GET  /r/:id                -> rendered HTML report page
// GET  /                     -> public/index.html (static, served from ./public)
// ------------------------------------------------------------
// Filesystem layout (local storage backend):
//   work/<slug>/chat.json        ParsedChat (written by server/CLI on ingest)
//   work/<slug>/transcript.md    numbered human-readable transcript (for authoring)
//   work/<slug>/PROMPT.md        persona + instructions for the report author
//   work/<slug>/report.json      Report (appears later; authored out-of-band)
// A chat is 'ready' when work/<slug>/report.json exists AND validates:
// - parses as Report, chatSlug matches, every quote msgIndex in range.
// Invalid report.json -> stays 'pending', server logs the validation error.
// ------------------------------------------------------------
