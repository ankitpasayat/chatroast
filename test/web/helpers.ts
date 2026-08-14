import { readFile } from 'node:fs/promises';
import type { ParsedChat } from '../../shared/types.js';

const ROOT = new URL('../../', import.meta.url);

export function loadSampleChat(): Promise<ParsedChat> {
  return readFile(new URL('fixtures/sample-chat.json', ROOT), 'utf8').then(
    (raw) => JSON.parse(raw) as ParsedChat,
  );
}

/** The real persona spec, exactly as web/build.mjs inlines it into the bundle. */
export function loadPersona(): Promise<string> {
  return readFile(new URL('shared/persona.md', ROOT), 'utf8');
}

export function loadWebFile(name: string): Promise<string> {
  return readFile(new URL(`web/${name}`, ROOT), 'utf8');
}
