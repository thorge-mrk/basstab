// Zweiter Durchgang: Gemini prüft jede Notenzeile einzeln gegen den Ausschnitt nach.
// Die Takte sind im Ausschnitt rot nummeriert, damit klar ist, welche Lesung zu welchem Takt gehört.

import type { Part } from '@google/genai';
import {
  SYSTEM_PROMPT, ULTRA, bitmapOf, filterUncertain, requestJson, toNotation,
  type PreparedImage, type RecognitionResult, type RecognizedMeasure, type Uncertainty,
} from './gemini';
import type { LayoutSystem } from './layout';

const VERIFY_PROMPT = `${SYSTEM_PROMPT}

## This request: second pass – proofreading line by line
You get the line images of ONE page. Under each image is the transcription of that line from a first reading. BassTab has drawn the measure numbers in red above the staff and a short red tick where each measure begins – the red marks are not part of the music.
For every measure compare the transcription with the image, note by note: pitch (count lines, spaces and ledger lines), accidentals, durations and dots, ties, rests, dynamics, articulations, text and structure signs. Correct every mistake you find; leave correct measures exactly as they are.
Keep the measures: same number of measures per line, same measure numbers, same order. Change the count of a line only if the first reading clearly merged two measures or split one.
Return JSON: "lines" with every line and all of its measures (corrected or unchanged), and "uncertain" following the rules above.`;

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          system: { type: 'integer' },
          measures: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                number: { type: 'integer' },
                repeatStart: { type: 'boolean' },
                content: { type: 'string' },
                end: { type: 'string', enum: ['|', '||', ':|', '|]'] },
              },
              required: ['number', 'content', 'end'],
            },
          },
        },
        required: ['system', 'measures'],
      },
    },
    uncertain: {
      type: 'array',
      items: {
        type: 'object',
        properties: { measure: { type: 'integer' }, question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
        required: ['measure', 'question', 'options'],
      },
    },
  },
  required: ['lines', 'uncertain'],
};

interface VerifiedLine {
  system: number;
  measures: { number: number; repeatStart?: boolean; content: string; end: string }[];
}

export interface VerifyOptions {
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  /** fertig geprüfte Seiten */
  onProgress?: (done: number, total: number) => void;
}

export interface VerifyOutcome {
  result: RecognitionResult;
  /** Indizes der Takte, die der zweite Durchgang geändert hat */
  changed: number[];
  /** Seiten, deren Prüfung fehlschlug (dort gilt die erste Lesung) */
  failedPages: number[];
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * Übernimmt die geprüften Zeilen einer Seite: pro Zeile nur, wenn die Taktzahl gleich geblieben ist –
 * sonst gilt vorsichtshalber die erste Lesung.
 */
export function mergeVerified(measures: RecognizedMeasure[], page: number, lines: VerifiedLine[]): { measures: RecognizedMeasure[]; changed: number[] } {
  const out = measures.map((m) => ({ ...m }));
  const changed: number[] = [];
  for (const line of lines) {
    const idx = out.map((m, i) => (m.page === page && (m.system ?? 0) === line.system ? i : -1)).filter((i) => i >= 0);
    if (!idx.length || idx.length !== line.measures.length) continue;
    idx.forEach((i, k) => {
      const v = line.measures[k];
      const end = ['|', '||', ':|', '|]'].includes(v.end) ? v.end : out[i].end;
      if (!norm(v.content)) return;
      if (norm(v.content) !== norm(out[i].content) || end !== out[i].end || !!v.repeatStart !== !!out[i].repeatStart) changed.push(i);
      out[i] = { ...out[i], content: v.content, end, repeatStart: v.repeatStart ?? out[i].repeatStart };
    });
  }
  return { measures: out, changed };
}

/** Tonart und Taktart, die am Anfang jedes Takts gelten (Wechsel per [key …]/[time …]). */
function contextAt(measures: RecognizedMeasure[], head: RecognitionResult['head']) {
  let key = head.key;
  let time = head.time;
  return measures.map((m) => {
    const ctx = { key, time };
    const k = /\[key\s+([^\]]+)\]/.exec(m.content);
    const t = /\[time\s+(\d+\/\d+)\]/.exec(m.content);
    if (k) key = k[1].trim();
    if (t) time = t[1];
    return k || t ? { key, time } : ctx;
  });
}

