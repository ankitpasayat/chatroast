import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ParsedChat } from '../../shared/types.js';
import { ingestChat } from '../../src/parser/ingest.js';

const LRM = '‎';
const ios = (...lines: string[]) => `${lines.join('\r\n')}\r\n`;

const SAMPLE = ios(
  `[07/02/23, 19:55:05] Chai Chat: ${LRM}Messages and calls are end-to-end encrypted.`,
  `[07/02/23, 19:55:06] Chai Chat: ${LRM}Kabir Bose added Aarav Shah`,
  '[07/02/23, 19:56:00] Ishaan Grewal: chai peene aaja',
  `${LRM}[07/02/23, 19:57:00] Zoya Khan: ${LRM}<attached: 00000008-PHOTO-2023-02-07-19-57-00.jpg>`,
  `${LRM}[08/02/23, 10:00:00] Aarav Shah: Lmao ${LRM}<attached: 00000009-VIDEO-2023-02-08-10-00-00.mp4>`,
  '[08/02/23, 10:01:00] Aarav Shah: line one',
  'line two',
);

const work = mkdtempSync(path.join(tmpdir(), 'wa-ingest-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('ingestChat', () => {
  it('writes chat.json, transcript.md and PROMPT.md under work/<slug>/', async () => {
    const chat = await ingestChat('chai-chat.txt', SAMPLE, work);
    expect(chat.slug).toBe('chai-chat');
    const dir = path.join(work, chat.slug);

    const onDisk = JSON.parse(readFileSync(path.join(dir, 'chat.json'), 'utf8')) as ParsedChat;
    expect(onDisk).toEqual(chat);

    const transcript = readFileSync(path.join(dir, 'transcript.md'), 'utf8');
    expect(transcript).toBe(
      [
        '# Chai Chat — transcript',
        '4 messages | Aarav Shah (2), Ishaan Grewal (1), Zoya Khan (1) | 2023-02-07 → 2023-02-08',
        '',
        '## 2023-02-07',
        '[0] * Messages and calls are end-to-end encrypted.',
        '[1] * Kabir Bose added Aarav Shah',
        '[2] Ishaan Grewal: chai peene aaja',
        '[3] Zoya Khan: <photo>',
        '',
        '## 2023-02-08',
        '[4] Aarav Shah: <video> Lmao',
        '[5] Aarav Shah: line one',
        '  line two',
        '',
      ].join('\n'),
    );

    const prompt = readFileSync(path.join(dir, 'PROMPT.md'), 'utf8');
    expect(prompt).toContain('# Otis — persona & report spec'); // persona.md is prepended
    expect(prompt).toContain('**Group name:** Chai Chat');
    expect(prompt).toContain('| Ishaan Grewal | 1 |');
    expect(prompt).toContain('`chatSlug` must be `"chai-chat"`');
    expect(prompt).toContain('work/chai-chat/report.json');
    expect(prompt).toContain('Valid indexes are 0..5');
  });

  it('overwrites cleanly when the same chat is ingested twice', async () => {
    await ingestChat('chai-chat.txt', SAMPLE, work);
    const again = await ingestChat('chai-chat.txt', SAMPLE, work);
    const onDisk = JSON.parse(
      readFileSync(path.join(work, again.slug, 'chat.json'), 'utf8'),
    ) as ParsedChat;
    expect(onDisk.messages).toHaveLength(6);
  });
});
