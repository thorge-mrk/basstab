// Wiederverwendbare Bausteine: Modellwahl, Mini-Takt-Vorschau, Takt-Editor.

import { h } from './dom';
import { MODELS } from '../gemini';
import { ScoreView } from '../render';
import { parseNotation } from '../score';
import { texFor } from './measure';
import { prefs } from './state';

/** Auswahl des KI-Modells als Liste (Radio), plus eigene Modell-ID. */
export function modelPicker(initial: string): { el: HTMLElement; value: () => string } {
  const name = `model-${Math.random().toString(36).slice(2, 7)}`;
  const known = MODELS.some((m) => m.id === initial);
  const custom = h('input', { type: 'text', class: 'model-custom', placeholder: 'z. B. gemini-3.5-flash', 'aria-label': 'Eigene Modell-ID', value: known ? '' : initial });
  const radios: HTMLInputElement[] = [];
  const row = (id: string, label: string, hint: string) => {
    const r = h('input', { type: 'radio', name, value: id, checked: known ? id === initial : id === 'custom' });
    radios.push(r);
    return h('label', { class: 'choice' }, r, h('span', { class: 'choice-text' }, h('strong', {}, label), h('span', {}, hint)));
  };
  const el = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'KI-Modell' },
    ...MODELS.map((m) => row(m.id, m.label, m.hint)),
    row('custom', 'Eigenes Modell', 'jede Gemini-Modell-ID'),
    custom,
  );
  const sync = () => (custom.hidden = !radios.find((r) => r.value === 'custom')?.checked);
  el.addEventListener('change', sync);
  sync();
  return {
    el,
    value: () => {
      const v = radios.find((r) => r.checked)?.value ?? MODELS[0].id;
      return v === 'custom' ? custom.value.trim() || MODELS[0].id : v;
    },
  };
}

/** Rendert eine kleine Notation (ein Takt) als Noten + Tab. */
export class MiniScore {
  readonly el = h('div', { class: 'mini-score' });
  private view: ScoreView | null = null;
  private pending = '';
  private timer = 0;

  set(notation: string) {
    this.pending = notation;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), 120);
  }

  private flush() {
    const { diagnostics } = parseNotation(this.pending);
    const bad = diagnostics.find((d) => d.severity === 'error');
    const r = bad ? null : texFor(this.pending, prefs, true);
    if (!r) {
      this.el.dataset.state = 'invalid';
      this.el.setAttribute('data-msg', bad ? bad.message : 'Keine Noten');
      return;
    }
    this.el.dataset.state = 'ok';
    if (!this.view) this.view = new ScoreView(this.el, { bare: true, scale: 0.85 });
    this.view.render(r.tex);
  }

  destroy() {
    clearTimeout(this.timer);
    this.view?.destroy();
    this.view = null;
  }
}
