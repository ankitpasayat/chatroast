import type { Block, ParsedChat, Report } from '../../shared/types.js';
import { escapeHtml, escapeHtmlWithBreaks, renderInline } from './inline.js';

export { escapeHtml, renderInline } from './inline.js';

const STYLES = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: #fff;
  color: #1a1a1a;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 17px;
  line-height: 1.6;
}
.page { max-width: 680px; margin: 0 auto; padding: 56px 24px 96px; }

.chip {
  display: inline-block;
  border: 1px solid #d8d8d8;
  border-radius: 999px;
  padding: 6px 16px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: #1a1a1a;
}

h1.title {
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: 700;
  font-size: 40px;
  line-height: 1.15;
  letter-spacing: -0.01em;
  margin: 24px 0 28px;
}

.byline {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #f6f6f6;
  border-radius: 12px;
  padding: 16px 18px;
  margin: 0 0 44px;
}
.avatar {
  flex: 0 0 auto;
  width: 44px; height: 44px;
  border-radius: 50%;
  background: #f5c451;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
  line-height: 1;
}
.persona-name { font-weight: 700; font-size: 16px; line-height: 1.3; }
.persona-tagline { color: #666; font-size: 15px; line-height: 1.4; }

p { margin: 0 0 20px; }
strong { font-weight: 700; }
em { font-style: italic; }

.section {
  text-align: center;
  margin: 56px 0 36px;
}
.medallion {
  width: 64px; height: 64px;
  margin: 0 auto 16px;
  border: 1px solid #ececec;
  background: #fff;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px;
  line-height: 1;
}
.section h2 {
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: 700;
  font-size: 32px;
  line-height: 1.2;
  margin: 0;
}
.divider { color: #bbb; font-size: 14px; letter-spacing: 0.15em; margin-top: 6px; }

.quotes { margin: 0 0 22px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.bubble {
  position: relative;
  max-width: 85%;
  background: #d9fdd3;
  color: #111b21;
  border-radius: 12px;
  border-top-left-radius: 4px;
  padding: 10px 14px;
  padding-right: 40px;
  padding-bottom: 14px;
  font-size: 16px;
  line-height: 1.45;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.ticks { position: absolute; right: 10px; bottom: 6px; color: #53bdeb; font-size: 11px; line-height: 1; }

.entry { margin: 0 0 16px; }

.lexicon { margin: 0 0 22px; line-height: 2.1; }
.chip-code, .term {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  background: #f0f0f0;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 0.9em;
}

.notfound { text-align: center; padding-top: 96px; }
.notfound h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 36px; margin: 0 0 12px; }
.notfound p { color: #666; }
a { color: inherit; }

@media (max-width: 520px) {
  body { font-size: 16px; }
  h1.title { font-size: 30px; }
  .section h2 { font-size: 26px; }
  .bubble { max-width: 95%; }
}

@media print {
  @page { margin: 18mm 14mm; }
  html, body {
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  nav, footer, .no-print { display: none !important; }
  .page { max-width: none; padding: 0; }
  .bubble, .medallion, .byline, .chip, .chip-code, .term {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .section, .quotes, .bubble { break-inside: avoid; page-break-inside: avoid; }
  .section h2 { break-after: avoid; page-break-after: avoid; }
  h1.title { break-after: avoid; page-break-after: avoid; }
}
`;

function document_(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

/** One WhatsApp-style bubble: chat text verbatim, escaped, no markdown. */
function renderBubble(chat: ParsedChat, msgIndex: number): string {
  const msg = chat.messages[msgIndex];
  if (!msg) return '';
  return `<div class="bubble">${escapeHtmlWithBreaks(msg.text)}<span class="ticks">✓✓</span></div>`;
}

function renderBlock(block: Block, chat: ParsedChat): string {
  switch (block.type) {
    case 'paragraph':
      return `<p>${renderInline(block.text)}</p>`;

    case 'heading':
      return `<div class="section">
  <div class="medallion">${escapeHtml(block.emoji)}</div>
  <h2>${escapeHtml(block.title)}</h2>
  <div class="divider">—— ◆ ——</div>
</div>`;

    case 'quote': {
      const bubbles = block.msgIndexes.map((i) => renderBubble(chat, i)).filter(Boolean);
      if (bubbles.length === 0) return '';
      return `<div class="quotes">\n${bubbles.join('\n')}\n</div>`;
    }

    case 'entry':
      return `<p class="entry"><strong>${renderInline(block.label)}:</strong> ${renderInline(block.text)}</p>`;

    case 'lexicon': {
      const parts = block.terms.map((t) => {
        const chip = `<span class="term">${escapeHtml(t.term)}</span>`;
        return t.note ? `${chip} ${renderInline(t.note)}` : chip;
      });
      return `<p class="lexicon">${parts.join('. ')}.</p>`;
    }
  }
}

/** Pure: Report + its ParsedChat -> a self-contained HTML document. */
export function renderReport(report: Report, chat: ParsedChat): string {
  const body = `<main class="page">
<div class="chip">Classic Report</div>
<h1 class="title">${renderInline(report.title)}</h1>
<div class="byline">
  <div class="avatar">🕶</div>
  <div>
    <div class="persona-name">${escapeHtml(report.persona.name)}</div>
    <div class="persona-tagline">${escapeHtml(report.persona.tagline)}</div>
  </div>
</div>
${report.blocks.map((b) => renderBlock(b, chat)).join('\n')}
</main>`;
  return document_(report.title, body);
}

/** Minimal styled 404 / error page, same typography. */
export function renderNotFound(message = 'That report does not exist.'): string {
  return document_(
    'Not found',
    `<main class="page notfound">
<h1>404</h1>
<p>${escapeHtml(message)}</p>
<p><a href="/">Back to reports</a></p>
</main>`
  );
}

/** Bare list page used when public/index.html has not been built yet. */
export function renderIndexPlaceholder(
  reports: { id: string; title: string; groupName: string; createdAt: string }[]
): string {
  const items =
    reports.length === 0
      ? '<p>No reports yet. Drop a <code class="chip-code">report.json</code> into <code class="chip-code">work/&lt;slug&gt;/</code>.</p>'
      : `<ul>${reports
          .map(
            (r) =>
              `<li><a href="/r/${encodeURIComponent(r.id)}">${escapeHtml(r.title)}</a> <span class="persona-tagline">- ${escapeHtml(r.groupName)}</span></li>`
          )
          .join('\n')}</ul>`;
  return document_(
    'Reports',
    `<main class="page">
<div class="chip">Classic Report</div>
<h1 class="title">Reports</h1>
${items}
</main>`
  );
}
