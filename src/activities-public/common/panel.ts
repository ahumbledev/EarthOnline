import { t } from '../language.ts';

/** A scene-local help or pause panel; closing it consumes exactly one Esc. */
export function createActivityPanel(options: { onOpen?(): void; onClose?(): void }) {
  const dialog = document.createElement('dialog'); dialog.className = 'workshop-dialog';
  const header = document.createElement('header'), title = document.createElement('h2');
  const close = document.createElement('button'); close.type = 'button'; close.textContent = t`返回玩法 · Esc`;
  header.append(title, close);
  const body = document.createElement('section'); body.className = 'workshop-dialog-list';
  const linesBody = document.createElement('div'), content = document.createElement('div');
  body.append(linesBody, content);
  const actions = document.createElement('footer'); dialog.append(header, body, actions); document.body.append(dialog);
  const lifetime = new AbortController(); const events = { signal: lifetime.signal };
  let opened = false;
  function finish(resume = true) { if (!opened) return; opened = false; dialog.close(); if (resume) options.onClose?.(); }
  close.addEventListener('click', () => finish(), events);
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); }, events);
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if (event.code === 'Escape' && !event.isComposing) { event.preventDefault(); if (!event.repeat) finish(); } }, events);
  for (const name of ['keyup', 'pointerdown', 'pointerup', 'click', 'wheel']) dialog.addEventListener(name, event => event.stopPropagation(), events);
  return {
    open(heading: string, lines: string[], buttons: { text: string; run(): void }[] = []) {
      title.textContent = heading; dialog.setAttribute('aria-label', heading); linesBody.replaceChildren(); actions.replaceChildren();
      for (const line of lines) { const p = document.createElement('p'); p.textContent = line; linesBody.append(p); }
      for (const action of buttons) { const button = document.createElement('button'); button.type = 'button'; button.textContent = action.text; button.onclick = () => { finish(false); action.run(); }; actions.append(button); }
      if (!opened) { options.onOpen?.(); if (document.pointerLockElement) document.exitPointerLock(); opened = true; dialog.showModal(); }
      close.focus();
    },
    content, dialog, close: finish, get isOpen() { return opened; }, dispose() { opened = false; lifetime.abort(); dialog.remove(); },
  };
}
