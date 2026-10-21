// Schritt 1: Fotos aufnehmen/auswählen, Modell wählen. Alternativ MusicXML oder Beispiel.

import { append, h, icon, toast } from '../dom';
import { prefs, savePrefs, session, saveSession, saveImages, emptySession } from '../state';
import { MODELS, prepareImage } from '../../gemini';
import { parseMusicXml } from '../../musicxml';
import { serializeNotation } from '../../score';
import { DEMO } from '../../demo';
import type { Ctx } from '../app';

export function renderSource(root: HTMLElement, ctx: Ctx) {
  const thumbs = h('ol', { class: 'thumbs', 'aria-label': 'Seiten' });
  const readBtn = h('button', { class: 'btn primary', type: 'button' });
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const gallery = h('input', { type: 'file', accept: 'image/*,.heic,.heif', multiple: true, hidden: true });
  const xml = h('input', { type: 'file', accept: '.musicxml,.xml,application/vnd.recordare.musicxml+xml,text/xml', hidden: true });
  const busy = h('p', { class: 'status', role: 'status' });

  const update = () => {
    thumbs.replaceChildren(...ctx.images.map((img, i) =>
      h('li', { class: 'thumb' },
        img.url ? h('img', { src: img.url, alt: `Seite ${i + 1}` }) : h('span', { class: 'thumb-placeholder' }, 'HEIC'),
        h('span', { class: 'thumb-num' }, String(i + 1)),
        h('span', { class: 'thumb-tools' },
          i > 0 ? h('button', { type: 'button', 'aria-label': `Seite ${i + 1} nach vorne`, onclick: () => move(i, -1) }, icon('left', 16)) : null,
          h('button', { type: 'button', 'aria-label': `Seite ${i + 1} entfernen`, onclick: () => remove(i) }, icon('close', 16)),
        ),
      )));
    const n = ctx.images.length;
    readBtn.disabled = n === 0;
    readBtn.textContent = !prefs.apiKey ? 'Erst Key eintragen' : n === 0 ? 'Noten lesen' : `Noten lesen (${n} ${n === 1 ? 'Seite' : 'Seiten'})`;
    if (!prefs.apiKey) readBtn.disabled = false;
    dropzone.classList.toggle('has-images', n > 0);
  };

  const move = (i: number, d: number) => {
    const imgs = ctx.images;
    [imgs[i + d], imgs[i]] = [imgs[i], imgs[i + d]];
    void saveImages(imgs);
    update();
  };
  const remove = (i: number) => {
    ctx.images.splice(i, 1);
    void saveImages(ctx.images);
    update();
  };

  const add = async (files: Iterable<File>) => {
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!list.length) return;
    busy.className = 'status busy';
    busy.textContent = list.length === 1 ? 'Foto wird vorbereitet …' : `${list.length} Fotos werden vorbereitet …`;
    try {
      for (const f of list) ctx.images.push(await prepareImage(f));
      await saveImages(ctx.images);
    } catch {
      toast('Ein Foto ließ sich nicht öffnen. Versuch es als JPG oder PNG.', 'error');
    }
    busy.className = 'status';
    busy.textContent = '';
    update();
  };

  for (const input of [camera, gallery]) {
    input.addEventListener('change', () => {
      if (input.files) void add(input.files);
      input.value = '';
    });
  }

  const dropzone = h('div', { class: 'dropzone' },
    h('div', { class: 'drop-actions' },
      h('button', { class: 'btn big', type: 'button', onclick: () => camera.click() }, icon('camera', 22), 'Foto aufnehmen'),
      h('button', { class: 'btn big', type: 'button', onclick: () => gallery.click() }, icon('images', 22), 'Fotos auswählen'),
    ),
    h('p', { class: 'drop-hint' }, 'oder Bilder hierher ziehen'),
    thumbs,
    camera, gallery,
  );
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    if (e.dataTransfer?.files) void add(e.dataTransfer.files);
  });

  // Modell kompakt als Auswahl
  const modelSelect = h('select', { id: 'model', 'aria-describedby': 'model-hint' });
  for (const m of MODELS) modelSelect.add(new Option(m.label, m.id, false, m.id === prefs.model));
  // eigene Modell-ID aus den Einstellungen mit anbieten
  if (!MODELS.some((m) => m.id === prefs.model)) modelSelect.add(new Option(`Eigenes: ${prefs.model}`, prefs.model, false, true));
  const modelHint = h('span', { id: 'model-hint', class: 'help inline' });
  const syncHint = () => (modelHint.textContent = MODELS.find((m) => m.id === modelSelect.value)?.hint ?? 'eigene Modell-ID – ändern in den Einstellungen');
  modelSelect.addEventListener('change', () => {
    prefs.model = modelSelect.value;
    savePrefs();
    syncHint();
  });
  syncHint();

  readBtn.addEventListener('click', () => {
    if (!prefs.apiKey) return ctx.openSettings();
    if (session.notation.trim() && session.source && !confirm('Das aktuelle Stück wird durch das neue Ergebnis ersetzt. Weiter?')) return;
    ctx.go('reading');
  });

  xml.addEventListener('change', async () => {
    const f = xml.files?.[0];
    xml.value = '';
    if (!f) return;
    if (/\.mxl$/i.test(f.name)) return toast('Bitte als unkomprimiertes .musicxml exportieren (nicht .mxl).', 'error');
    try {
      const score = parseMusicXml(await f.text());
      Object.assign(session, emptySession(), { source: 'xml', notation: serializeNotation(score) });
      session.detected = { title: score.title, composer: score.composer, arranger: score.arranger };
      saveSession();
      ctx.go('overview');
    } catch (err) {
      toast(`Import fehlgeschlagen: ${(err as Error).message}`, 'error');
    }
  });

  const resume = session.notation.trim() && session.source
    ? h('div', { class: 'resume' },
        h('p', {}, 'Du hast ein Stück in Arbeit.'),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => ctx.go(session.step && session.step !== 'source' ? session.step : 'overview') }, 'Weitermachen', icon('right', 18)))
    : null;

  append(root, [
    h('div', { class: 'step-head' },
      h('h1', {}, 'Notenblatt fotografieren'),
      h('p', { class: 'lead' }, 'Eine Bassstimme, beliebig viele Seiten – in der richtigen Reihenfolge.'),
    ),
    resume,
    h('div', { class: 'source-grid' },
      h('section', { class: 'panel', 'aria-label': 'Fotos' }, dropzone, busy),
      h('aside', { class: 'tips', 'aria-labelledby': 'tips-title' },
        h('h2', { id: 'tips-title' }, 'So liest Gemini am besten'),
        h('ul', {},
          h('li', {}, 'Gerade von oben, ganze Seite im Bild'),
          h('li', {}, 'Helles Licht, kein Schatten über den Noten'),
          h('li', {}, 'Bleistift-Notizen sind okay – sie werden ignoriert'),
        ),
        h('label', { class: 'field', for: 'model' }, 'KI-Modell'),
        modelSelect, modelHint,
      ),
    ),
    h('div', { class: 'step-actions' },
      readBtn,
      h('div', { class: 'alt-actions' },
        h('button', { class: 'btn quiet', type: 'button', onclick: () => xml.click() }, icon('file', 18), 'MusicXML öffnen'),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => {
          if (session.notation.trim() && session.source && !confirm('Das aktuelle Stück durch das Beispiel ersetzen?')) return;
          Object.assign(session, emptySession(), { source: 'demo', notation: DEMO });
          session.detected = { title: 'Todo tiene su final', composer: 'Hector Lavoe', arranger: 'Sebastian Wiesener' };
          saveSession();
          ctx.go('overview');
        } }, 'Beispiel ansehen'),
      ),
      xml,
    ),
  ]);
  update();
}
