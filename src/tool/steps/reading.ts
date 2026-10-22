// Schritt 2: Gemini liest – jeder fertige Takt leuchtet auf dem Foto auf.

import { h, reducedMotion } from '../dom';
import { prefs, session, saveSession, emptySession } from '../state';
import { recognizeSheet, type RecognizedMeasure } from '../../gemini';
import { verifySheet } from '../../verify';
import { parseNotation } from '../../score';
import { MODELS } from '../../gemini';
import type { Ctx } from '../app';

const PHASES = [
  'Gemini schaut sich die Seite an …',
  'Schlüssel, Tonart und Taktart …',
  'Systeme und Taktstriche …',
  'Noten und Rhythmen …',
  'Zeichen, Dynamik, Wiederholungen …',
];

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

export function renderReading(root: HTMLElement, ctx: Ctx) {
  const abort = new AbortController();
  const images = ctx.images;
  const modelLabel = MODELS.find((m) => m.id === prefs.model)?.label ?? prefs.model;

  const phase = h('p', { class: 'lead', role: 'status', 'aria-live': 'polite' }, PHASES[0]);
  const clock = h('span', { class: 'clock num' }, '0:00');
  const img = h('img', { alt: 'Notenblatt, das gerade gelesen wird', src: images[0]?.url ?? '' });
  const boxes = h('div', { class: 'boxes', 'aria-hidden': 'true' });
  const scan = h('div', { class: 'scan', 'aria-hidden': 'true' });
  // Rahmen genau so groß wie das Foto, damit die Kästchen auf den Takten sitzen
  const stage = h('div', { class: 'page-stage is-scanning' }, h('div', { class: 'page-frame' }, img, boxes, scan));
  const count = h('span', { class: 'count num' }, '0');
  const lastLine = h('code', { class: 'last-measure' }, ' ');
  const pageTabs = h('ol', { class: 'page-tabs', hidden: images.length < 2 },
    ...images.map((im, i) => h('li', { 'data-page': String(i + 1) },
      h('button', { type: 'button', 'aria-label': `Seite ${i + 1} zeigen`, onclick: () => showPage(i + 1) },
        h('img', { src: im.url, alt: '' }), h('span', { class: 'num' }, '0')))));
  const cancel = h('button', { class: 'btn quiet', type: 'button', onclick: () => {
    abort.abort();
    ctx.go('source', { replace: true });
  } }, 'Abbrechen');
  const actions = h('div', { class: 'step-actions' }, cancel);

  root.append(
    h('div', { class: 'step-head' }, h('h1', {}, 'Deine Noten werden gelesen'), phase,
      h('p', { class: 'meta' }, modelLabel, ' · ', clock)),
    h('div', { class: 'reader' },
      stage,
      h('div', { class: 'ticker' },
        h('p', { class: 'ticker-count' }, count, h('span', {}, ' Takte gelesen')),
        lastLine,
        pageTabs,
      ),
    ),
    actions,
  );

  // --- Uhr und Phasen ---
  const started = performance.now();
  const tick = window.setInterval(() => {
    const s = Math.floor((performance.now() - started) / 1000);
    clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (!gotFirst) phase.textContent = PHASES[Math.min(PHASES.length - 1, Math.floor(s / 6))];
  }, 1000);

  // --- Takte nacheinander aufleuchten lassen (Warteschlange, damit Schübe als Kaskade erscheinen) ---
  let gotFirst = false;
  let shownPage = 1;
  const pageCounts = new Map<number, number>();
  const queue: RecognizedMeasure[] = [];
  let draining = false;
  const drain = async () => {
    if (draining) return;
    draining = true;
    while (queue.length && !abort.signal.aborted) {
      reveal(queue.shift()!);
      await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 70));
    }
    draining = false;
  };

  const showPage = (page: number) => {
    if (page === shownPage || !images[page - 1]) return;
    shownPage = page;
    img.src = images[page - 1].url;
    for (const b of boxes.children) (b as HTMLElement).hidden = (b as HTMLElement).dataset.page !== String(page);
    if (!reducedMotion()) img.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 220, easing: EASE_OUT });
  };

  const boxEls: HTMLElement[] = [];
  const place = (el: HTMLElement, b: number[]) => {
    const [y0, x0, y1, x1] = b.map((v) => Math.min(1000, Math.max(0, v)) / 10);
    Object.assign(el.style, { top: `${y0}%`, left: `${x0}%`, height: `${Math.max(1, y1 - y0)}%`, width: `${Math.max(1, x1 - x0)}%` });
    return [y0, x0, y1, x1];
  };

  const reveal = (m: RecognizedMeasure) => {
    const n = Number(count.textContent) + 1;
    count.textContent = String(n);
    lastLine.textContent = `Takt ${m.number}: ${m.content}`;
    const page = m.page || 1;
    pageCounts.set(page, (pageCounts.get(page) ?? 0) + 1);
    const tab = pageTabs.querySelector(`[data-page="${page}"] .num`);
    if (tab) tab.textContent = String(pageCounts.get(page));
    showPage(page);
    if (!m.box || m.box.length !== 4) return;
    const box = h('div', { class: 'mbox', 'data-page': String(page) }, h('span', { class: 'mbox-num num' }, String(m.number)));
    const [, , y1] = place(box, m.box);
    boxEls[n - 1] = box;
    box.hidden = page !== shownPage;
    boxes.append(box);
    // Scanlinie folgt dem zuletzt gelesenen System
    stage.classList.remove('is-scanning');
    scan.style.top = `${y1}%`;
    if (!reducedMotion()) {
      box.animate(
        [{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'none' }],
        { duration: 260, easing: EASE_OUT },
      );
    }
  };

  // --- Erkennung starten ---
  void (async () => {
    try {
      let result = await recognizeSheet(images, {
        apiKey: prefs.apiKey,
        model: prefs.model,
        signal: abort.signal,
        onMeasure: (m) => {
          if (!gotFirst) {
            gotFirst = true;
            phase.textContent = 'Takt für Takt …';
          }
          queue.push(m);
          void drain();
        },
      });
      // gestreamte Takte zu Ende zeigen, dann weiter
      while (queue.length || draining) await new Promise((r) => setTimeout(r, 60));
      if (abort.signal.aborted) return;

      // endgültige Boxen: Takte einer Zeile auf die erkannten Taktstriche verteilt
      result.measures.forEach((m, i) => {
        if (boxEls[i] && m.box) place(boxEls[i], m.box);
      });

      // zweiter Durchgang: jede Zeile gegen den Ausschnitt nachprüfen
      let fixed = 0;
      let failed: number[] = [];
      if (prefs.verify) {
        stage.classList.add('is-scanning');
        const out = await verifySheet(images, result, {
          apiKey: prefs.apiKey,
          model: prefs.model,
          signal: abort.signal,
          onProgress: (done, total) => {
            phase.textContent = total > 1
              ? `Zweiter Durchgang: Gemini prüft jede Zeile nach … (${done} von ${total} Seiten)`
              : 'Zweiter Durchgang: Gemini prüft jede Zeile nach …';
          },
        });
        if (abort.signal.aborted) return;
        stage.classList.remove('is-scanning');
        result = out.result;
        fixed = out.changed.length;
        failed = out.failedPages;
        for (const i of out.changed) {
          boxEls[i]?.classList.add('is-fixed');
          if (!reducedMotion()) boxEls[i]?.animate([{ transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 320, easing: EASE_OUT });
        }
      }
      const { score } = parseNotation(result.notation);
      Object.assign(session, emptySession(), {
        source: 'photo',
        notation: result.notation,
        recognized: result.measures,
        uncertain: result.uncertain,
        detected: result.meta,
      });
      saveSession();
      const u = result.uncertain.length;
      stage.classList.add('is-done');
      const fixedText = prefs.verify ? `, ${fixed ? `${fixed} im zweiten Durchgang korrigiert` : 'zweiter Durchgang ohne Korrektur'}` : '';
      const failedText = failed.length ? ` Seite ${failed.join(', ')} konnte nicht nachgeprüft werden.` : '';
      phase.textContent = `Fertig: ${score.measures.length} Takte${fixedText}${u ? `, ${u} ${u === 1 ? 'Stelle' : 'Stellen'} zum Prüfen` : ', alles klar lesbar'}.${failedText}`;
      clearInterval(tick);
      cancel.remove();
      if (fixed) lastLine.after(h('p', { class: 'help fix-legend' }, 'orange: im zweiten Durchgang korrigiert'));
      const next = h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go(u ? 'review' : 'overview', { replace: true }) },
        u ? 'Unsichere Stellen prüfen' : 'Zum Gesamtbild');
      actions.append(next);
      next.focus({ preventScroll: true });
    } catch (e) {
      if (abort.signal.aborted) return;
      clearInterval(tick);
      stage.classList.remove('is-scanning');
      phase.textContent = (e as Error).message;
      phase.classList.add('error');
      actions.replaceChildren(
        h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go('reading', { replace: true }) }, 'Nochmal versuchen'),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => ctx.go('source', { replace: true }) }, 'Modell oder Fotos ändern'),
      );
    }
  })();

  return () => {
    abort.abort();
    clearInterval(tick);
  };
}
