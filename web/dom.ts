/**
 * Tiny DOM helpers. All page copy lives in the <template> elements in
 * index.html; this module only clones them and fills in values with
 * textContent, so no user string is ever parsed as HTML.
 */

export function view(templateId: string): DocumentFragment {
  const tpl = document.getElementById(templateId);
  if (!(tpl instanceof HTMLTemplateElement)) {
    throw new Error(`template #${templateId} is missing from index.html`);
  }
  return tpl.content.cloneNode(true) as DocumentFragment;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`element #${id} is missing`);
  return node as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setText(id: string, text: string): void {
  byId(id).textContent = text;
}

export function toggle(id: string, visible: boolean): void {
  byId(id).hidden = !visible;
}

/** Replace the whole view with a plain message and a way back. */
export function fatal(app: HTMLElement, message: string): void {
  const wrap = el('div');
  const p = el('p', 'error', message);
  const back = el('a', 'btn', 'Back to chatroast');
  back.href = '#/';
  wrap.append(p, el('p'), back);
  app.replaceChildren(wrap);
}