/** Zeilenausschnitt mit roten Taktnummern über der Zeile. */
function markedLine(bmp: ImageBitmap, sys: LayoutSystem, boxes: { n: number; x: number }[], maxW: number, minW: number): string {
  const [y0, x0, y1, x1] = sys.area;
  const sx = (x0 / 1000) * bmp.width;
  const sy = (y0 / 1000) * bmp.height;
  const sw = ((x1 - x0) / 1000) * bmp.width;
  const sh = ((y1 - y0) / 1000) * bmp.height;
  const scale = sw > maxW ? maxW / sw : sw < minW ? minW / sw : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const staffTop = ((sys.staff[0] / 1000) * bmp.height - sy) * scale;
  const size = Math.max(14, Math.min(30, staffTop * 0.5));
  ctx.fillStyle = '#e0001b';
  ctx.strokeStyle = '#e0001b';
  ctx.lineWidth = Math.max(2, size / 10);
  ctx.font = `700 ${size}px sans-serif`;
  ctx.textBaseline = 'top';
  for (const { n, x } of boxes) {
    const px = ((x / 1000) * bmp.width - sx) * scale;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, Math.max(size, staffTop - 4));
    ctx.stroke();
    ctx.fillText(String(n), px + 4, 2);
  }
  const url = c.toDataURL('image/jpeg', 0.88);
  return url.slice(url.indexOf(',') + 1);
}

/** Baut die Prüf-Anfrage einer Seite: je Zeile Ausschnitt mit Nummern und die bisherige Lesung. */
async function pageParts(img: PreparedImage, page: number, measures: RecognizedMeasure[], ctxs: { key: string; time: string }[]): Promise<Part[] | null> {
  const bmp = await bitmapOf(img);
  if (!bmp) return null;
  const parts: Part[] = [];
  const systems = img.layout?.systems ?? [];
  const groups = new Map<number, number[]>();
  measures.forEach((m, i) => {
    if (m.page !== page) return;
    const s = m.system ?? 0;
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s)!.push(i);
  });
  const crowded = systems.length > 14;
  for (const [s, idx] of [...groups].sort((a, b) => a[0] - b[0])) {
    const sys = systems[s - 1];
    const first = measures[idx[0]];
    const last = measures[idx[idx.length - 1]];
    const { key, time } = ctxs[idx[0]];
    const reading = idx.map((i) => `Takt ${measures[i].number}: ${measures[i].repeatStart ? '|: ' : ''}${measures[i].content} ${measures[i].end}`).join('\n');
    if (sys) {
      const marks = idx.map((i) => ({ n: measures[i].number, x: measures[i].box?.[1] ?? sys.staff[1] }));
      parts.push({ text: `Seite ${page}, Zeile ${s}: Takte ${first.number}–${last.number}, Tonart ${key}, Taktart ${time}` });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: markedLine(bmp, sys, marks, crowded ? 2048 : 2560, 1600) }, mediaResolution: ULTRA });
    } else {
      // ohne erkannte Zeile: ganze Seite, Takte über die Nummern zuordnen
      parts.push({ text: `Seite ${page} (ganze Seite), Zeile ${s}: Takte ${first.number}–${last.number}, Tonart ${key}, Taktart ${time}` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data }, mediaResolution: ULTRA });
    }
    parts.push({ text: `Erste Lesung, Zeile ${s}:\n${reading}` });
  }
  bmp.close();
  parts.push({ text: 'Proofread every line of this page and return the corrected transcription.' });
  return parts;
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

/** Prüft alle Seiten (bis zu drei gleichzeitig) und übernimmt die Korrekturen. */
export async function verifySheet(images: PreparedImage[], first: RecognitionResult, opts: VerifyOptions): Promise<VerifyOutcome> {
  let measures = first.measures;
  let uncertain: Uncertainty[] = first.uncertain;
  const changed = new Set<number>();
  const failedPages: number[] = [];
  const ctxs = contextAt(measures, first.head);
  const pages = [...new Set(measures.map((m) => m.page))].filter((p) => images[p - 1]).sort((a, b) => a - b);
  let done = 0;
  opts.onProgress?.(0, pages.length);

  await pool(pages, 3, async (page) => {
    try {
      const parts = await pageParts(images[page - 1], page, measures, ctxs);
      if (!parts) throw new Error('Seite ohne Bild');
      const text = await requestJson({ apiKey: opts.apiKey, model: opts.model, parts, system: VERIFY_PROMPT, schema: VERIFY_SCHEMA, signal: opts.signal });
      const res = JSON.parse(text) as { lines?: VerifiedLine[]; uncertain?: Uncertainty[] };
      const merged = mergeVerified(measures, page, res.lines ?? []);
      measures = merged.measures;
      merged.changed.forEach((i) => changed.add(i));
      // Fragen dieser Seite kommen jetzt aus der gründlicheren Prüfung
      const onPage = new Set(measures.filter((m) => m.page === page).map((m) => m.number));
      uncertain = [...uncertain.filter((u) => !onPage.has(u.measure)), ...(res.uncertain ?? []).filter((u) => onPage.has(u.measure))];
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      failedPages.push(page);
    } finally {
      opts.onProgress?.(++done, pages.length);
    }
  });

  const raw = { ...first.head, ...first.meta, measures, uncertain };
  return {
    result: { ...first, notation: toNotation(raw), measures, uncertain: filterUncertain(raw) },
    changed: [...changed].sort((a, b) => a - b),
    failedPages: failedPages.sort((a, b) => a - b),
  };
}
