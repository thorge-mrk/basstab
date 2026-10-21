// Schritt 4: Gesamtbild – alle Noten + Tab, Griffbild einstellen, jeden Takt antippen und korrigieren.

import { h, icon } from '../dom';
import { prefs, savePrefs, session, saveSession } from '../state';
import { parseNotation, keyName, type Diagnostic, type Score } from '../../score';
import { computeFingering, TUNINGS } from '../../fingering';
import { ScoreView } from '../../render';
import { MiniScore } from '../widgets';
import { barMaps, cropMeasure, measureContent, measureIndexForNumber, replaceMeasure, setupFromPrefs, snippet, texFor } from '../measure';
import type { Ctx } from '../app';

const KEY_DE: Record<string, string> = {
  Cb: 'Ces', Gb: 'Ges', Db: 'Des', Ab: 'As', Eb: 'Es', Bb: 'B', F: 'F', C: 'C', G: 'G', D: 'D', A: 'A', E: 'E', B: 'H', 'F#': 'Fis', 'C#': 'Cis',
};

export function renderOverview(root: HTMLElement, ctx: Ctx) {
  const paper = h('div', { class: 'paper', tabindex: '-1' });
  const scoreHost = h('div', { class: 'score-host' });
  paper.append(scoreHost);
  const view = new ScoreView(scoreHost, { scale: zoomFor(), barsPerRow: prefs.barsPerRow });
  const summary = h('p', { class: 'meta' });
  const hints = h('ul', { class: 'hints' });
  const hintsHead = h('h2', { class: 'hints-head' });
  let score: Score | null = null;
  let maps = { barToMeasure: [] as number[], measureToBar: [] as number[] };

  view.onBarClick = (bar) => {
    const mi = maps.barToMeasure[bar];
    if (mi !== undefined) openMeasure(mi);
  };
  view.onError = (msg) => {
    summary.textContent = `Darstellungsfehler: ${msg}`;
  };

  // --- Griffbild & Anzeige ---
  const sel = (id: string, label: string, value: string, opts: [string, string][], onChange: (v: string) => void) => {
    const s = h('select', { id });
    for (const [v, t] of opts) s.add(new Option(t, v, false, v === value));
    s.addEventListener('change', () => {
      onChange(s.value);
      savePrefs();
      refresh();
    });
    return h('div', { class: 'control' }, h('label', { for: id }, label), s);
  };
  const controls = h('div', { class: 'controls' },
    sel('o-tuning', 'Bass', prefs.tuning, Object.entries(TUNINGS).map(([k, t]) => [k, t.label]), (v) => (prefs.tuning = v)),
    sel('o-tech', 'Technik', prefs.technique, [['ofpf', '1 Finger pro Bund'], ['simandl', 'Simandl (1-2-4)']], (v) => (prefs.technique = v as typeof prefs.technique)),
    sel('o-open', 'Leersaiten', prefs.openStrings, [['neutral', 'normal'], ['prefer', 'bevorzugen'], ['avoid', 'vermeiden']], (v) => (prefs.openStrings = v as typeof prefs.openStrings)),
    sel('o-pos', 'Lage', String(prefs.lowPositionBias), [['1', 'eher tief'], ['2.5', 'möglichst tief'], ['0.3', 'flexibel']], (v) => (prefs.lowPositionBias = Number(v))),
    sel('o-fret', 'Max. Bund', String(prefs.maxFret), [['12', '12'], ['15', '15'], ['20', '20'], ['24', '24']], (v) => (prefs.maxFret = Number(v))),
    sel('o-view', 'Anzeige', prefs.view, [['both', 'Noten + Tab'], ['tab', 'nur Tab'], ['score', 'nur Noten']], (v) => (prefs.view = v as typeof prefs.view)),
    sel('o-bars', 'Takte pro Zeile', String(prefs.barsPerRow), [['-1', 'automatisch'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6']], (v) => (prefs.barsPerRow = Number(v))),
  );

  // --- Profi: ganzer Text ---
  const textarea = h('textarea', { class: 'code-area', spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Notation als Text' });
  textarea.value = session.notation;
  let typing = 0;
  textarea.addEventListener('input', () => {
    clearTimeout(typing);
    typing = window.setTimeout(() => {
      session.notation = textarea.value;
      saveSession();
      refresh();
    }, 350);
  });
  const textBox = h('details', { class: 'text-edit' },
    h('summary', {}, icon('edit', 18), 'Ganzen Text bearbeiten'),
    h('p', { class: 'help' }, 'Für Profis: die komplette Notation. ', h('button', { class: 'link', type: 'button', onclick: () => ctx.openHelp() }, 'Notation-Hilfe')),
    textarea,
  );

  function zoomFor() {
    return window.innerWidth < 600 ? 0.8 : 1;
  }

  function refresh() {
    const parsed = parseNotation(session.notation);
    score = parsed.score;
    maps = barMaps(score);
    const setup = setupFromPrefs(prefs);
    const fing = computeFingering(score, setup);
    const r = texFor(session.notation, prefs);
    if (r) view.render(r.tex, { scale: zoomFor(), barsPerRow: prefs.barsPerRow });
    const n = score.measures.reduce((s, m) => s + (m.multiRest ?? 1), 0);
    const key = KEY_DE[keyName(score.key)] ?? keyName(score.key);
    summary.textContent = `${n} Takte · ${key}-Dur / ${parsedMinor(score.key)} · ${score.time[0]}/${score.time[1]}${score.tempo ? ` · Tempo ${score.tempo}` : ''}`;
    drawHints([...parsed.diagnostics, ...fing.diagnostics]);
  }

  function drawHints(diags: Diagnostic[]) {
    const items: { text: string; measure?: number; kind: string }[] = diags.map((d) => ({ text: d.message, measure: d.measure, kind: d.severity }));
    session.uncertain.forEach((u, i) => {
      if (session.reviewed[i] === 'skipped') {
        items.push({ text: `Takt ${u.measure}: ${u.question}`, measure: measureIndexForNumber(session.recognized, u.measure) + 1, kind: 'check' });
      }
    });
    hintsHead.textContent = items.length ? `${items.length} ${items.length === 1 ? 'Hinweis' : 'Hinweise'}` : 'Keine Hinweise – jeder Takt geht auf.';
    hints.replaceChildren(...items.map((it) =>
      h('li', { class: it.kind },
        h('button', { type: 'button', disabled: !it.measure, onclick: () => it.measure && openMeasure(it.measure - 1) },
          h('span', { class: 'hint-kind' }, it.kind === 'error' ? 'Fehler' : it.kind === 'check' ? 'Prüfen' : 'Hinweis'),
          h('span', {}, it.text)))));
  }

  // --- Takt-Editor als Bottom-Sheet ---
  const sheet = h('dialog', { class: 'sheet', 'aria-labelledby': 'sheet-title' });
  document.body.append(sheet);
  let sheetMini: MiniScore | null = null;

  function openMeasure(mi: number) {
    if (!score || !score.measures[mi]) return;
    view.mark(maps.measureToBar[mi] ?? null);
    const current = measureContent(session.notation, mi);
    const rec = session.recognized[mi];
    const img = rec ? ctx.images[(rec.page || 1) - 1] : undefined;
    const input = h('input', { type: 'text', class: 'code-input', spellcheck: 'false', autocapitalize: 'off', value: current, 'aria-label': `Takt ${mi + 1} bearbeiten` });
    sheetMini?.destroy();
    sheetMini = new MiniScore();
    const s = score;
    sheetMini.set(snippet(s, mi, current));
    input.addEventListener('input', () => sheetMini!.set(snippet(s, mi, input.value)));
    const photo = h('figure', { class: 'crop small' });
    if (img?.url && rec?.box) {
      const el = h('img', { alt: `Takt ${mi + 1} im Foto` });
      void cropMeasure(img, rec.box).then((url) => (el.src = url));
      photo.append(el, h('figcaption', {}, 'Im Foto'));
    } else photo.hidden = true;

    sheet.replaceChildren(
      h('form', { method: 'dialog' },
        h('div', { class: 'sheet-head' },
          h('h2', { id: 'sheet-title' }, `Takt ${printedNumber(mi)}`),
          h('button', { class: 'btn quiet icon-only', value: 'cancel', 'aria-label': 'Schließen' }, icon('close'))),
        photo,
        h('p', { class: 'reading-label' }, 'So steht er im Blatt'),
        sheetMini.el,
        input,
        h('p', { class: 'help' }, 'Beispiele: ', h('code', {}, 'F3/4. C3 F3/4~'), ' · ', h('code', {}, 'C3@4'), ' erzwingt die E-Saite · ',
          h('button', { class: 'link', type: 'button', onclick: () => ctx.openHelp() }, 'alle Zeichen')),
        h('div', { class: 'step-actions' },
          h('button', { class: 'btn primary', value: 'save' }, 'Speichern'),
          h('button', { class: 'btn quiet', value: 'cancel' }, 'Abbrechen')),
      ),
    );
    sheet.onclose = () => {
      sheetMini?.destroy();
      sheetMini = null;
      view.mark(null);
      if (sheet.returnValue === 'save' && input.value.trim() !== current) {
        session.notation = replaceMeasure(session.notation, mi, input.value);
        textarea.value = session.notation;
        saveSession();
        refresh();
      }
    };
    sheet.returnValue = '';
    sheet.showModal();
    input.focus();
  }

  function printedNumber(mi: number) {
    return session.recognized[mi]?.number ?? (score ? score.measures.slice(0, mi).reduce((n, m) => n + (m.multiRest ?? 1), 1) : mi + 1);
  }

  root.append(
    h('div', { class: 'step-head' },
      h('h1', {}, 'Gesamtbild prüfen'),
      h('p', { class: 'lead' }, 'Lies einmal drüber. Tipp auf einen Takt, um ihn mit dem Foto zu vergleichen und zu korrigieren.'),
      summary,
    ),
    h('details', { class: 'controls-box', open: window.innerWidth >= 900 },
      h('summary', {}, 'Griffbild und Anzeige'), controls),
    paper,
    h('section', { class: 'hints-box', 'aria-live': 'polite' }, hintsHead, hints),
    textBox,
    h('div', { class: 'step-actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go('details') }, 'Weiter zu den Angaben'),
      session.uncertain.length ? h('button', { class: 'btn quiet', type: 'button', onclick: () => {
        session.reviewed = {};
        saveSession();
        ctx.go('review');
      } }, 'Unsichere Stellen nochmal') : null,
    ),
  );
  refresh();

  let w = window.innerWidth;
  const onResize = () => {
    if (Math.abs(window.innerWidth - w) < 80) return;
    w = window.innerWidth;
    refresh();
  };
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    sheetMini?.destroy();
    view.destroy();
    sheet.remove();
  };
}

const MINOR: Record<number, string> = { [-7]: 'as', [-6]: 'es', [-5]: 'b', [-4]: 'f', [-3]: 'c', [-2]: 'g', [-1]: 'd', 0: 'a', 1: 'e', 2: 'h', 3: 'fis', 4: 'cis', 5: 'gis', 6: 'dis', 7: 'ais' };
function parsedMinor(fifths: number) {
  return `${MINOR[fifths]}-Moll`;
}
