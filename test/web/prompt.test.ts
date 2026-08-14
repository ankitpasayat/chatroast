import { beforeAll, describe, expect, it } from 'vitest';
import { renderTranscript } from '../../shared/transcript.js';
import type { ParsedChat } from '../../shared/types.js';
import { buildPrompt, repairInstruction } from '../../web/prompt.js';
import { loadPersona, loadSampleChat } from './helpers.js';

describe('buildPrompt', () => {
  let chat: ParsedChat;
  let persona: string;
  let prompt: string;

  beforeAll(async () => {
    chat = await loadSampleChat();
    persona = await loadPersona();
    prompt = buildPrompt(chat, persona);
  });

  it('opens with the persona spec', () => {
    const heading = persona.split('\n')[0]!;
    expect(prompt.startsWith(heading)).toBe(true);
    expect(prompt).toContain('## Report shape (Classic)');
  });

  it('states the chat stats the author needs', () => {
    expect(prompt).toContain('**Group name:** Trip Council');
    expect(prompt).toContain('**Slug:** sample-chat');
    expect(prompt).toContain('| Maya |');
  });

  it('demands one bare JSON object and nothing else', () => {
    expect(prompt).toContain('ONLY a single JSON object');
    expect(prompt).toContain('no markdown code fences');
    expect(prompt).toContain('"reportType": "classic"');
    expect(prompt).toContain('"chatSlug": "sample-chat"');
  });

  it('spells out every block type', () => {
    for (const type of ['paragraph', 'heading', 'quote', 'entry', 'lexicon']) {
      expect(prompt).toContain(`"type": "${type}"`);
    }
  });

  it('gives the valid msgIndex range for this chat', () => {
    expect(chat.messages.length).toBe(16);
    expect(prompt).toContain('from 0 to 15 inclusive');
    expect(prompt).toContain('"msgIndexes"');
  });

  it('asks for a plain hyphen in the title, not a long dash', () => {
    expect(prompt).toContain('plain hyphen');
    expect(prompt).toContain('a report on Trip Council');
  });

  it('carries the whole numbered transcript', () => {
    expect(prompt).toContain('# The transcript');
    expect(prompt).toContain('[1] Maya: manifesting goa 2024');
    expect(prompt).toContain(renderTranscript(chat));
  });
});

describe('repairInstruction', () => {
  it('quotes the validation problem and asks for the whole object back', () => {
    const text = repairInstruction('report: blocks[2]: msgIndex 99 is out of range');
    expect(text).toContain('msgIndex 99 is out of range');
    expect(text).toContain('corrected complete JSON object only');
  });
});
