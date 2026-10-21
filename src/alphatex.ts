// Score + Griffbild → alphaTex (Notenzeile + Tabulatur für alphaTab).

import type { Score, MusicEvent, Jump, Dynamic, Articulation } from './score';
import { keyName } from './score';
import type { BassSetup, Fingering } from './fingering';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiName(m: number): string {
  return `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
}

function q(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const JUMP_TEX: Record<Jump, string> = {
  segno: 'Segno', coda: 'Coda', fine: 'Fine', daCapo: 'DaCapo', daCapoAlCoda: 'DaCapoAlCoda',
  daCapoAlFine: 'DaCapoAlFine', dalSegno: 'DalSegno', dalSegnoAlCoda: 'DalSegnoAlCoda',
  dalSegnoAlFine: 'DalSegnoAlFine', daCoda: 'DaCoda',
};

export interface TexOptions {
  showNotation: boolean;
  showTab: boolean;
}

export function toAlphaTex(score: Score, fingering: Fingering, setup: BassSetup, opts: TexOptions): string {
  tieState = new Map();
  const out: string[] = [];
  if (score.title) out.push(`\\title ${q(score.title)}`);
  if (score.composer) out.push(`\\artist ${q(score.composer)}`);
  if (score.arranger) out.push(`\\subtitle ${q('Arr.: ' + score.arranger)}`);
  if (score.tempo) out.push(`\\tempo ${score.tempo}`);
  out.push('.');

  const staffOpts = [opts.showNotation ? 'score' : '', opts.showTab ? 'tabs' : ''].filter(Boolean).join(' ') || 'score tabs';
  out.push(`\\track ${q('Bass')}`);
  out.push(`\\staff {${staffOpts}}`);
  // Bass klingt eine Oktave tiefer als notiert: klingende Stimmung + Anzeige-Transposition
  const tuningHighFirst = [...setup.tuning].reverse().map((m) => midiName(m - 12)).join(' ');
  out.push(`\\tuning (${tuningHighFirst}) { hide }`);
  out.push('\\displayTranspose 12');
  out.push('\\instrument 33');

  const nStrings = setup.tuning.length;
  let key = score.key;
  let time = score.time;
  const bars: string[] = [];
  // alphaTab zeichnet Dynamik bei jedem Wechsel – also überall den aktuellen Wert setzen,
  // ab der ersten notierten Dynamik (davor gilt sie rückwirkend).
  let dyn: Dynamic | undefined = firstDynamic(score);
  const dynFx = () => (dyn ? ` {dy ${dyn}}` : '');

  score.measures.forEach((m, mi) => {
    const meta: string[] = [];
    if (mi === 0) {
      meta.push('\\clef F4');
      meta.push(`\\ks ${keyName(key)}`);
      meta.push(`\\ts (${time[0]} ${time[1]})`);
    }
    if (m.keyChange !== undefined && !(mi === 0 && m.keyChange === key)) {
      key = m.keyChange;
      meta.push(`\\ks ${keyName(key)}`);
    }
    if (m.timeChange) {
      time = m.timeChange;
      meta.push(`\\ts (${time[0]} ${time[1]})`);
    }
    if (m.tempoChange) meta.push(`\\tempo ${m.tempoChange}`);
    if (m.repeatStart) meta.push('\\ro');
    if (m.volta) meta.push(`\\ae (${m.volta.join(' ')})`);
    if (m.section) meta.push(m.section.text ? `\\section (${q(m.section.marker)} ${q(m.section.text)})` : `\\section ${q(m.section.marker)}`);
    for (const j of m.jumps) meta.push(`\\jump ${JUMP_TEX[j]}`);

    const restBar = (extraMeta: string[]) => `${extraMeta.join(' ')} r.1${dynFx()}`;

    if (m.multiRest) {
      // erster Takt trägt Metadaten + Wiederholungsende nur im letzten
      for (let k = 0; k < m.multiRest; k++) {
        const bm = k === 0 ? [...meta] : [];
        if (k === m.multiRest - 1) bm.push(...closing(m));
        bars.push(restBar(bm));
      }
      return;
    }

    meta.push(...closing(m));
    const beats = m.events.map((e, ei) => {
      if (e.dynamic) dyn = e.dynamic;
      return beatTex(e, fingering[mi]?.[ei] ?? [], nStrings, key, ei === 0 ? m.texts : [], dyn);
    });
    if (beats.length === 0) beats.push(`r.1${dynFx()}`);
    bars.push(`${meta.join(' ')} ${beats.join(' ')}`.trim());
  });

  out.push(bars.join(' |\n'));
  return out.join('\n');
}

function closing(m: Score['measures'][number]): string[] {
  const r: string[] = [];
  if (m.repeatEnd) r.push(`\\rc ${m.repeatEnd}`);
  else if (m.barlineRight === 'double') r.push('\\barlineRight lightLight');
  else if (m.barlineRight === 'final') r.push('\\barlineRight lightHeavy');
  return r;
}

let tieState = new Map<number, boolean>();

export function firstDynamic(score: Score): Dynamic | undefined {
  for (const m of score.measures) for (const e of m.events) if (e.dynamic) return e.dynamic;
  return undefined;
}

const NOTE_ARTIC: Partial<Record<Articulation, string>> = {
  staccato: 'st', accent: 'ac', tenuto: 'ten', marcato: 'hac', dead: 'x', ghost: 'g', slide: 'ss', hammer: 'h',
};
const BEAT_ARTIC: Partial<Record<Articulation, string>> = { fermata: 'fermata medium', slap: 's', pop: 'p' };

function beatTex(
  e: MusicEvent,
  pos: { string: number; fret: number }[],
  nStrings: number,
  key: number,
  texts: string[],
  dyn: Dynamic | undefined,
): string {
  const effects: string[] = [];
  if (e.dots === 1) effects.push('d');
  if (e.dots === 2) effects.push('dd');
  if (e.tuplet) effects.push(`tu ${e.tuplet}`);
  if (dyn) effects.push(`dy ${dyn}`);
  if (e.hairpin) effects.push(e.hairpin === 'cresc' ? 'cre' : 'dec');
  for (const a of e.artics ?? []) if (BEAT_ARTIC[a]) effects.push(BEAT_ARTIC[a]!);
  const allTexts = [...texts, ...(e.text ? [e.text] : [])];
  if (allTexts.length) effects.push(`txt ${q(allTexts.join(' · '))}`);
  const beatFx = effects.length ? ` {${effects.join(' ')}}` : '';

  if (e.kind === 'rest') {
    tieState = new Map();
    return `r.${e.duration}${beatFx}`;
  }

  const notes = e.notes.map((head, i) => {
    const p = pos[i] ?? { string: 0, fret: 0 };
    const noteFx: string[] = [];
    if (tieState.get(head.pitch.midi)) noteFx.push('t');
    for (const a of e.artics ?? []) if (NOTE_ARTIC[a]) noteFx.push(NOTE_ARTIC[a]!);
    const alter = head.pitch.alter;
    if (alter > 0 && key <= 0) noteFx.push(alter === 2 ? 'acc ##' : 'acc #');
    else if (alter < 0 && key >= 0) noteFx.push(alter === -2 ? 'acc bb' : 'acc b');
    return `${p.fret}.${nStrings - p.string}${noteFx.length ? `{${noteFx.join(' ')}}` : ''}`;
  });
  tieState = new Map();
  if (e.tieToNext) for (const h of e.notes) tieState.set(h.pitch.midi, true);
  const body = notes.length === 1 ? notes[0] : `(${notes.join(' ')})`;
  return `${body}.${e.duration}${beatFx}`;
}
