import { describe, expect, it } from 'vitest';
import { parseChat, parseChatWithDiagnostics, slugify } from '../../src/parser/index.js';

/** Build an iOS export body from lines, matching the real CRLF exports. */
const ios = (...lines: string[]) => `${lines.join('\r\n')}\r\n`;

const LRM = '‎';

describe('iOS format', () => {
  it('parses a plain message into ts, sender and text', () => {
    const chat = parseChat('chai-chat.txt', ios('[07/02/23, 19:55:05] Kabir Bose: Done the needful'));
    expect(chat.format).toBe('ios');
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toMatchObject({
      index: 0,
      ts: '2023-02-07T19:55:05',
      sender: 'Kabir Bose',
      kind: 'text',
      text: 'Done the needful',
    });
  });

  it('joins continuation lines with \\n and keeps blank lines inside the message', () => {
    const chat = parseChat(
      'x.txt',
      ios(
        '[07/02/23, 19:55:05] Kabir Bose: About the room',
        '',
        'Rent: 24000',
        '[07/02/23, 19:56:05] Zoya Khan: ok',
      ),
    );
    expect(chat.messages).toHaveLength(2);
    expect(chat.messages[0]!.text).toBe('About the room\n\nRent: 24000');
    expect(chat.messages[1]!.text).toBe('ok');
  });

  it('does not glue the file-final newline onto the last message', () => {
    const chat = parseChat('x.txt', ios('[07/02/23, 19:55:05] Kabir Bose: last'));
    expect(chat.messages[0]!.text).toBe('last');
  });

  it('strips the edited marker and sets edited: true', () => {
    const chat = parseChat(
      'x.txt',
      ios(`[10/07/26, 02:32:30] Aarav Shah: in my opinion ${LRM}<This message was edited>`),
    );
    expect(chat.messages[0]!.text).toBe('in my opinion');
    expect(chat.messages[0]!.edited).toBe(true);
  });

  it('strips the edited marker when it lands on a continuation line', () => {
    const chat = parseChat(
      'x.txt',
      ios('[10/07/26, 02:32:30] Ankit: line one', `line two ${LRM}<This message was edited>`),
    );
    expect(chat.messages[0]!.text).toBe('line one\nline two');
    expect(chat.messages[0]!.edited).toBe(true);
  });

  it('leaves edited undefined on untouched messages', () => {
    const chat = parseChat('x.txt', ios('[10/07/26, 02:32:30] Ankit: plain'));
    expect(chat.messages[0]!.edited).toBeUndefined();
  });

  it('strips directional marks before "[", after the colon and inside text', () => {
    const chat = parseChat(
      'x.txt',
      ios(`${LRM}[20/11/25, 08:38:55] Kabir Bose: ${LRM}hello ${LRM}world`),
    );
    expect(chat.messages[0]!.text).toBe('hello world');
    expect(chat.messages[0]!.sender).toBe('Kabir Bose');
  });

  it('tolerates 4-digit years, missing seconds and am/pm', () => {
    const chat = parseChat(
      'x.txt',
      ios(
        '[07/02/2023, 7:55:05 PM] Kabir Bose: pm',
        '[07/02/2023, 12:05 AM] Kabir Bose: midnight',
        '[07/02/2023, 12:05 PM] Kabir Bose: noon',
      ),
    );
    expect(chat.messages.map((m) => m.ts)).toEqual([
      '2023-02-07T19:55:05',
      '2023-02-07T00:05:00',
      '2023-02-07T12:05:00',
    ]);
  });
});

