import personaText from '../shared/persona.md';
import { unzipSync } from 'fflate';
export const n: number = personaText.length + Object.keys(unzipSync(new Uint8Array())).length;
export const id: string = crypto.randomUUID();
export const t: string | undefined = document.getElementById('x')?.textContent ?? undefined;
export const s: string | null = localStorage.getItem('k');
