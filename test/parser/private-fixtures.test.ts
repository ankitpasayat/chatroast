import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseChatWithDiagnostics } from '../../src/parser/index.js';

/**
 * Extra coverage against real (private) WhatsApp exports. Everything in
 * fixtures/chats/private/ is gitignored; this suite runs only on machines
 * that have those files plus an expected.json describing them, and skips
 * everywhere else - a fresh clone runs the synthetic suites only.
 *
 * expected.json shape:
 * {
 *   "<file.txt>": {
 *     "format": "ios", "groupName": "...", "totalMessages": 0,
 *     "messageCount": 0, "senderCount": 0, "firstTs": "...", "lastTs": "...",
 *     "topSenders": { "<name>": count, ... },        // optional
 *     "editedCount": 0, "mediaCount": 0, "contactCount": 0  // optional
 *   }
 * }
 * Expected values must be derived from the raw files directly (independent
 * grep/count pass), never pasted from parser output.
 */
const PRIVATE = path.resolve('fixtures/chats/private');
const MANIFEST = path.join(PRIVATE, 'expected.json');
const enabled = existsSync(MANIFEST);

type Expectation = {
  format: 'ios' | 'android';
  groupName: string;
  totalMessages: number;
  messageCount: number;
  senderCount: number;
  firstTs: string;
  lastTs: string;
  topSenders?: Record<string, number>;
  editedCount?: number;
  mediaCount?: number;
  contactCount?: number;
};

describe.skipIf(!enabled)('private fixtures', () => {
  const manifest: Record<string, Expectation> = enabled
    ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
    : {};

  for (const [file, exp] of Object.entries(manifest)) {
    it(`${file} parses fully with no anomalies and exact counts`, () => {
      const raw = readFileSync(path.join(PRIVATE, file), 'utf8');
      const { chat, anomalies } = parseChatWithDiagnostics(file, raw);
      expect(anomalies).toEqual([]);
      expect(chat.format).toBe(exp.format);
      expect(chat.groupName).toBe(exp.groupName);
      expect(chat.messages).toHaveLength(exp.totalMessages);
      expect(chat.messageCount).toBe(exp.messageCount);
      expect(chat.senders).toHaveLength(exp.senderCount);
      expect(chat.firstTs).toBe(exp.firstTs);
      expect(chat.lastTs).toBe(exp.lastTs);
      expect(chat.messages.some((m) => /[‎‏]/.test(m.text))).toBe(false);
      expect(chat.senders.reduce((n, s) => n + s.count, 0)).toBe(chat.messageCount);
      if (exp.topSenders) {
        const counts = Object.fromEntries(chat.senders.map((s) => [s.name, s.count]));
        expect(counts).toMatchObject(exp.topSenders);
      }
      if (exp.editedCount !== undefined) {
        expect(chat.messages.filter((m) => m.edited)).toHaveLength(exp.editedCount);
      }
      if (exp.mediaCount !== undefined) {
        const media = chat.messages.filter((m) => m.kind === 'media');
        expect(media).toHaveLength(exp.mediaCount);
        expect(media.every((m) => m.mediaType)).toBe(true);
      }
      if (exp.contactCount !== undefined) {
        expect(chat.messages.filter((m) => m.mediaType === 'contact')).toHaveLength(
          exp.contactCount,
        );
      }
    });
  }

  it('manifest covers files that exist', () => {
    const files = readdirSync(PRIVATE).filter((f) => f.endsWith('.txt'));
    for (const file of Object.keys(manifest)) {
      expect(files).toContain(file);
    }
  });
});
