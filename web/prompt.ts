/**
 * The BYOK prompt: the same persona spec and transcript the file-mode flow uses,
 * with a task section written for an API call (one JSON object, nothing else).
 */
import { promptPreamble, renderTranscript } from '../shared/transcript.js';
import type { ParsedChat } from '../shared/types.js';

export const OTIS = {
  name: 'Otis',
  tagline: 'An AI with no filter, too many opinions and nowhere else to be.',
};

function taskSection(chat: ParsedChat): string {
  const maxIndex = Math.max(chat.messages.length - 1, 0);
  return `# Your task

Write the Classic Report for this chat as **one JSON object**, and reply with ONLY a single JSON object: no markdown code fences, no preamble, no commentary before or after it. Your entire reply must parse as JSON.

The object must have exactly this shape:

{
  "id": "a UUID v4 that you generate",
  "chatSlug": ${JSON.stringify(chat.slug)},
  "reportType": "classic",
  "title": "the roast headline",
  "groupName": ${JSON.stringify(chat.groupName)},
  "persona": { "name": ${JSON.stringify(OTIS.name)}, "tagline": ${JSON.stringify(OTIS.tagline)} },
  "blocks": [ ... ],
  "createdAt": "an ISO 8601 timestamp"
}

"blocks" is a flat array of the report in reading order. These five block types are the only ones that exist:

- { "type": "paragraph", "text": "prose, the workhorse block" }
- { "type": "heading", "emoji": "one emoji character", "title": "The Roster" }
- { "type": "quote", "msgIndexes": [4, 5] }
- { "type": "entry", "label": "Best Deadpan", "text": "why they won it" }
- { "type": "lexicon", "terms": [{ "term": "the villa", "note": "optional gloss" }] }

Hard rules:

1. "chatSlug" must be exactly ${JSON.stringify(chat.slug)}.
2. "persona" must be exactly the object above. You are Otis.
3. Quote ONLY with "msgIndexes". Every entry must be a whole number from 0 to ${maxIndex} inclusive: those are the [i] numbers in the transcript below. Never paste message text into a quote block. The renderer prints the real message for each index, which is why a report physically cannot misquote anyone. An index outside 0 to ${maxIndex} makes the whole report invalid.
4. The only markup allowed inside any "text", "label", "title" or "note" string is **bold**, *italic* and \`code\`. No links, no HTML, no headings, no lists, no other markdown.
5. Write the title as "observation - a report on ${chat.groupName}". Join the two halves with a plain hyphen between spaces, never a long dash character. The same goes for the prose: use hyphens, commas or full stops, not long dashes.
6. Section headings, order and length are specified in the persona spec above. Use its emoji for each section.
7. Use the group's own language and spelling. Do not translate, do not clean up, do not censor quoted messages.

Then stop. The JSON object is the entire deliverable.

`;
}

/** Persona spec + chat stats + task + the numbered transcript. */
export function buildPrompt(chat: ParsedChat, personaText: string): string {
  return `${promptPreamble(chat, personaText)}
---

${taskSection(chat)}---

# The transcript

${renderTranscript(chat)}`;
}

/** The follow-up turn after a report came back invalid. */
export function repairInstruction(problem: string): string {
  return `Your JSON failed validation: ${problem}. Return the corrected complete JSON object only, with no fences and no commentary.`;
}
