import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseChatWithDiagnostics } from '../../src/parser/index.js';

const FIXTURES = path.resolve('fixtures/chats');
const read = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

/**
 * Expected values were derived from the fixture files directly (independent
 * grep/count pass over the raw text), not from parser output.
 */
describe('fixtures/chats/synthetic-ios.txt', () => {
  const { chat, anomalies } = parseChatWithDiagnostics('synthetic-ios.txt', read('synthetic-ios.txt'));

  it('is an iOS export named by the most recent rename', () => {
    expect(chat.format).toBe('ios');
    expect(chat.groupName).toBe('Weekend Ping v2');
    expect(chat.slug).toBe('weekend-ping-v2');
  });

  it('parses every message with no anomalies', () => {
    expect(anomalies).toEqual([]);
    expect(chat.messages).toHaveLength(16);
    expect(chat.messageCount).toBe(12);
    expect(chat.messages.every((m, i) => m.index === i)).toBe(true);
  });

  it('counts the senders, sorted descending', () => {
    expect(chat.senders).toEqual([
      { name: 'Vikram S', count: 5 },
      { name: 'Nadia', count: 4 },
      { name: 'Rhea Kapoor', count: 3 },
    ]);
    expect(chat.senders.reduce((n, s) => n + s.count, 0)).toBe(chat.messageCount);
  });

  it('spans the exported date range', () => {
    expect(chat.firstTs).toBe('2024-03-01T10:00:00');
    expect(chat.lastTs).toBe('2024-03-02T09:11:00');
  });

  it('joins multiline messages and strips the edited marker', () => {
    const plan = chat.messages.find((m) => m.text.startsWith('plan for saturday:'));
    expect(plan?.text).toBe('plan for saturday:\nstep one wake up\nstep two there is no step two');
    const edited = chat.messages.filter((m) => m.edited);
    expect(edited).toHaveLength(1);
    expect(edited[0]!.text).toBe('bold of you');
  });

  it('types every media message and keeps captions', () => {
    const media = chat.messages.filter((m) => m.kind === 'media');
    expect(media).toHaveLength(6);
    const byType = media.reduce<Record<string, number>>((acc, m) => {
      acc[m.mediaType!] = (acc[m.mediaType!] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType).toEqual({ photo: 2, location: 1, document: 1, sticker: 1, contact: 1 });
    const captioned = media.find((m) => m.mediaType === 'photo' && m.text === 'sunset pic');
    expect(captioned).toBeDefined();
    const contact = media.find((m) => m.mediaType === 'contact');
    expect(contact!.text).toMatch(/\.vcf$/);
  });

  it('keeps deleted tombstones and empty bodies as real messages', () => {
    expect(chat.messages.some((m) => m.text === 'This message was deleted.')).toBe(true);
    const empty = chat.messages.filter((m) => m.kind === 'text' && m.text === '');
    expect(empty).toHaveLength(1);
  });

  it('never leaves a directional mark in message text and nulls system senders', () => {
    expect(chat.messages.some((m) => /[‎‏]/.test(m.text))).toBe(false);
    expect(chat.messages.filter((m) => m.kind === 'system')).toHaveLength(4);
    expect(chat.messages.filter((m) => m.kind === 'system').every((m) => m.sender === null)).toBe(true);
    expect(chat.messages.filter((m) => m.kind !== 'system').every((m) => m.sender !== null)).toBe(true);
  });
});

describe('synthetic Android fixtures', () => {
  it('android-basic.txt', () => {
    const { chat, anomalies } = parseChatWithDiagnostics(
      'android-basic.txt',
      read('android-basic.txt'),
    );
    expect(anomalies).toEqual([]);
    expect(chat.format).toBe('android');
    expect(chat.groupName).toBe('Android Gang');
    expect(chat.messages).toHaveLength(11);
    expect(chat.messageCount).toBe(6);
    expect(chat.senders).toEqual([
      { name: 'Ishaan Grewal', count: 2 },
      { name: 'Zoya Khan', count: 2 },
      { name: 'Farhan Ali', count: 1 },
      { name: 'Kabir Bose', count: 1 },
    ]);
    expect(chat.messages.filter((m) => m.kind === 'media')).toHaveLength(2);
  });

  it('android-12h.txt falls back to the filename for the group name', () => {
    const { chat, anomalies } = parseChatWithDiagnostics(
      'WhatsApp Chat with Valo Nightshift.txt',
      read('android-12h.txt'),
    );
    expect(anomalies).toEqual([]);
    expect(chat.groupName).toBe('Valo Nightshift');
    expect(chat.slug).toBe('valo-nightshift');
    expect(chat.firstTs).toBe('2023-02-07T19:55:00');
    expect(chat.lastTs).toBe('2023-02-08T13:00:00');
    expect(chat.messageCount).toBe(6);
  });
});
