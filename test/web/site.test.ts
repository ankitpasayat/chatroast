/**
 * Guards on the shipped page itself: the trust notice is a hard requirement,
 * the page must stay self-contained, and the house style bans long dashes and
 * emoji everywhere in the app chrome.
 */
import { readdir, readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadWebFile } from './helpers.js';

const REPO = 'https://github.com/ankitpasayat/chatroast';

describe('web/index.html', () => {
  let html: string;
  /** Same copy with the HTML line wrapping collapsed, so prose can be matched. */
  let flat: string;

  beforeAll(async () => {
    html = await loadWebFile('index.html');
    flat = html.replace(/\s+/g, ' ');
  });

  it('carries the trust notice, above the key input', () => {
    expect(flat).toContain(
      "Pasting an API key into a website means trusting that website's code.",
    );
    expect(flat).toContain('there is no server, no analytics, and nobody to send your key to');
    expect(flat).toContain('sent to exactly one place, the API provider you pick above');
    expect(flat).toContain('Do not take our word for it');
    expect(flat).toContain('read the source');
    expect(flat).toContain('public GitHub Action');
    expect(flat).toContain('watch every request this page makes');
    expect(flat).toContain('run chatroast locally instead');
    expect(flat).toContain('Use a key with a spending limit');
    expect(flat).toContain('do not enter keys on shared computers');

    expect(html).toContain(`href="${REPO}"`);
    expect(html).toContain(`href="${REPO}/actions"`);

    expect(html.indexOf('class="trust"')).toBeLessThan(html.indexOf('id="f-key"'));
  });

  it('carries the CORS note under the provider select', () => {
    expect(flat).toContain('Your provider must allow browser (CORS) requests');
    expect(flat).toContain('Anthropic, OpenAI, OpenRouter and xAI do');
    expect(flat).toContain('Local Ollama and LM Studio need CORS enabled in their own settings');
    expect(flat).toContain('OpenRouter is the easiest way to reach nearly any model from a browser');

    expect(html.indexOf('id="f-provider"')).toBeLessThan(html.indexOf('id="cors-note"'));
  });

  it('references only its own relative assets', () => {
    expect(html).toContain('href="./style.css"');
    expect(html).toContain('src="./assets/app.js"');
    expect(html).not.toMatch(/<script[^>]+src="(https?:)?\/\//);
    expect(html).not.toMatch(/<link[^>]+href="(https?:)?\/\/(?!github)/);
    expect(html).not.toContain('fonts.googleapis');
  });
});

describe('house style', () => {
  const LONG_DASH = /\u2014/;
  const EMOJI =
    /[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  let files: { name: string; text: string }[];

  beforeAll(async () => {
    const dirs = ['web', 'test/web'];
    files = [];
    for (const dir of dirs) {
      const root = new URL(`../../${dir}/`, import.meta.url);
      for (const name of await readdir(root)) {
        files.push({ name: `${dir}/${name}`, text: await readFile(new URL(name, root), 'utf8') });
      }
    }
  });

  it('has no long dashes anywhere in the app source', () => {
    expect(files.filter((f) => LONG_DASH.test(f.text)).map((f) => f.name)).toEqual([]);
  });

  it('has no emoji anywhere in the app source', () => {
    expect(files.filter((f) => EMOJI.test(f.text)).map((f) => f.name)).toEqual([]);
  });
});