describe('media detection', () => {
  const attach = (file: string) =>
    parseChat('x.txt', ios(`${LRM}[20/11/25, 08:38:55] P: ${LRM}<attached: ${file}>`)).messages[0]!;

  it.each([
    ['00000007-GIF-2025-11-20-08-38-55.mp4', 'gif'],
    ['00000008-PHOTO-2025-11-20-08-40-08.jpg', 'photo'],
    ['00000005-VIDEO-2025-10-11-22-14-47.mp4', 'video'],
    ['00000012-STICKER-2024-04-01-23-44-17.webp', 'sticker'],
    ['00000031-AUDIO-2025-01-01-10-00-00.opus', 'audio'],
    ['00000031-PTT-2025-01-01-10-00-00.opus', 'audio'],
    ['00000390-Anirban Paul.vcf', 'contact'],
    ['00000123-Flipkart BGM Cheat sheet.pdf', 'document'],
    ['00000124-notes.docx', 'document'],
    ['00000125-mystery.qqq', 'unknown'],
  ])('%s -> %s', (file, type) => {
    const m = attach(file);
    expect(m.kind).toBe('media');
    expect(m.mediaType).toBe(type);
    expect(m.text).toBe(file); // no caption -> filename
  });

  it('keeps the caption when an attachment ships with text', () => {
    const chat = parseChat(
      'x.txt',
      ios(
        `${LRM}[16/05/24, 19:30:16] Aarav Shah: Lmao ${LRM}<attached: 00000007-PHOTO-2024-05-16-19-30-15.jpg>`,
      ),
    );
    expect(chat.messages[0]).toMatchObject({
      kind: 'media',
      mediaType: 'photo',
      sender: 'Aarav Shah',
      text: 'Lmao',
    });
  });

  it('detects a location share', () => {
    const chat = parseChat(
      'x.txt',
      ios(`[20/11/25, 13:36:42] Imran: ${LRM}Location: https://maps.google.com/?q=13.41,77.72`),
    );
    expect(chat.messages[0]).toMatchObject({ kind: 'media', mediaType: 'location' });
    expect(chat.messages[0]!.text).toContain('maps.google.com');
  });

  it('handles the "media not included" export placeholders', () => {
    const chat = parseChat(
      'x.txt',
      ios(
        `[20/11/25, 13:36:42] Sameer: ${LRM}video omitted`,
        `[20/11/25, 13:36:43] Sameer: ${LRM}image omitted`,
        `[20/11/25, 13:36:44] Sameer: ${LRM}sticker omitted`,
      ),
    );
    expect(chat.messages.map((m) => [m.kind, m.mediaType])).toEqual([
      ['media', 'video'],
      ['media', 'photo'],
      ['media', 'sticker'],
    ]);
  });

  it('keeps deleted-message tombstones as text, verbatim', () => {
    const chat = parseChat(
      'x.txt',
      ios(
        `[11/03/26, 10:11:36] Kabir Bose: ${LRM}This message was deleted.`,
        `[11/03/26, 10:11:37] Kabir Bose: ${LRM}You deleted this message.`,
      ),
    );
    expect(chat.messages.map((m) => [m.kind, m.sender, m.text])).toEqual([
      ['text', 'Kabir Bose', 'This message was deleted.'],
      ['text', 'Kabir Bose', 'You deleted this message.'],
    ]);
    expect(chat.messageCount).toBe(2);
  });
});

describe('system messages and group name', () => {
  it('marks system notices with sender null and excludes them from counts', () => {
    const chat = parseChat(
      'chai-chat.txt',
      ios(
        `[07/02/23, 19:55:05] Chai Chat: ${LRM}Messages and calls are end-to-end encrypted.`,
        `[07/02/23, 19:55:05] Chai Chat: ${LRM}Group creator created this group`,
        `[20/11/25, 01:29:20] Chai Chat: ${LRM}Kabir Bose added you`,
        '[20/11/25, 01:29:33] Kabir Bose: Done the needful',
      ),
    );
    expect(chat.messages.slice(0, 3).every((m) => m.kind === 'system' && m.sender === null)).toBe(
      true,
    );
    expect(chat.messages[2]!.text).toBe('Kabir Bose added you');
    expect(chat.messageCount).toBe(1);
    expect(chat.senders).toEqual([{ name: 'Kabir Bose', count: 1 }]);
  });

  it('takes the group name from the most recent rename', () => {
    const chat = parseChat(
      'whatever.txt',
      ios(
        `[01/12/23, 13:59:26] Batch of 2019: ${LRM}You created this group`,
        `[25/04/24, 17:58:44] Batch of 2019: ${LRM}You changed the group name to “Happy birthday Aman”`,
        '[26/04/24, 10:00:00] Tejas: thanks',
        `[13/12/24, 20:57:57] Tejas: ${LRM}Tejas changed the group name to “Batch of 2019”`,
      ),
    );
    expect(chat.groupName).toBe('Batch of 2019');
    expect(chat.slug).toBe('batch-of-2019');
  });

  it('falls back to the sender that only ever posts system notices', () => {
    const chat = parseChat(
      'unhelpful-name.txt',
      ios(
        `[07/02/23, 19:55:05] Chai Chat: ${LRM}Messages and calls are end-to-end encrypted.`,
        `[20/11/25, 01:29:20] Chai Chat: ${LRM}Kabir Bose added you`,
        `[20/11/25, 01:30:00] Kabir Bose: ${LRM}Video call, 30 sec`,
        '[20/11/25, 01:29:33] Kabir Bose: Done the needful',
      ),
    );
    // Kabir Bose also authors a real message, so he is not a candidate group name.
    expect(chat.groupName).toBe('Chai Chat');
  });

  it('falls back to the filename stem when the export has no system notices', () => {
    const chat = parseChat(
      'WhatsApp Chat - Book Club.txt',
      ios('[07/02/23, 19:55:05] Kabir Bose: hi'),
    );
    expect(chat.groupName).toBe('Book Club');
    expect(chat.slug).toBe('book-club');
  });
});

