// Schritt 5: Titel, Interpret, Arrangeur – vorausgefüllt mit dem, was die KI erkannt hat.

import { h } from '../dom';
import { session, saveSession } from '../state';
import { parseNotation } from '../../score';
import { setHeader } from '../measure';
import type { Ctx } from '../app';

export function renderDetails(root: HTMLElement, ctx: Ctx) {
  const { score } = parseNotation(session.notation);
  const fromAi = session.source === 'photo';
  const field = (id: string, label: string, value: string, detected: string, placeholder: string) => {
    const input = h('input', { id, type: 'text', value, placeholder, autocomplete: 'off' });
    const note = fromAi
      ? h('p', { class: 'help' }, detected ? 'So von der KI gelesen – bitte prüfen.' : 'Nicht auf dem Blatt gefunden.')
      : null;
    return { input, el: h('div', { class: 'form-row' }, h('label', { class: 'field', for: id }, label), input, note) };
  };
  const title = field('d-title', 'Titel', score.title, session.detected.title, 'z. B. Todo tiene su final');
  const composer = field('d-composer', 'Interpret oder Komponist', score.composer, session.detected.composer, 'z. B. Hector Lavoe');
  const arranger = field('d-arranger', 'Arrangement', score.arranger, session.detected.arranger, 'optional');
  const tempo = h('input', { id: 'd-tempo', type: 'number', inputmode: 'numeric', min: '20', max: '320', value: score.tempo ? String(score.tempo) : '', placeholder: 'optional' });

  const form = h('form', { class: 'panel details-form', novalidate: true },
    title.el, composer.el, arranger.el,
    h('div', { class: 'form-row' }, h('label', { class: 'field', for: 'd-tempo' }, 'Tempo (Schläge pro Minute)'), tempo),
    h('div', { class: 'step-actions' },
      h('button', { class: 'btn primary', type: 'submit' }, 'PDF erstellen'),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => ctx.go('overview') }, 'Zurück zum Gesamtbild')),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let n = session.notation;
    n = setHeader(n, 'arranger', arranger.input.value);
    n = setHeader(n, 'composer', composer.input.value);
    n = setHeader(n, 'title', title.input.value);
    const t = parseInt(tempo.value, 10);
    n = setHeader(n, 'tempo', Number.isFinite(t) && t > 0 ? String(t) : '');
    session.notation = n;
    saveSession();
    ctx.go('done');
  });

  root.append(
    h('div', { class: 'step-head' },
      h('h1', {}, 'Angaben fürs Blatt'),
      h('p', { class: 'lead' }, 'Stehen oben auf dem PDF.'),
    ),
    form,
  );
  title.input.focus({ preventScroll: true });
}
