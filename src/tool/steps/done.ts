// Schritt 6: PDF im Browser setzen, Vorschau, Herunterladen oder Teilen.

import { append, h, icon, toast } from '../dom';
import { prefs, session, resetSession } from '../state';
import { parseNotation } from '../../score';
import { buildPdf } from '../../render';
import { texFor } from '../measure';
import type { Ctx } from '../app';

export function renderDone(root: HTMLElement, ctx: Ctx) {
  const { score } = parseNotation(session.notation);
  const status = h('p', { class: 'lead', role: 'status' }, 'Das PDF wird gesetzt …');
  const sheet = h('div', { class: 'pdf-preview is-loading', 'aria-busy': 'true' });
  const actions = h('div', { class: 'step-actions' });
  let url = '';
  let alive = true;

  const base = (score.title || 'bass-tab').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'bass-tab';
  const fileName = `${base}-bass-tab.pdf`;
  const footer = [score.title, score.composer].filter(Boolean).join(' – ') || 'Bass-Tab';

  root.append(
    h('div', { class: 'step-head' }, h('h1', {}, score.title || 'Dein Bass-Tab'), status),
    h('div', { class: 'done-grid' }, sheet, actions),
  );

  void (async () => {
    try {
      const r = texFor(session.notation, prefs);
      if (!r) throw new Error('Keine Noten vorhanden.');
      const pdf = await buildPdf(r.tex, prefs.barsPerRow, footer);
      if (!alive) return;
      url = URL.createObjectURL(pdf.blob);
      const file = new File([pdf.blob], fileName, { type: 'application/pdf' });
      sheet.classList.remove('is-loading');
      sheet.removeAttribute('aria-busy');
      sheet.replaceChildren(h('img', { src: pdf.previewUrl, alt: `Erste Seite von ${score.title || 'deinem Tab'}` }));
      status.textContent = `${pdf.pages} ${pdf.pages === 1 ? 'Seite' : 'Seiten'} · A4 · Noten und Tab`;

      const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
      append(actions, [
        h('a', { class: 'btn primary', href: url, download: fileName }, icon('download', 18), 'PDF herunterladen'),
        canShare ? h('button', { class: 'btn', type: 'button', onclick: async () => {
          try {
            await navigator.share({ files: [file], title: score.title || 'Bass-Tab' });
          } catch (e) {
            if ((e as Error).name !== 'AbortError') toast('Teilen hat nicht geklappt.', 'error');
          }
        } }, icon('share', 18), 'Teilen') : null,
        h('a', { class: 'btn quiet', href: url, target: '_blank', rel: 'noopener' }, 'Im Browser öffnen'),
        h('hr', { class: 'sep' }),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => ctx.go('overview') }, icon('left', 18), 'Noch etwas ändern'),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => {
          if (!confirm('Neues Blatt beginnen? Das aktuelle Stück wird verworfen.')) return;
          resetSession();
          ctx.images = [];
          ctx.go('source');
        } }, 'Neues Blatt'),
      ]);
    } catch (e) {
      if (!alive) return;
      sheet.classList.remove('is-loading');
      status.textContent = `PDF konnte nicht erstellt werden: ${(e as Error).message}`;
      status.classList.add('error');
      actions.append(
        h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go('done', { replace: true }) }, icon('refresh', 18), 'Nochmal versuchen'),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => ctx.go('overview') }, 'Zurück'),
      );
    }
  })();

  return () => {
    alive = false;
    if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
}
