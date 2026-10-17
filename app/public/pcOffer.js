// "Run this on my PC" offer.
//
// Jarvis's chat models can't change calendars, files, apps or websites. When
// Eli asks for something like that, the persona has the model end its reply
// with one line:
//   PC_TASK browser: <one imperative sentence>    (Gmail, Calendar, Sheets, websites)
//   PC_TASK computer: <one imperative sentence>   (Windows apps and local files)
// This file strips that line from the visible reply and shows it as a card
// with the exact task and a Run button. Nothing runs until Eli taps Run; the
// tap sends it to the normal PC task path ("In my Chrome, execute this task:
// ..." / "On my PC, execute this task: ..."), where the server and the worker
// validate it like any typed command. The model's line is only a suggestion.

const OFFER_LINE = /(?:^|\n)[ \t]*PC_TASK (browser|computer):[ \t]*([^\n]{3,400}?)[ \t]*$/;
const ANY_OFFER = /(?:^|\n)[ \t]*PC_TASK[\s\S]*$/;

/** Splits a reply into the text to show and the PC offer (if the last line is one). */
export function splitPcOffer(reply) {
  const text = String(reply ?? '').replace(ANY_OFFER, '').trimEnd();
  const match = OFFER_LINE.exec(String(reply ?? '').trimEnd());
  if (!match) return { text, offer: undefined };
  const task = match[2].replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { text, offer: task.length >= 3 ? { scope: match[1], task } : undefined };
}

/** The exact message sent when Eli taps Run. */
export function offerCommand(offer) {
  return `${offer.scope === 'browser' ? 'In my Chrome' : 'On my PC'}, execute this task: ${offer.task}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Mounts the card. run(message) is called with the command when Eli taps Run. */
export function mountPcOffer({ run }) {
  let card;

  function hide() {
    card?.remove();
    card = undefined;
  }

  function show(offer) {
    hide();
    card = el('div', 'pc-offer');
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'Run on your PC');
    const copy = el('div', 'pc-offer-copy');
    copy.append(
      el('small', '', offer.scope === 'browser' ? 'READY TO RUN IN YOUR CHROME' : 'READY TO RUN ON YOUR PC'),
      el('p', '', offer.task),
    );
    const buttons = el('div', 'pc-offer-buttons');
    const go = el('button', 'primary-btn', 'Run on my PC');
    go.type = 'button';
    go.onclick = () => { const message = offerCommand(offer); hide(); run(message); };
    const dismiss = el('button', 'text-btn', 'Dismiss');
    dismiss.type = 'button';
    dismiss.onclick = hide;
    buttons.append(go, dismiss);
    card.append(copy, buttons);
    document.body.append(card);
  }

  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  return { show, hide };
}
