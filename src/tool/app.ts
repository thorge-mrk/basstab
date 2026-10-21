// BassTab-Werkzeug: Schritt-für-Schritt-Ablauf mit Hash-Routing (#/source, #/review …).

import '@fontsource-variable/tiktok-sans/standard.css';
import './tool.css';
import { h, icon, reducedMotion, toast } from './dom';
import { prefs, session, savePrefs, saveSession, loadImages, resetSession, type StepId } from './state';
import type { PreparedImage } from '../gemini';
import { modelPicker } from './widgets';
import { renderWelcome } from './steps/welcome';
import { renderSource } from './steps/source';
import { renderReading } from './steps/reading';
import { renderReview } from './steps/review';
import { renderOverview } from './steps/overview';
import { renderDetails } from './steps/details';
import { renderDone } from './steps/done';

export interface Ctx {
  go(step: StepId, opts?: { replace?: boolean }): void;
  images: PreparedImage[];
  openSettings(): void;
  openHelp(): void;
}

type StepRender = (root: HTMLElement, ctx: Ctx) => void | (() => void);

const STEPS: Record<StepId, StepRender> = {
  welcome: renderWelcome,
  source: renderSource,
  reading: renderReading,
  review: renderReview,
  overview: renderOverview,
  details: renderDetails,
  done: renderDone,
};

/** Sichtbare Fortschrittsschritte (Willkommen zählt nicht). */
const PROGRESS: { id: StepId; label: string }[] = [
  { id: 'source', label: 'Fotos' },
  { id: 'reading', label: 'Lesen' },
  { id: 'review', label: 'Prüfen' },
  { id: 'overview', label: 'Gesamtbild' },
  { id: 'details', label: 'Angaben' },
  { id: 'done', label: 'PDF' },
];

const root = document.getElementById('step')!;
const progressEl = document.getElementById('progress')!;
let cleanup: (() => void) | void;
let current: StepId | null = null;

const ctx: Ctx = {
  images: [],
  go(step, opts = {}) {
    const hash = `#/${step}`;
    if (opts.replace) history.replaceState(null, '', hash);
    else if (location.hash !== hash) history.pushState(null, '', hash);
    show(step);
  },
  openSettings,
  openHelp: () => (document.getElementById('dlg-help') as HTMLDialogElement).showModal(),
};

function stepFromHash(): StepId {
  const id = location.hash.replace(/^#\/?/, '') as StepId;
  return id in STEPS ? id : (session.step ?? 'source');
}

/** Darf dieser Schritt mit dem aktuellen Stand angezeigt werden? Sonst den passenden nehmen. */
function guard(step: StepId): StepId {
  if (!prefs.onboarded && step !== 'welcome') return 'welcome';
  const has = !!session.notation.trim();
  if (step === 'reading' && !ctx.images.length) return has ? 'overview' : 'source';
  if (['review', 'overview', 'details', 'done'].includes(step) && !has) return 'source';
  if (step === 'review' && !session.uncertain.length) return 'overview';
  return step;
}

function show(requested: StepId) {
  const step = guard(requested);
  if (step !== requested) history.replaceState(null, '', `#/${step}`);
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  const prev = current;
  current = step;
  if (step !== 'reading') {
    session.step = step;
    saveSession();
  }
  renderProgress(step);

  const swap = () => {
    root.replaceChildren();
    root.dataset.step = step;
    cleanup = STEPS[step](root, ctx);
    root.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  };
  // Schrittwechsel: kurzer Übergang in Leserichtung (seltene Aktion, darf animieren)
  const forward = !prev || PROGRESS.findIndex((p) => p.id === step) >= PROGRESS.findIndex((p) => p.id === prev);
  if (prev && 'startViewTransition' in document && !reducedMotion()) {
    document.documentElement.dataset.dir = forward ? 'fwd' : 'back';
    (document as Document & { startViewTransition(cb: () => void): unknown }).startViewTransition(swap);
  } else swap();
}

function renderProgress(step: StepId) {
  const idx = PROGRESS.findIndex((p) => p.id === step);
  progressEl.style.visibility = step === 'welcome' ? 'hidden' : '';
  progressEl.replaceChildren(
    h('ol', {}, ...PROGRESS.map((p, i) =>
      h('li', { class: i < idx ? 'done' : i === idx ? 'current' : '', 'aria-current': i === idx ? 'step' : null },
        h('span', { class: 'label' }, p.label))),
    ),
    h('p', { class: 'progress-compact', 'aria-hidden': 'true' }, idx >= 0 ? `${PROGRESS[idx].label} · ${idx + 1}/${PROGRESS.length}` : ''),
  );
}

// --- Einstellungen ----------------------------------------------------------

function openSettings() {
  const dlg = document.getElementById('dlg-settings') as HTMLDialogElement;
  const body = dlg.querySelector('.dlg-body')!;
  const keyInput = h('input', { type: 'password', id: 'set-key', autocomplete: 'off', spellcheck: 'false', value: prefs.apiKey, placeholder: 'AIza…' });
  const picker = modelPicker(prefs.model);
  body.replaceChildren(
    h('label', { class: 'field', for: 'set-key' }, 'Google-AI-Studio-API-Key'),
    h('div', { class: 'input-row' }, keyInput,
      h('button', { class: 'btn quiet icon-only', type: 'button', 'aria-label': 'Key anzeigen', onclick: () => {
        keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      } }, icon('eye'))),
    h('p', { class: 'help' }, 'Bleibt nur in diesem Browser. ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'Key erstellen')),
    h('p', { class: 'field' }, 'Modell'),
    picker.el,
    h('div', { class: 'danger-zone' },
      h('p', {}, 'Alles aus diesem Browser löschen: Key, Fotos, aktuelles Stück.'),
      h('button', { class: 'btn quiet danger', type: 'button', onclick: () => {
        if (!confirm('Key, Fotos und das aktuelle Stück wirklich löschen?')) return;
        prefs.apiKey = '';
        prefs.onboarded = false;
        savePrefs();
        resetSession();
        ctx.images = [];
        dlg.close();
        ctx.go('welcome', { replace: true });
      } }, icon('trash', 18), 'Alles löschen')),
  );
  dlg.onclose = () => {
    if (dlg.returnValue !== 'save') return;
    prefs.apiKey = keyInput.value.trim();
    prefs.model = picker.value();
    savePrefs();
    toast('Gespeichert');
    if (current === 'source') show('source');
  };
  dlg.showModal();
}

// --- Start ------------------------------------------------------------------

document.getElementById('btn-settings')!.addEventListener('click', openSettings);
document.getElementById('btn-help')!.addEventListener('click', ctx.openHelp);
window.addEventListener('popstate', () => show(stepFromHash()));

loadImages().then((imgs) => {
  ctx.images = imgs;
  show(stepFromHash());
});
