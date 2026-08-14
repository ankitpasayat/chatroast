import { describe, expect, it } from 'vitest';
import type { Report } from '../../shared/types.js';
import { renderInline, renderReport } from '../../src/renderer/index.js';
import { loadSampleChat, loadSampleReport, XSS_TEXT } from './helpers.js';

const count = (html: string, needle: RegExp) => html.match(needle)?.length ?? 0;

describe('renderReport (golden fixtures)', () => {
  it('renders a self-contained document with the title, chip and byline', async () => {
    const html = renderReport(await loadSampleReport(), await loadSampleChat());

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Nobody has ever booked the villa — a report on Trip Council');
    expect(html).toContain('>Classic Report<');
    expect(html).toContain('Otis');
    expect(html).toContain('An AI with no filter, too many opinions and nowhere else to be.');
    expect(html).toContain('🕶');
    // self-contained: no external assets, no script
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
    expect(html).toContain('<style>');
  });

  it('renders one bubble per quoted msgIndex', async () => {
    const report = await loadSampleReport();
    const chat = await loadSampleChat();
    const expected = report.blocks
      .filter((b) => b.type === 'quote')
      .reduce((n, b) => n + (b.type === 'quote' ? b.msgIndexes.length : 0), 0);

    expect(expected).toBe(7);
    const html = renderReport(report, chat);
    expect(count(html, /class="bubble"/g)).toBe(expected);
    expect(count(html, /class="ticks">✓✓</g)).toBe(expected);
    expect(html).toContain('#d9fdd3');
    expect(html).toContain('#53bdeb');
  });

  it('renders quoted messages verbatim, emoji and newlines included', async () => {
    const chat = await loadSampleChat();
    const report = await loadSampleReport();
    // message 4 as authored, including the 🌚
    expect(chat.messages[4]!.text).toBe('I found a villa for 12k total 🏝️');
    const html = renderReport(report, chat);
    expect(html).toContain(`<div class="bubble">I found a villa for 12k total 🏝️<span class="ticks">`);

    // a multiline message keeps its newline as <br>
    const multiline: Report = {
      ...report,
      blocks: [{ type: 'quote', msgIndexes: [12] }],
    };
    expect(renderReport(multiline, chat)).toContain(
      'ok final plan:<br>nobody books anything and we call it a tradition'
    );
  });

  it('renders section headings as medallion + serif title + diamond divider', async () => {
    const html = renderReport(await loadSampleReport(), await loadSampleChat());
    expect(count(html, /class="medallion"/g)).toBe(5);
    expect(html).toContain('<div class="medallion">🧍</div>');
    expect(html).toContain('<h2>The Roster</h2>');
    expect(count(html, /—— ◆ ——/g)).toBe(5);
  });

  it('renders entry blocks as bold label + text', async () => {
    const html = renderReport(await loadSampleReport(), await loadSampleChat());
    expect(html).toContain('<strong>Best Deadpan:</strong> Sam, when Zain');
  });

  it('renders lexicon terms as chips', async () => {
    const html = renderReport(await loadSampleReport(), await loadSampleChat());
    expect(html).toContain('<span class="term">manifesting</span>');
    expect(html).toContain('<span class="term">++</span>');
    // note text flows after the chip, with its inline markup applied
    expect(html).toContain('<span class="term">villa math</span> (<em>allegedly</em> 12k total)');
    expect(html).toContain('(<em>allegedly</em> 12k total)');
  });

  it('applies inline markup in report prose', async () => {
    const html = renderReport(await loadSampleReport(), await loadSampleChat());
    expect(html).toContain('<strong>planning trips</strong>');
    expect(html).toContain('It got <em>funnier</em>');
    expect(html).toContain('<code class="chip-code">+1</code>');
  });

  it('includes print styles that keep colours', async () => {
    const html = renderReport(await loadSampleReport(), await loadSampleChat());
    expect(html).toContain('@media print');
    expect(html).toContain('print-color-adjust: exact');
  });
});

describe('escaping', () => {
  it('escapes HTML before applying inline markup', () => {
    expect(renderInline('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(renderInline('a & b **bold** <b>x</b>')).toBe('a &amp; b <strong>bold</strong> &lt;b&gt;x&lt;/b&gt;');
    // markup characters inside a code span stay literal
    expect(renderInline('`**not bold**`')).toBe('<code class="chip-code">**not bold**</code>');
  });

  it('escapes hostile chat text and applies no markdown inside bubbles', async () => {
    const chat = await loadSampleChat();
    const index = chat.messages.length;
    chat.messages.push({ index, ts: '2026-06-01T10:00:00', sender: 'Mallory', kind: 'text', text: XSS_TEXT });
    const report: Report = {
      ...(await loadSampleReport()),
      title: 'Hostile <b>input</b>',
      blocks: [{ type: 'quote', msgIndexes: [index] }],
    };

    const html = renderReport(report, chat);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(&quot;pwn&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // verbatim: NO markdown processing inside a bubble
    expect(html).toContain('**not bold**');
    expect(html).not.toContain('<strong>not bold</strong>');
    // ...and the title is escaped too (in <title> and <h1>)
    expect(html).toContain('<title>Hostile &lt;b&gt;input&lt;/b&gt;</title>');
    expect(html).not.toContain('Hostile <b>input</b>');
  });
});
