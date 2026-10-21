// Schritt 3: Unsichere Stellen einzeln bestätigen – Foto-Ausschnitt neben der gelesenen Fassung.

import { h, icon } from '../dom';
import { session, saveSession } from '../state';
import { parseNotation } from '../../score';
import { MiniScore } from '../widgets';
import { cropMeasure, measureContent, measureIndexForNumber, replaceMeasure, snippet } from '../measure';
import type { Ctx } from '../app';

export function renderReview(root: HTMLElement, ctx: Ctx) {
  const list = session.uncertain;
  let pos = list.findIndex((_, i) => !session.reviewed[i]);
  if (pos < 0) pos = 0;
  let minis: MiniScore[] = [];

  const draw = () => {
    for (const m of minis) m.destroy();
    minis = [];
    root.replaceChildren();

    const u = list[pos];
    const idx = measureIndexForNumber(session.recognized, u.measure);
    const { score } = parseNotation(session.notation);
    const current = measureContent(session.notation, idx);
    const rec = session.recognized[idx];
    const img = rec ? ctx.images[(rec.page || 1) - 1] : undefined;

    // Foto-Ausschnitt
    const photo = h('figure', { class: 'crop' });
    if (img?.url && rec?.box) {
      const el = h('img', { alt: `Takt ${u.measure} im Foto`, class: 'crop-img' });
      void cropMeasure(img, rec.box).then((url) => (el.src = url));
      const wide = h('img', { alt: `Ganze Seite mit Takt ${u.measure}`, class: 'crop-wide', src: img.url, hidden: true });
      const zoom = h('button', { class: 'btn quiet small', type: 'button', 'aria-pressed': 'false', onclick: () => {
        const on = wide.hidden;
        wide.hidden = !on;
        el.hidden = on;
        zoom.setAttribute('aria-pressed', String(on));
        zoom.lastChild!.textContent = on ? 'Nur den Takt' : 'Ganze Seite';
      } }, icon('zoom', 16), h('span', {}, 'Ganze Seite'));
      photo.append(el, wide, h('figcaption', {}, `Takt ${u.measure} im Foto`, zoom));
    } else {
      photo.append(h('p', { class: 'help' }, 'Das Foto ist nicht mehr verfügbar (z. B. nach dem Neuladen in einem privaten Fenster).'));
    }

    // Lesarten
    const options = [current, ...u.options.filter((o) => o.trim() && o.trim() !== current)];
    let chosen = 0;
    const customInput = h('input', { type: 'text', class: 'code-input', spellcheck: 'false', autocapitalize: 'off', value: current, 'aria-label': 'Takt selbst eingeben' });
    const customMini = new MiniScore();
    minis.push(customMini);
    customMini.set(snippet(score, idx, current));
    customInput.addEventListener('input', () => {
      customMini.set(snippet(score, idx, customInput.value));
      select(options.length);
    });

    const choices = h('div', { class: 'readings', role: 'radiogroup', 'aria-label': 'Welche Fassung stimmt?' });
    const cards: HTMLElement[] = [];
    const select = (i: number) => {
      chosen = i;
      cards.forEach((c, j) => c.setAttribute('aria-checked', String(j === i)));
      confirmBtn.textContent = i === 0 ? 'Passt so' : 'Übernehmen';
    };
    options.forEach((o, i) => {
      const mini = new MiniScore();
      minis.push(mini);
      mini.set(snippet(score, idx, o));
      const card = h('div', { class: 'reading', role: 'radio', tabindex: '0', 'aria-checked': String(i === 0), onclick: () => select(i) },
        h('p', { class: 'reading-label' }, i === 0 ? 'So gelesen' : `Oder so? (${i + 1})`),
        mini.el,
        h('code', {}, o),
      );
      card.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          select(i);
        }
      });
      cards.push(card);
      choices.append(card);
    });
    const customCard = h('div', { class: 'reading custom', role: 'radio', tabindex: '-1', 'aria-checked': 'false', onclick: () => select(options.length) },
      h('p', { class: 'reading-label' }, 'Selbst eingeben'),
      customMini.el,
      customInput,
      h('button', { class: 'link', type: 'button', onclick: (e: Event) => {
        e.stopPropagation();
        ctx.openHelp();
      } }, 'Wie schreibe ich Noten?'),
    );
    cards.push(customCard);
    choices.append(customCard);

    const confirmBtn = h('button', { class: 'btn primary', type: 'button' }, 'Passt so');
    confirmBtn.addEventListener('click', () => {
      const value = chosen === options.length ? customInput.value : options[chosen];
      if (value.trim() && value.trim() !== current) {
        session.notation = replaceMeasure(session.notation, idx, value);
        session.reviewed[pos] = 'changed';
      } else session.reviewed[pos] = 'ok';
      saveSession();
      next();
    });

    const next = () => {
      const after = list.findIndex((_, i) => i > pos && !session.reviewed[i]);
      const any = list.findIndex((_, i) => !session.reviewed[i]);
      const target = after >= 0 ? after : any;
      if (target < 0) return ctx.go('overview');
      pos = target;
      draw();
      root.querySelector('h1')?.focus();
    };

    const done = Object.keys(session.reviewed).length;
    root.append(
      h('div', { class: 'step-head' },
        h('p', { class: 'meta num' }, `Stelle ${pos + 1} von ${list.length}${done ? ` · ${done} erledigt` : ''}`),
        h('h1', { tabindex: '-1' }, u.question || `Stimmt Takt ${u.measure}?`),
      ),
      h('div', { class: 'review-grid' }, photo, choices),
      h('div', { class: 'step-actions' },
        confirmBtn,
        h('button', { class: 'btn quiet', type: 'button', onclick: () => {
          session.reviewed[pos] = 'skipped';
          saveSession();
          next();
        } }, 'Später im Gesamtbild'),
        pos > 0 ? h('button', { class: 'btn quiet', type: 'button', onclick: () => {
          pos--;
          draw();
        } }, icon('left', 18), 'Vorherige') : null,
      ),
    );
  };

  draw();
  return () => minis.forEach((m) => m.destroy());
}
