// Takt-bezogene Helfer: einzelnen Takt rendern, ersetzen, Fotos ausschneiden.

import { parseNotation, keyName, type Score } from '../score';
import { computeFingering, TUNINGS, DEFAULT_SETUP, type BassSetup } from '../fingering';
import { toAlphaTex } from '../alphatex';
import type { Box, PreparedImage, RecognizedMeasure } from '../gemini';
import type { Prefs } from './state';

export function setupFromPrefs(p: Prefs): BassSetup {
  return {
    ...DEFAULT_SETUP,
    tuning: TUNINGS[p.tuning]?.tuning ?? DEFAULT_SETUP.tuning,
    technique: p.technique,
    openStrings: p.openStrings,
    lowPositionBias: p.lowPositionBias,
    maxFret: p.maxFret,
  };
}

/** Tonart und Taktart, die am Anfang von Takt idx gelten. */
export function contextAt(score: Score, idx: number): { key: number; time: [number, number] } {
  let key = score.key;
  let time = score.time;
  for (let i = 0; i <= idx && i < score.measures.length; i++) {
    const m = score.measures[i];
    if (m.keyChange !== undefined) key = m.keyChange;
    if (m.timeChange) time = m.timeChange;
  }
  return { key, time };
}

/** Ein einzelner Takt als eigenständige Notation (für Mini-Vorschau). */
export function snippet(score: Score, idx: number, content: string): string {
  const { key, time } = contextAt(score, idx);
  return `key: ${keyName(key)}\ntime: ${time[0]}/${time[1]}\n\n${content.replace(/\|/g, ' ')} |`;
}

/** Notation → alphaTex mit Griffbild. */
export function texFor(notation: string, p: Prefs, bare = false): { tex: string; score: Score } | null {
  const { score } = parseNotation(notation);
  if (!score.measures.length) return null;
  const setup = setupFromPrefs(p);
  const { fingering } = computeFingering(score, setup);
  const s = bare ? { ...score, title: '', composer: '', arranger: '', tempo: undefined } : score;
  const tex = toAlphaTex(s, fingering, setup, { showNotation: p.view !== 'tab', showTab: p.view !== 'score' });
  return { tex, score };
}

/** Ersetzt den Inhalt von Takt idx (ohne Taktstrich) im Quelltext. */
export function replaceMeasure(notation: string, idx: number, content: string): string {
  const { score } = parseNotation(notation);
  const m = score.measures[idx];
  if (!m) return notation;
  const before = notation.slice(0, m.src.start);
  const after = notation.slice(m.src.end);
  const pad = (s: string) => s.replace(/\|/g, ' ').trim();
  return `${before}${pad(content)} ${after.replace(/^\s+/, '')}`;
}

export function measureContent(notation: string, idx: number): string {
  const { score } = parseNotation(notation);
  const m = score.measures[idx];
  return m ? notation.slice(m.src.start, m.src.end).trim() : '';
}

/** Ändert/ergänzt eine Kopfzeile (title, composer, …). */
export function setHeader(notation: string, field: string, value: string): string {
  const re = new RegExp(`^${field}\\s*:.*$`, 'm');
  const v = value.trim();
  if (re.test(notation)) return v ? notation.replace(re, `${field}: ${v}`) : notation.replace(new RegExp(`^${field}\\s*:.*\\n?`, 'm'), '');
  return v ? `${field}: ${v}\n${notation}` : notation;
}

/** alphaTab-Taktindex ↔ Notations-Taktindex (Mehrtaktpausen sind in alphaTab mehrere Takte). */
export function barMaps(score: Score): { barToMeasure: number[]; measureToBar: number[] } {
  const barToMeasure: number[] = [];
  const measureToBar: number[] = [];
  score.measures.forEach((m, i) => {
    measureToBar.push(barToMeasure.length);
    for (let k = 0; k < (m.multiRest ?? 1); k++) barToMeasure.push(i);
  });
  return { barToMeasure, measureToBar };
}

/** Erkannter Takt (Foto-Box) zum Notations-Takt – gleiche Reihenfolge wie bei der Erkennung. */
export function recognizedFor(recognized: RecognizedMeasure[], idx: number): RecognizedMeasure | undefined {
  return recognized[idx];
}

export function measureIndexForNumber(recognized: RecognizedMeasure[], number: number): number {
  const i = recognized.findIndex((m) => m.number === number);
  if (i >= 0) return i;
  // Nummer liegt in einer Mehrtaktpause oder fehlt: nächstkleineren Takt nehmen
  let best = 0;
  recognized.forEach((m, j) => {
    if (m.number <= number) best = j;
  });
  return best;
}

const cropCache = new Map<string, string>();

/** Schneidet den Takt (mit etwas Rand) aus dem Foto aus. */
export async function cropMeasure(img: PreparedImage, box: Box, pad = 0.04): Promise<string> {
  const key = `${img.url.length}:${img.url.slice(-32)}:${box.join(',')}`;
  const hit = cropCache.get(key);
  if (hit) return hit;
  const el = new Image();
  el.src = img.url;
  await el.decode();
  const [y0, x0, y1, x1] = box.map((v) => Math.min(1000, Math.max(0, v)) / 1000);
  const W = el.naturalWidth;
  const H = el.naturalHeight;
  const bw = (x1 - x0) * W;
  const bh = (y1 - y0) * H;
  const px = Math.max(bw, bh) * pad + 0.01 * W;
  const sx = Math.max(0, x0 * W - px);
  const sy = Math.max(0, y0 * H - px);
  const sw = Math.min(W - sx, bw + 2 * px);
  const sh = Math.min(H - sy, bh + 2 * px);
  const scale = Math.min(1, 1400 / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  c.getContext('2d')!.drawImage(el, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.88);
  cropCache.set(key, url);
  return url;
}
