// Griffbild-Optimierung: wählt für jede Note Saite + Bund so, dass das Stück
// möglichst bequem spielbar ist. Dynamische Programmierung (Viterbi) über
// Zustände (Griff, Handlage). Kosten modellieren Lagenwechsel, Dehnungen,
// Saitensprünge, Leersaiten und hohe Lagen.

import type { Score, NoteEvent, Diagnostic } from './score';
import { durationTicks } from './score';

export interface BassSetup {
  /** MIDI-Tonhöhen in Notation (klingend eine Oktave tiefer), tiefste Saite zuerst. */
  tuning: number[];
  maxFret: number;
  openStrings: 'prefer' | 'neutral' | 'avoid';
  /** 'ofpf' = ein Finger pro Bund, 'simandl' = 1-2-4 in tiefen Lagen. */
  technique: 'ofpf' | 'simandl';
  /** Bevorzugt tiefe Lagen (I–V). Höher = stärker. */
  lowPositionBias: number;
}

export const TUNINGS: Record<string, { label: string; tuning: number[] }> = {
  standard4: { label: '4-Saiter E-A-D-G', tuning: [40, 45, 50, 55] },
  dropD4: { label: '4-Saiter Drop D (D-A-D-G)', tuning: [38, 45, 50, 55] },
  standard5: { label: '5-Saiter B-E-A-D-G', tuning: [35, 40, 45, 50, 55] },
};

export const DEFAULT_SETUP: BassSetup = {
  tuning: TUNINGS.standard4.tuning,
  maxFret: 20,
  openStrings: 'neutral',
  technique: 'ofpf',
  lowPositionBias: 1,
};

export interface FretPos {
  /** 0 = tiefste Saite */
  string: number;
  fret: number;
}

/** Ergebnis je Takt → je Ereignis → je Note (Rests: leeres Array). */
export type Fingering = FretPos[][][];

interface Slot {
  measure: number;
  event: number;
  ev: NoteEvent;
  midis: number[];
  forced: (number | undefined)[];
  restBefore: number;
  tieFromPrev: boolean;
}

interface State {
  cand: number;
  h: number;
  cost: number;
  back: number;
}

const INF = 1e9;

export function computeFingering(score: Score, setup: BassSetup): { fingering: Fingering; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const n = setup.tuning.length;
  const fingering: Fingering = score.measures.map((m) => m.events.map(() => []));

  // Noten-Ereignisse in Spielreihenfolge sammeln
  const slots: Slot[] = [];
  let restBefore = 0;
  let prevTie: NoteEvent | null = null;
  score.measures.forEach((m, mi) => {
    if (m.multiRest) {
      restBefore += 1920 * m.multiRest;
      prevTie = null;
    }
    m.events.forEach((ev, ei) => {
      if (ev.kind === 'rest') {
        restBefore += durationTicks(ev);
        prevTie = null;
        return;
      }
      const midis: number[] = [];
      const forced: (number | undefined)[] = [];
      for (const head of ev.notes) {
        let midi = head.pitch.midi;
        const lowest = setup.tuning[0];
        const highest = setup.tuning[n - 1] + setup.maxFret;
        if (midi < lowest || midi > highest) {
          const shifted = midi < lowest ? midi + 12 * Math.ceil((lowest - midi) / 12) : midi - 12 * Math.ceil((midi - highest) / 12);
          diagnostics.push({
            line: m.line,
            measure: mi + 1,
            severity: 'warning',
            message: `Takt ${mi + 1}: Note außerhalb des Tonumfangs, um Oktave(n) verschoben`,
          });
          midi = shifted;
        }
        midis.push(midi);
        const fs = head.forcedString;
        if (fs !== undefined && (fs < 1 || fs > n)) {
          diagnostics.push({ line: m.line, measure: mi + 1, severity: 'warning', message: `Takt ${mi + 1}: Saite @${fs} existiert nicht` });
          forced.push(undefined);
        } else forced.push(fs === undefined ? undefined : n - fs);
      }
      const tieFromPrev = prevTie !== null && prevTie.tieToNext;
      slots.push({ measure: mi, event: ei, ev, midis, forced, restBefore, tieFromPrev });
      restBefore = 0;
      prevTie = ev;
    });
  });
  if (slots.length === 0) return { fingering, diagnostics };

  const cands = slots.map((s) => candidates(s, setup));
  cands.forEach((c, i) => {
    if (c.length === 0) {
      const s = slots[i];
      diagnostics.push({
        line: score.measures[s.measure].line,
        measure: s.measure + 1,
        severity: 'warning',
        message: `Takt ${s.measure + 1}: Kein Griff für Saitenvorgabe möglich – Vorgabe ignoriert`,
      });
      cands[i] = candidates({ ...s, forced: s.forced.map(() => undefined) }, setup);
    }
  });

  const maxH = Math.max(1, setup.maxFret - 3);
  const layers: State[][] = [];

  for (let i = 0; i < slots.length; i++) {
    const layer: State[] = [];
    const prev = i > 0 ? layers[i - 1] : null;
    cands[i].forEach((cand, ci) => {
      const fretted = cand.filter((p) => p.fret > 0).map((p) => p.fret);
      let hs: number[];
      if (fretted.length) {
        const lo = Math.max(1, Math.max(...fretted) - 3);
        const hi = Math.min(Math.min(...fretted), maxH);
        hs = range(lo, Math.max(lo, hi));
      } else {
        // Nur Leersaiten: Hand bleibt, wo sie war
        hs = prev ? [...new Set(prev.map((s) => s.h))] : range(1, Math.min(maxH, 12));
      }
      for (const h of hs) {
        const local = localCost(cand, h, setup);
        if (!prev) {
          layer.push({ cand: ci, h, cost: local, back: -1 });
          continue;
        }
        let best = INF;
        let bestIdx = -1;
        prev.forEach((ps, pi) => {
          if (!fretted.length && ps.h !== h) return;
          const c = ps.cost + transitionCost(slots[i - 1], cands[i - 1][ps.cand], ps.h, slots[i], cand, h);
          if (c < best) {
            best = c;
            bestIdx = pi;
          }
        });
        if (bestIdx >= 0) layer.push({ cand: ci, h, cost: best + local, back: bestIdx });
      }
    });
    layers.push(layer);
  }

  // Rückverfolgung
  let idx = 0;
  const last = layers[layers.length - 1];
  last.forEach((s, i) => {
    if (s.cost < last[idx].cost) idx = i;
  });
  for (let i = layers.length - 1; i >= 0; i--) {
    const s = layers[i][idx];
    const slot = slots[i];
    fingering[slot.measure][slot.event] = cands[i][s.cand];
    idx = s.back;
  }
  return { fingering, diagnostics };
}

