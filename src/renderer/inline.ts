/**
 * Inline markup for report text. Contract: only **bold**, *italic*, `code`.
 * HTML is escaped FIRST, always — markup is applied to already-escaped text so
 * nothing authored in a report or a chat can inject markup.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escaped text -> HTML with newlines as <br>. */
export function escapeHtmlWithBreaks(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** Escape, then apply inline markup. Code spans are opaque to bold/italic. */
export function renderInline(text: string): string {
  const escaped = escapeHtml(text);
  // Split on code spans so ** / * inside `code` stay literal.
  return escaped
    .split(/(`[^`]+`)/g)
    .map((part) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1
        ? `<code class="chip-code">${part.slice(1, -1)}</code>`
        : emphasis(part)
    )
    .join('');
}
