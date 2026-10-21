import { parseNotation, serializeNotation, type Diagnostic, type Score } from './score';
import { computeFingering, DEFAULT_SETUP, TUNINGS, type BassSetup } from './fingering';
import { toAlphaTex } from './alphatex';
import { Preview, exportPdf } from './render';
import { DEFAULT_MODEL, MODELS, prepareImage, recognizeSheet } from './gemini';
import { parseMusicXml } from './musicxml';
import { DEMO } from './demo';

// ---------------------------------------------------------------------------
// Persistenz (nur localStorage dieses Browsers)

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`basstab.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`basstab.${key}`, value);
    } catch {
      /* privates Fenster o. ä. */
    }
  },
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const editor = $<HTMLTextAreaElement>('#editor');
const diagsEl = $('#diags');
const diagBadge = $('#diag-badge');
const pdfBtn = $<HTMLButtonElement>('#btn-pdf');
const emptyEl = $('#empty');
const toastEl = $('#toast');

const opts = {
  tuning: $<HTMLSelectElement>('#opt-tuning'),
  technique: $<HTMLSelectElement>('#opt-technique'),
  open: $<HTMLSelectElement>('#opt-open'),
  position: $<HTMLSelectElement>('#opt-position'),
  maxFret: $<HTMLSelectElement>('#opt-maxfret'),
  bars: $<HTMLSelectElement>('#opt-bars'),
  view: $<HTMLSelectElement>('#opt-view'),
  zoom: $<HTMLSelectElement>('#opt-zoom'),
};

for (const [id, t] of Object.entries(TUNINGS)) opts.tuning.add(new Option(t.label, id));
if (window.innerWidth < 600) opts.zoom.value = '0.85';
for (const [name, el] of Object.entries(opts)) {
  const saved = store.get(`opt.${name}`);
  if (saved !== null && [...el.options].some((o) => o.value === saved)) el.value = saved;
  el.addEventListener('change', () => {
    store.set(`opt.${name}`, el.value);
    scheduleRender(0);
  });
}

function currentSetup(): BassSetup {
  return {
    ...DEFAULT_SETUP,
    tuning: TUNINGS[opts.tuning.value]?.tuning ?? DEFAULT_SETUP.tuning,
    technique: opts.technique.value as BassSetup['technique'],
    openStrings: opts.open.value as BassSetup['openStrings'],
    lowPositionBias: Number(opts.position.value),
    maxFret: Number(opts.maxFret.value),
  };
}

// ---------------------------------------------------------------------------
// Toast

let toastTimer = 0;
function toast(msg: string, kind: 'info' | 'error' = 'info') {
  toastEl.textContent = msg;
  toastEl.className = `toast ${kind === 'error' ? 'error' : ''}`;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), kind === 'error' ? 8000 : 3500);
}

// ---------------------------------------------------------------------------
// Rendering

const preview = new Preview($('#alphatab'));
let lastTex = '';
let lastScore: Score | null = null;
let barToMeasure: number[] = [];
let uncertain: { measure: number; note: string }[] = [];
try {
  uncertain = JSON.parse(store.get('uncertain') ?? '[]');
} catch {
  uncertain = [];
}

preview.onBarClick = (bar) => {
  const mi = barToMeasure[bar];
  if (mi === undefined || !lastScore) return;
  gotoLine(lastScore.measures[mi].line);
};
preview.onError = (msg) => toast(`Darstellungsfehler: ${msg}`, 'error');

let renderTimer = 0;
function scheduleRender(delay = 350) {
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(renderNow, delay);
}

function renderNow() {
  const src = editor.value;
  store.set('notation', src);
  if (!src.trim()) {
    emptyEl.hidden = false;
    $('#alphatab').hidden = true;
    pdfBtn.disabled = true;
    showDiagnostics([]);
    lastScore = null;
    return;
  }
  const { score, diagnostics } = parseNotation(src);
  const setup = currentSetup();
  const fing = computeFingering(score, setup);
  const all = [...diagnostics, ...fing.diagnostics];
  showDiagnostics(all, score);

  if (score.measures.length === 0) {
    emptyEl.hidden = false;
    $('#alphatab').hidden = true;
    pdfBtn.disabled = true;
    return;
  }
  barToMeasure = score.measures.flatMap((m, i) => Array(m.multiRest ?? 1).fill(i));
  lastScore = score;
  const view = opts.view.value;
  lastTex = toAlphaTex(score, fing.fingering, setup, { showNotation: view !== 'tab', showTab: view !== 'score' });
  emptyEl.hidden = true;
  $('#alphatab').hidden = false;
  preview.render(lastTex, Number(opts.zoom.value), Number(opts.bars.value));
  pdfBtn.disabled = false;
}

function showDiagnostics(diags: Diagnostic[], score?: Score) {
  diagsEl.replaceChildren();
  const items: { sev: string; line?: number; text: string }[] = diags.map((d) => ({ sev: d.severity, line: d.line, text: d.message }));

  if (score && uncertain.length) {
    // gedruckte Taktnummer → Index (Mehrtaktpausen zählen mehrfach)
    const lineOf = new Map<number, number>();
    let n = 1;
    score.measures.forEach((m) => {
      lineOf.set(n, m.line);
      n += m.multiRest ?? 1;
    });
    for (const u of uncertain) items.push({ sev: 'info', line: lineOf.get(u.measure), text: `Takt ${u.measure} prüfen: ${u.note}` });
  }

  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.length - errors;
  diagBadge.hidden = !editor.value.trim();
  diagBadge.className = `badge ${errors ? 'err' : warnings ? '' : 'ok'}`;
  diagBadge.textContent = errors ? `${errors} Fehler` : warnings ? `${warnings} Hinweis${warnings > 1 ? 'e' : ''}` : 'Alles stimmig';

  for (const it of items) {
    const li = document.createElement('li');
    const sev = document.createElement('span');
    sev.className = `sev ${it.sev}`;
    sev.textContent = it.sev === 'error' ? 'Fehler' : it.sev === 'warning' ? 'Hinweis' : 'Prüfen';
    const ln = document.createElement('span');
    ln.className = 'ln';
    ln.textContent = it.line ? `Z.${it.line}` : '';
    const txt = document.createElement('span');
    txt.textContent = it.text;
    li.append(sev, ln, txt);
    if (it.line) li.addEventListener('click', () => gotoLine(it.line!));
    diagsEl.append(li);
  }
}

function gotoLine(line: number) {
  const lines = editor.value.split('\n');
  let start = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
  const end = start + (lines[line - 1]?.length ?? 0);
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(start, end);
  const lh = parseFloat(getComputedStyle(editor).lineHeight) || 20;
  editor.scrollTop = Math.max(0, (line - 3) * lh);
  if (window.innerWidth <= 920) editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

editor.addEventListener('input', () => scheduleRender());

function setNotation(text: string, newUncertain: { measure: number; note: string }[] = []) {
  if (editor.value.trim() && editor.value !== text) store.set('notation.previous', editor.value);
  editor.value = text;
  uncertain = newUncertain;
  store.set('uncertain', JSON.stringify(uncertain));
  renderNow();
}

// ---------------------------------------------------------------------------
// Tabs

document.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', String(b === btn));
    });
    document.querySelectorAll<HTMLElement>('.tab-pane').forEach((p) => (p.hidden = p.dataset.pane !== btn.dataset.tab));
  }),
);

// ---------------------------------------------------------------------------
// Fotos

interface Photo {
  file: File;
  url: string;
}
const photos: Photo[] = [];
const thumbs = $('#thumbs');
const recogBtn = $<HTMLButtonElement>('#btn-recognize');
const cancelBtn = $<HTMLButtonElement>('#btn-cancel');
const statusEl = $('#recog-status');
const dropzone = $('#dropzone');

function addPhotos(files: Iterable<File>) {
  for (const f of files) {
    if (!f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) continue;
    photos.push({ file: f, url: URL.createObjectURL(f) });
  }
  renderThumbs();
}

function renderThumbs() {
  thumbs.replaceChildren(
    ...photos.map((p, i) => {
      const li = document.createElement('li');
      li.className = 'thumb';
      const img = document.createElement('img');
      img.src = p.url;
      img.alt = `Seite ${i + 1}`;
      img.addEventListener('click', () => openPhoto(p.url));
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i + 1);
      const tools = document.createElement('div');
      tools.className = 'tools';
      const mk = (label: string, title: string, fn: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.setAttribute('aria-label', title);
        b.addEventListener('click', fn);
        return b;
      };
      if (i > 0)
        tools.append(
          mk('←', 'Nach vorne', () => {
            [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]];
            renderThumbs();
          }),
        );
      tools.append(
        mk('✕', 'Entfernen', () => {
          URL.revokeObjectURL(p.url);
          photos.splice(i, 1);
          renderThumbs();
        }),
      );
      li.append(img, num, tools);
      return li;
    }),
  );
  recogBtn.disabled = photos.length === 0;
  updateKeyHint();
}

function openPhoto(url: string) {
  $<HTMLImageElement>('#photo-full').src = url;
  $<HTMLDialogElement>('#dlg-photo').showModal();
}

$<HTMLInputElement>('#file-photos').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files) addPhotos(input.files);
  input.value = '';
});
['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  }),
);
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('drag')));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files) addPhotos(e.dataTransfer.files);
});

// Modellauswahl
const modelSelect = $<HTMLSelectElement>('#model-select');
const modelCustom = $<HTMLInputElement>('#model-custom');
for (const m of MODELS) modelSelect.add(new Option(m.label, m.id));
modelSelect.add(new Option('Eigenes Modell…', 'custom'));
{
  const saved = store.get('model') || DEFAULT_MODEL;
  if (MODELS.some((m) => m.id === saved)) modelSelect.value = saved;
  else {
    modelSelect.value = 'custom';
    modelCustom.value = saved;
    modelCustom.hidden = false;
  }
}
function selectedModel(): string {
  return modelSelect.value === 'custom' ? modelCustom.value.trim() || DEFAULT_MODEL : modelSelect.value;
}
modelSelect.addEventListener('change', () => {
  modelCustom.hidden = modelSelect.value !== 'custom';
  if (!modelCustom.hidden) modelCustom.focus();
  store.set('model', selectedModel());
});
modelCustom.addEventListener('change', () => store.set('model', selectedModel()));

function updateKeyHint() {
  $('#key-hint').hidden = !!store.get('apiKey') || photos.length === 0;
}

let abort: AbortController | null = null;

recogBtn.addEventListener('click', async () => {
  const apiKey = store.get('apiKey');
  if (!apiKey) {
    openSettings();
    return;
  }
  if (editor.value.trim() && !confirm('Die aktuelle Notation wird durch das Erkennungsergebnis ersetzt. Fortfahren?')) return;

  abort = new AbortController();
  recogBtn.disabled = true;
  cancelBtn.hidden = false;
  statusEl.className = 'status busy';
  statusEl.textContent = 'Bilder vorbereiten…';
  const started = performance.now();
  try {
    const prepared = await Promise.all(photos.map((p) => prepareImage(p.file)));
    statusEl.textContent = `${modelSelect.selectedOptions[0]?.text.replace(/ \(.*\)$/, '') ?? 'Gemini'} liest die Noten… (kann 30–90 s dauern)`;
    const model = selectedModel();
    const result = await recognizeSheet(
      prepared,
      apiKey,
      model,
      (chars) => (statusEl.textContent = `Empfange Ergebnis… ${chars.toLocaleString('de-DE')} Zeichen`),
      abort.signal,
    );
    setNotation(result.notation, result.uncertain);
    const secs = Math.round((performance.now() - started) / 1000);
    statusEl.className = 'status';
    statusEl.textContent = `Fertig in ${secs} s. Bitte Takt für Takt mit dem Foto vergleichen.`;
  } catch (e) {
    statusEl.className = 'status';
    if (abort?.signal.aborted) statusEl.textContent = 'Abgebrochen.';
    else {
      statusEl.textContent = '';
      toast((e as Error).message, 'error');
    }
  } finally {
    abort = null;
    recogBtn.disabled = photos.length === 0;
    cancelBtn.hidden = true;
  }
});
cancelBtn.addEventListener('click', () => abort?.abort());

// ---------------------------------------------------------------------------
// MusicXML + Beispiel

$<HTMLInputElement>('#file-xml').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.name.toLowerCase().endsWith('.mxl')) {
    toast('Komprimierte .mxl-Dateien bitte als unkomprimiertes .musicxml exportieren.', 'error');
    return;
  }
  try {
    const score = parseMusicXml(await file.text());
    setNotation(serializeNotation(score));
    toast(`${score.measures.length} Takte importiert`);
  } catch (err) {
    toast(`Import fehlgeschlagen: ${(err as Error).message}`, 'error');
  }
});

$('#btn-demo').addEventListener('click', () => {
  if (editor.value.trim() && !confirm('Aktuelle Notation durch das Beispiel ersetzen?')) return;
  setNotation(DEMO);
});

// ---------------------------------------------------------------------------
// PDF

pdfBtn.addEventListener('click', async () => {
  if (!lastTex || !lastScore) return;
  pdfBtn.disabled = true;
  const label = pdfBtn.lastChild!;
  const old = label.textContent;
  label.textContent = ' PDF wird erstellt…';
  try {
    const base = (lastScore.title || 'bass-tab').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase();
    const footer = [lastScore.title, lastScore.composer].filter(Boolean).join(' – ') || 'Bass-Tab';
    await exportPdf(lastTex, `${base}-bass-tab.pdf`, Number(opts.bars.value), footer);
  } catch (e) {
    toast(`PDF-Export fehlgeschlagen: ${(e as Error).message}`, 'error');
  } finally {
    label.textContent = old;
    pdfBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Dialoge

const dlgSettings = $<HTMLDialogElement>('#dlg-settings');
function openSettings() {
  $<HTMLInputElement>('#set-key').value = store.get('apiKey') ?? '';
  dlgSettings.showModal();
}
dlgSettings.addEventListener('close', () => {
  if (dlgSettings.returnValue !== 'save') return;
  store.set('apiKey', $<HTMLInputElement>('#set-key').value.trim());
  updateKeyHint();
  toast('Einstellungen gespeichert');
});
$('#btn-settings').addEventListener('click', openSettings);
document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-open-settings]')) openSettings();
});
$('#btn-help').addEventListener('click', () => $<HTMLDialogElement>('#dlg-help').showModal());

// ---------------------------------------------------------------------------
// Start

editor.value = store.get('notation') ?? '';
renderNow();