function range(a: number, b: number): number[] {
  const r: number[] = [];
  for (let i = a; i <= b; i++) r.push(i);
  return r;
}

function candidates(slot: Slot, setup: BassSetup): FretPos[][] {
  const per = slot.midis.map((midi, i) => {
    const opts: FretPos[] = [];
    setup.tuning.forEach((open, s) => {
      const fret = midi - open;
      if (fret < 0 || fret > setup.maxFret) return;
      if (slot.forced[i] !== undefined && slot.forced[i] !== s) return;
      opts.push({ string: s, fret });
    });
    return opts;
  });
  const out: FretPos[][] = [];
  const walk = (i: number, acc: FretPos[]) => {
    if (i === per.length) {
      const frets = acc.filter((p) => p.fret > 0).map((p) => p.fret);
      if (frets.length && Math.max(...frets) - Math.min(...frets) > 4) return;
      out.push([...acc]);
      return;
    }
    for (const p of per[i]) {
      if (acc.some((q) => q.string === p.string)) continue;
      acc.push(p);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

function localCost(cand: FretPos[], h: number, setup: BassSetup): number {
  let c = 0;
  let hasFretted = false;
  for (const p of cand) {
    if (p.fret === 0) {
      c += setup.openStrings === 'prefer' ? -0.6 : setup.openStrings === 'avoid' ? 3 : 0.1;
      continue;
    }
    hasFretted = true;
    const finger = p.fret - h; // 0..3 → Zeigefinger..kleiner Finger
    if (finger === 3) {
      if (setup.technique === 'simandl' && h < 7) c += 1.4;
      else if (h < 3) c += 0.5;
    }
  }
  if (hasFretted) {
    c += setup.lowPositionBias * (0.02 * h + 0.12 * Math.max(0, h - 5) + 0.25 * Math.max(0, h - 12));
  }
  return c;
}

function transitionCost(
  prevSlot: Slot,
  prevCand: FretPos[],
  prevH: number,
  slot: Slot,
  cand: FretPos[],
  h: number,
): number {
  let c = 0;

  if (slot.tieFromPrev) {
    for (let i = 0; i < slot.midis.length; i++) {
      const j = prevSlot.midis.indexOf(slot.midis[i]);
      if (j >= 0 && (prevCand[j].string !== cand[i].string || prevCand[j].fret !== cand[i].fret)) c += 1000;
    }
  }

  const shift = Math.abs(h - prevH);
  if (shift > 0) {
    let factor = 1;
    if (slot.restBefore >= 960) factor *= 0.25; // lange Pause: Lagenwechsel praktisch frei
    else if (slot.restBefore >= 240) factor *= 0.5; // Pause ≥ Achtel: Zeit zum Umgreifen
    if (prevCand.every((p) => p.fret === 0)) factor *= 0.5; // Leersaite klingt, Hand ist frei
    c += (1.5 + 0.8 * shift) * factor;
  }

  if (cand.length === 1 && prevCand.length === 1) {
    const a = prevCand[0];
    const b = cand[0];
    const d = Math.abs(a.string - b.string);
    c += 0.25 * d + (d >= 2 ? 0.3 : 0);
    if (slot.midis[0] === prevSlot.midis[0] && (a.string !== b.string || a.fret !== b.fret)) c += 1.5;
    // gleicher Finger auf Nachbarsaite (Rollen) ist unbequem
    if (a.fret > 0 && a.fret === b.fret && a.string !== b.string) c += 0.4;
  }
  return c;
}