describe('slugify', () => {
  it.each([
    ['Chai Chat', 'chai-chat'],
    ['Batch of 2019', 'batch-of-2019'],
    ['HBD Rohit and Karan 🎉🎉', 'hbd-rohit-and-karan'],
    ['  ///  ', 'chat'],
    ['Valo - Nightshift!', 'valo-nightshift'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('Android format', () => {
  const text = ios(
    '07/02/23, 19:55 - Messages and calls are end-to-end encrypted. Tap to learn more.',
    '07/02/23, 19:55 - Kabir Bose created group "Bakchodi HQ"',
    '07/02/23, 20:01 - Kabir Bose: Oi',
    '07/02/23, 20:02 - Zoya Khan: <Media omitted>',
    '07/02/23, 20:03 - Ishaan Grewal: chal',
    'raat ko',
    '08/02/23, 09:12 - Kabir Bose changed the group name to "Android Gang"',
  );

  it('detects the format and separates system lines (no "Name:" part)', () => {
    const chat = parseChat('x.txt', text);
    expect(chat.format).toBe('android');
    expect(chat.messages.map((m) => m.kind)).toEqual([
      'system',
      'system',
      'text',
      'media',
      'text',
      'system',
    ]);
    expect(chat.messageCount).toBe(3);
  });

  it('reads <Media omitted> as media of unknown type', () => {
    const chat = parseChat('x.txt', text);
    expect(chat.messages[3]).toMatchObject({
      kind: 'media',
      mediaType: 'unknown',
      sender: 'Zoya Khan',
      text: '<Media omitted>',
    });
  });

  it('joins continuation lines and picks up the rename', () => {
    const chat = parseChat('x.txt', text);
    expect(chat.messages[4]!.text).toBe('chal\nraat ko');
    expect(chat.groupName).toBe('Android Gang');
    expect(chat.slug).toBe('android-gang');
  });

  it('handles 12-hour times, single-digit d/m and dd.mm.yy', () => {
    const chat = parseChat(
      'x.txt',
      ios(
        '7/2/23, 7:55 pm - Meera: aaja',
        '7/2/23, 11:59 pm - Tony Valo: last one',
        '8/2/23, 12:05 am - Meera: bhai so ja',
        '8.2.23, 12:30 pm - Tony Valo: dot format',
        '8.2.23, 1:00 PM - Meera: haan',
      ),
    );
    expect(chat.format).toBe('android');
    expect(chat.messages.map((m) => m.ts)).toEqual([
      '2023-02-07T19:55:00',
      '2023-02-07T23:59:00',
      '2023-02-08T00:05:00',
      '2023-02-08T12:30:00',
      '2023-02-08T13:00:00',
    ]);
  });
});

describe('diagnostics', () => {
  it('reports text that appears before any timestamped line', () => {
    const { chat, anomalies } = parseChatWithDiagnostics(
      'x.txt',
      ios('junk header', '[07/02/23, 19:55:05] Kabir Bose: hi'),
    );
    expect(chat.messages).toHaveLength(1);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toContain('line 1');
  });

  it('parseChat ignores anomalies but returns the same chat', () => {
    const input = ios('junk header', '[07/02/23, 19:55:05] Kabir Bose: hi');
    expect(parseChat('x.txt', input)).toEqual(parseChatWithDiagnostics('x.txt', input).chat);
  });

  it('reports a timestamped line with no sender in an iOS export', () => {
    const { anomalies } = parseChatWithDiagnostics('x.txt', ios('[07/02/23, 19:55:05] no colon here'));
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toContain('without a sender');
  });
});
