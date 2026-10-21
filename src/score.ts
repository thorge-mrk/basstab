// Datenmodell + editierbare Textnotation ("BassTab-Notation").
//
// Noten werden so notiert, wie sie auf dem Blatt stehen: Buchstabe + Oktave,
// Vorzeichen nur wenn gedruckt. Tonart-Vorzeichen und Taktvorzeichen werden
// automatisch angewendet (wie beim Lesen eines Notenblatts).

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export const DURATIONS = [1, 2, 4, 8, 16, 32] as const;
export type Duration = (typeof DURATIONS)[number];

export interface Pitch {
  step: Step;
  alter: number; // -2..2
  octave: number;
  midi: number;
}

export interface NoteHead {
  pitch: Pitch;
  /** Vom Nutzer erzwungene Saite (1 = höchste Saite). */
  forcedString?: number;
}

export const DYNAMICS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'] as const;
export type Dynamic = (typeof DYNAMICS)[number];

export type Articulation =
  | 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata'
  | 'dead' | 'ghost' | 'slide' | 'hammer' | 'slap' | 'pop';

/** Suffix-Zeichen nach einer Note, z. B. `F3/8-.` (Staccato) oder `C3/4->` (Akzent). */
export const ARTIC_SUFFIX: Record<string, Articulation> = {
  '-.': 'staccato', '->': 'accent', '--': 'tenuto', '-^': 'marcato', '\\fermata': 'fermata',
  '-x': 'dead', '-g': 'ghost', '-/': 'slide', '-h': 'hammer', '-s': 'slap', '-p': 'pop',
};

const ARTIC_BY_NAME = Object.fromEntries(Object.entries(ARTIC_SUFFIX).map(([k, v]) => [v, k])) as Record<Articulation, string>;

interface Expression {
  text?: string;
  /** Dynamik ab diesem Ereignis */
  dynamic?: Dynamic;
  /** Ereignis liegt unter einer Crescendo-/Decrescendo-Gabel */
  hairpin?: 'cresc' | 'dim';
  artics?: Articulation[];
}

export interface NoteEvent extends Expression {
  kind: 'note';
  notes: NoteHead[];
  duration: Duration;
  dots: number;
  tieToNext: boolean;
  tuplet?: number;
}

export interface RestEvent extends Expression {
  kind: 'rest';
  duration: Duration;
  dots: number;
  tuplet?: number;
  /** Ganztaktpause unabhängig von der Taktart. */
  fullMeasure?: boolean;
  /** Von BassTab ergänzt (unvollständiger Takt), steht nicht im Quelltext. */
  auto?: boolean;
}

export type MusicEvent = NoteEvent | RestEvent;

export type Jump =
  | 'segno' | 'coda' | 'fine' | 'daCapo' | 'daCapoAlCoda' | 'daCapoAlFine'
  | 'dalSegno' | 'dalSegnoAlCoda' | 'dalSegnoAlFine' | 'daCoda';

export interface Measure {
  events: MusicEvent[];
  repeatStart: boolean;
  /** 0 = kein Wiederholungsende, sonst Anzahl Durchläufe. */
  repeatEnd: number;
  volta?: number[];
  section?: { marker: string; text: string };
  keyChange?: number;
  timeChange?: [number, number];
  tempoChange?: number;
  jumps: Jump[];
  texts: string[];
  barlineRight?: 'double' | 'final';
  /** Mehrtaktpause: dieser "Takt" steht für n leere Takte. */
  multiRest?: number;
  line: number;
  /** Zeichenbereich des Taktinhalts im Quelltext (ohne Taktstrich) – zum gezielten Bearbeiten */
  src: { start: number; end: number };
}

export interface Score {
  title: string;
  composer: string;
  arranger: string;
  key: number; // Quintenzirkel: -7..7
  time: [number, number];
  tempo?: number;
  measures: Measure[];
}

export interface Diagnostic {
  line: number;
  message: string;
  severity: 'error' | 'warning';
  measure?: number;
}

const STEP_SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

export function midiOf(step: Step, alter: number, octave: number): number {
  return (octave + 1) * 12 + STEP_SEMITONES[step] + alter;
}

export function keyAlter(key: number, step: Step): number {
  if (key > 0) return SHARP_ORDER.slice(0, key).includes(step) ? 1 : 0;
  if (key < 0) return FLAT_ORDER.slice(0, -key).includes(step) ? -1 : 0;
  return 0;
}

const KEY_NAMES: Record<string, number> = {
  Cb: -7, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  abm: -7, ebm: -6, bbm: -5, fm: -4, cm: -3, gm: -2, dm: -1, am: 0, em: 1, bm: 2, 'f#m': 3, 'c#m': 4, 'g#m': 5, 'd#m': 6, 'a#m': 7,
};
const FIFTHS_TO_MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

export function keyName(fifths: number): string {
  return FIFTHS_TO_MAJOR[fifths + 7];
}

/** Akzeptiert "Ab", "Fm", "4b", "3#", "-4", "0". */
export function parseKey(raw: string): number | null {
  const s = raw.trim();
  const m = /^([0-7])\s*([b#])$/.exec(s);
  if (m) return m[2] === 'b' ? -Number(m[1]) : Number(m[1]);
  if (/^-?[0-7]$/.test(s)) return Number(s);
  if (s in KEY_NAMES) return KEY_NAMES[s];
  const minor = s.toLowerCase().replace(/moll|minor|min/, 'm');
  if (minor in KEY_NAMES) return KEY_NAMES[minor];
  const major = s.replace(/-?(dur|major|maj)$/i, '');
  if (major in KEY_NAMES) return KEY_NAMES[major];
  return null;
}

export function durationTicks(e: { duration: Duration; dots: number; tuplet?: number }): number {
  const base = 1920 / e.duration; // Ganze = 1920 Ticks
  let total = base;
  let add = base;
  for (let i = 0; i < e.dots; i++) {
    add /= 2;
    total += add;
  }
  if (e.tuplet) total = (total * tupletDenominator(e.tuplet)) / e.tuplet;
  return total;
}

export function tupletDenominator(n: number): number {
  // 3:2, 5:4, 6:4, 7:4, 9:8 …
  let d = 1;
  while (d * 2 < n) d *= 2;
  return d;
}

export function measureTicks(time: [number, number]): number {
  return (1920 / time[1]) * time[0];
}

// ---------------------------------------------------------------------------
// Parser

const ACC: Record<string, number> = { '': NaN, '#': 1, x: 2, '##': 2, b: -1, bb: -2, n: 0 };

const TOKEN_RE = new RegExp(
  [
    '(?<comment>%[^\\n]*)',
    '(?<ws>\\s+)',
    '(?<directive>\\[[^\\]\\n]*\\])',
    '(?<text>"[^"\\n]*")',
    '(?<tupletOpen>\\{\\s*\\d+)',
    '(?<tupletClose>\\})',
    '(?<chordOpen>\\()',
    '(?<dynamic>!(?:ppp|pp|p|mp|mf|fff|ff|f|sfz|sf|fz|fp)(?![a-z]))',
    '(?<hairpin>\\\\[<>!])',
    '(?<chordClose>\\)(?:/\\d+)?\\.*~?(?:-[.>^\\-xg/hsp]|\\\\fermata)*)',
    '(?<bar>:\\|:|:\\|(?:x\\d+)?|\\|:|\\|\\||\\|\\]|\\|)',
    '(?<note>[A-G](?:##|bb|#|b|n|x)?-?\\d(?:@\\d)?(?:/\\d+)?\\.*~?(?:-[.>^\\-xg/hsp]|\\\\fermata)*)',
    '(?<rest>r(?:/\\d+)?\\.*(?:\\\\fermata)?)',
    '(?<fullrest>R(?:\\\\fermata)?)',
  ].join('|'),
  'gy',
);

const ARTIC_RE = /((?:-[.>^\-xg/hsp]|\\fermata)*)$/;

/** Trennt angehängte Artikulationen ab: "F3/8-.->" → ["F3/8", ["staccato","accent"]] */
function splitArtics(tok: string): [string, Articulation[]] {
  const suffix = ARTIC_RE.exec(tok)![1];
  if (!suffix) return [tok, []];
  const artics = (suffix.match(/-.|\\fermata/g) ?? []).map((a) => ARTIC_SUFFIX[a]).filter(Boolean);
  return [tok.slice(0, tok.length - suffix.length), [...new Set(artics)]];
}

interface ParseState {
  key: number;
  time: [number, number];
  duration: Duration;
  dots: number;
  measureAcc: Map<string, number>;
  tiedFrom: Map<string, number>;
}

export interface ParseResult {
  score: Score;
  diagnostics: Diagnostic[];
}

export function parseNotation(src: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const score: Score = { title: '', composer: '', arranger: '', key: 0, time: [4, 4], measures: [] };

  // Kopfzeilen "feld: wert" am Anfang
  const lines = src.split('\n');
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l === '' || l.startsWith('%')) continue;
    const m = /^([a-zA-ZäöüÄÖÜ]+)\s*:\s*(.*)$/.exec(l);
    if (!m || m[1].length < 3) {
      bodyStart = i;
      break;
    }
    bodyStart = i + 1;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    switch (field) {
      case 'title': case 'titel': score.title = value; break;
      case 'composer': case 'artist': case 'komponist': case 'interpret': score.composer = value; break;
      case 'arranger': case 'arr': score.arranger = value; break;
      case 'key': case 'tonart': {
        const k = parseKey(value);
        if (k === null) diagnostics.push({ line: i + 1, severity: 'error', message: `Unbekannte Tonart "${value}"` });
        else score.key = k;
        break;
      }
      case 'time': case 'takt': {
        const t = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
        if (!t) diagnostics.push({ line: i + 1, severity: 'error', message: `Ungültige Taktart "${value}"` });
        else score.time = [Number(t[1]), Number(t[2])];
        break;
      }
      case 'tempo': {
        const n = parseInt(value, 10);
        if (Number.isFinite(n)) score.tempo = n;
        break;
      }
      default:
        diagnostics.push({ line: i + 1, severity: 'warning', message: `Unbekanntes Kopffeld "${m[1]}"` });
    }
  }

  const body = lines.slice(bodyStart).join('\n');
  const bodyOffset = lines.slice(0, bodyStart).reduce((n, l) => n + l.length + 1, 0);
  let lineNo = bodyStart + 1;

  const st: ParseState = {
    key: score.key,
    time: score.time,
    duration: 4,
    dots: 0,
    measureAcc: new Map(),
    tiedFrom: new Map(),
  };

  const newMeasure = (): Measure => ({
    events: [], repeatStart: false, repeatEnd: 0, jumps: [], texts: [], line: lineNo, src: { start: -1, end: -1 },
  });
  let cur = newMeasure();
  let curHasContent = false;
  let tuplet: number | undefined;
  let chord: NoteHead[] | null = null;
  let pendingText: string | undefined;
  let pendingDynamic: Dynamic | undefined;
  let pendingSforzando = false;
  let hairpin: 'cresc' | 'dim' | undefined;

  /** Text, Dynamik, Gabel und Artikulationen an ein neues Ereignis hängen. */
  const expression = (artics: Articulation[]): Expression => {
    const ex: Expression = {};
    if (pendingText) ex.text = pendingText;
    if (pendingDynamic) ex.dynamic = pendingDynamic;
    if (hairpin) ex.hairpin = hairpin;
    const all = pendingSforzando && !artics.includes('marcato') ? [...artics, 'marcato' as const] : artics;
    if (all.length) ex.artics = all;
    pendingText = undefined;
    pendingDynamic = undefined;
    pendingSforzando = false;
    return ex;
  };

  const err = (message: string, severity: Diagnostic['severity'] = 'error') =>
    diagnostics.push({ line: lineNo, message, severity, measure: score.measures.length + 1 });

  const resolvePitch = (raw: string): NoteHead | null => {
    const m = /^([A-G])(##|bb|#|b|n|x)?(-?\d)(?:@(\d))?/.exec(raw)!;
    const step = m[1] as Step;
    const octave = Number(m[3]);
    const id = `${step}${octave}`;
    let alter: number;
    if (m[2] !== undefined) {
      alter = ACC[m[2]];
      st.measureAcc.set(id, alter);
    } else if (st.tiedFrom.has(id)) {
      alter = st.tiedFrom.get(id)!;
    } else if (st.measureAcc.has(id)) {
      alter = st.measureAcc.get(id)!;
    } else {
      alter = keyAlter(st.key, step);
    }
    const head: NoteHead = { pitch: { step, alter, octave, midi: midiOf(step, alter, octave) } };
    if (m[4]) head.forcedString = Number(m[4]);
    return head;
  };

  const readDuration = (raw: string): { duration: Duration; dots: number; tie: boolean } | null => {
    const m = /(?:\/(\d+))?(\.*)(~?)$/.exec(raw)!;
    if (m[1] !== undefined) {
      const d = Number(m[1]) as Duration;
      if (!DURATIONS.includes(d)) {
        err(`Ungültige Notenlänge /${m[1]} (erlaubt: 1, 2, 4, 8, 16, 32)`);
        return null;
      }
      st.duration = d;
      st.dots = m[2].length;
    } else if (m[2].length > 0) {
      st.dots = m[2].length;
    }
    return { duration: st.duration, dots: st.dots, tie: m[3] === '~' };
  };

  const pushNote = (notes: NoteHead[], rawTok: string) => {
    const [raw, artics] = splitArtics(rawTok);
    const d = readDuration(raw);
    if (!d) return;
    st.tiedFrom.clear();
    if (d.tie) for (const n of notes) st.tiedFrom.set(`${n.pitch.step}${n.pitch.octave}`, n.pitch.alter);
    cur.events.push({ kind: 'note', notes, duration: d.duration, dots: d.dots, tieToNext: d.tie, tuplet, ...expression(artics) });
    curHasContent = true;
  };

  const finishMeasure = (bar: string, barPos: number) => {
    if (cur.src.start < 0) cur.src.start = barPos;
    cur.src.end = barPos;
    if (bar === ':|:' || bar.startsWith(':|')) {
      const x = /x(\d+)/.exec(bar);
      cur.repeatEnd = x ? Number(x[1]) : 2;
    }
    if (bar === '||') cur.barlineRight = 'double';
    if (bar === '|]') cur.barlineRight = 'final';
    if (curHasContent || cur.repeatStart || cur.repeatEnd || cur.multiRest) {
      validateMeasure(cur, st.time, score.measures.length, diagnostics);
      score.measures.push(cur);
    }
    cur = newMeasure();
    curHasContent = false;
    st.measureAcc.clear();
    if (bar === ':|:' || bar === '|:') cur.repeatStart = true;
  };

  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < body.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(body);
    if (!m) {
      const bad = /^\S+/.exec(body.slice(pos))![0];
      err(`Unbekanntes Zeichen/Token "${bad}"`);
      pos += bad.length;
      continue;
    }
    const tok = m[0];
    pos += tok.length;
    const g = m.groups!;
    if (g.ws !== undefined) {
      lineNo += (tok.match(/\n/g) ?? []).length;
      continue;
    }
    if (g.comment !== undefined) continue;
    if (!curHasContent && cur.events.length === 0) cur.line = lineNo;
    const tokPos = bodyOffset + pos - tok.length;
    if (g.bar === undefined && cur.src.start < 0) cur.src.start = tokPos;

    if (g.bar !== undefined) {
      if (chord) err('Akkord nicht geschlossen: ")" fehlt');
      chord = null;
      if (tok === '|:' && !curHasContent) {
        cur.repeatStart = true;
        continue;
      }
      finishMeasure(tok, tokPos);
      continue;
    }
    if (g.directive !== undefined) {
      applyDirective(tok.slice(1, -1).trim(), cur, st, err);
      if (cur.multiRest) curHasContent = true;
      continue;
    }
    if (g.text !== undefined) {
      pendingText = tok.slice(1, -1);
      continue;
    }
    if (g.dynamic !== undefined) {
      const v = tok.slice(1);
      if (v === 'sfz' || v === 'sf' || v === 'fz') pendingSforzando = true;
      else pendingDynamic = (v === 'fp' ? 'f' : v) as Dynamic;
      continue;
    }
    if (g.hairpin !== undefined) {
      hairpin = tok[1] === '<' ? 'cresc' : tok[1] === '>' ? 'dim' : undefined;
      continue;
    }
    if (g.tupletOpen !== undefined) {
      tuplet = Number(tok.replace(/\D/g, ''));
      if (tuplet < 2) err(`Ungültige N-tole ${tuplet}`);
      continue;
    }
    if (g.tupletClose !== undefined) {
      tuplet = undefined;
      continue;
    }
    if (g.chordOpen !== undefined) {
      chord = [];
      continue;
    }
    if (g.chordClose !== undefined) {
      if (!chord || chord.length === 0) {
        err('Leerer oder nicht geöffneter Akkord');
        chord = null;
        continue;
      }
      pushNote(chord, tok);
      chord = null;
      continue;
    }
    if (g.note !== undefined) {
      const head = resolvePitch(tok);
      if (!head) continue;
      if (chord) {
        if (/[/.~-]/.test(tok.replace(/^[A-G](##|bb|#|b|n|x)?-?\d(@\d)?/, ''))) err('Länge, Bindebogen und Artikulation bei Akkorden hinter ")" schreiben', 'warning');
        chord.push(head);
      } else pushNote([head], tok);
      continue;
    }
    if (g.rest !== undefined || g.fullrest !== undefined) {
      const fermata = tok.endsWith('\\fermata');
      const raw = fermata ? tok.slice(0, -'\\fermata'.length) : tok;
      // Dynamik wartet auf die nächste Note; Text, Gabel und Fermate gehören zur Pause
      const ex: Expression = {};
      if (pendingText) ex.text = pendingText;
      if (hairpin) ex.hairpin = hairpin;
      if (fermata) ex.artics = ['fermata'];
      pendingText = undefined;
      st.tiedFrom.clear();
      if (g.fullrest !== undefined) {
        cur.events.push({ kind: 'rest', duration: 1, dots: 0, fullMeasure: true, ...ex });
      } else {
        const d = readDuration(raw);
        if (!d) continue;
        cur.events.push({ kind: 'rest', duration: d.duration, dots: d.dots, tuplet, ...ex });
      }
      curHasContent = true;
    }
  }
  if (curHasContent || cur.repeatStart) {
    // Inhalt endet am letzten Nicht-Leerzeichen
    finishMeasure('|', bodyOffset + body.trimEnd().length);
  }

  return { score, diagnostics };
}

const JUMPS: Record<string, Jump> = {
  segno: 'segno', coda: 'coda', fine: 'fine',
  dc: 'daCapo', 'd.c.': 'daCapo', 'dc al coda': 'daCapoAlCoda', 'd.c. al coda': 'daCapoAlCoda',
  'dc al fine': 'daCapoAlFine', 'd.c. al fine': 'daCapoAlFine',
  ds: 'dalSegno', 'd.s.': 'dalSegno', 'ds al coda': 'dalSegnoAlCoda', 'd.s. al coda': 'dalSegnoAlCoda',
  'ds al fine': 'dalSegnoAlFine', 'd.s. al fine': 'dalSegnoAlFine', 'to coda': 'daCoda', tocoda: 'daCoda',
};

function applyDirective(
  d: string,
  m: Measure,
  st: ParseState,
  err: (msg: string, sev?: Diagnostic['severity']) => void,
) {
  const [head, ...restParts] = d.split(/\s+/);
  const rest = restParts.join(' ');
  const h = head.toLowerCase();
  const jump = JUMPS[d.toLowerCase()];
  if (jump) {
    m.jumps.push(jump);
    return;
  }
  switch (h) {
    case 'key': case 'tonart': {
      const k = parseKey(rest);
      if (k === null) return err(`Unbekannte Tonart "${rest}"`);
      m.keyChange = k;
      st.key = k;
      return;
    }
    case 'time': case 'takt': {
      const t = /^(\d+)\s*\/\s*(\d+)$/.exec(rest);
      if (!t) return err(`Ungültige Taktart "${rest}"`);
      m.timeChange = [Number(t[1]), Number(t[2])];
      st.time = m.timeChange;
      return;
    }
    case 'tempo': {
      const n = parseInt(rest, 10);
      if (!Number.isFinite(n)) return err(`Ungültiges Tempo "${rest}"`);
      m.tempoChange = n;
      return;
    }
    case 'section': case 'teil': {
      const sm = /^(\S+)\s*(.*)$/.exec(rest);
      m.section = sm ? { marker: sm[1], text: sm[2] } : { marker: '', text: rest };
      return;
    }
    case 'volta': {
      const nums = rest.split(/[\s,+]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (!nums.length) return err(`Ungültige Volta "${rest}"`);
      m.volta = nums;
      return;
    }
    case 'rest': case 'pause': {
      const n = parseInt(rest, 10);
      if (!(n >= 1)) return err(`Ungültige Mehrtaktpause "${rest}"`);
      m.multiRest = n;
      return;
    }
    case 'text': {
      m.texts.push(rest);
      return;
    }
    default:
      err(`Unbekannte Anweisung [${d}]`, 'warning');
  }
}

/**
 * Prüft die Taktlänge und gleicht übliche Notensatz-Konventionen still aus, statt sie zu melden:
 * - nur Pausen im Takt → Ganztaktpause (so sieht es auch auf dem Blatt aus)
 * - zu kurzer erster Takt → Auftakt, Pausen davor
 * - sonst zu kurzer Takt → fehlende Pausen am Ende ergänzt (Pausen werden in Stimmen oft weggelassen)
 * Nur ein zu langer Takt ist ein echter Lesefehler und wird gemeldet.
 */
function validateMeasure(m: Measure, time: [number, number], index: number, diagnostics: Diagnostic[]) {
  if (m.multiRest) {
    if (m.events.length) diagnostics.push({ line: m.line, severity: 'warning', measure: index + 1, message: 'Takt mit [rest n] sollte keine Noten enthalten' });
    return;
  }
  if (m.events.length === 0) return;
  if (m.events.some((e) => e.kind === 'rest' && e.fullMeasure)) {
    if (m.events.length > 1) diagnostics.push({ line: m.line, severity: 'warning', measure: index + 1, message: '"R" (Ganztaktpause) sollte allein im Takt stehen' });
    return;
  }
  const expected = measureTicks(time);
  const actual = m.events.reduce((s, e) => s + durationTicks(e), 0);
  if (actual - expected > 1) {
    const fmt = (t: number) => `${+(t / (1920 / time[1])).toFixed(2)}/${time[1]}`;
    diagnostics.push({
      line: m.line,
      severity: 'warning',
      measure: index + 1,
      message: `Takt ${index + 1}: Länge ${fmt(actual)} statt ${time[0]}/${time[1]}`,
    });
    return;
  }
  const onlyRests = m.events.every((e) => e.kind === 'rest' && !e.artics?.length && !e.text);
  if (onlyRests) {
    const { dynamic, hairpin } = m.events[0];
    m.events = [{ kind: 'rest', duration: 1, dots: 0, fullMeasure: true, ...(dynamic ? { dynamic } : {}), ...(hairpin ? { hairpin } : {}) }];
    return;
  }
  if (expected - actual > 1) {
    const fill = restsFor(expected - actual);
    m.events = index === 0 ? [...fill, ...m.events] : [...m.events, ...fill];
  }
}

/** Zerlegt eine Lücke in möglichst wenige Pausen (ganze, halbe, … 32tel). */
function restsFor(ticks: number): RestEvent[] {
  const out: RestEvent[] = [];
  for (const d of DURATIONS) {
    const t = 1920 / d;
    while (ticks + 1 >= t) {
      out.push({ kind: 'rest', duration: d, dots: 0, auto: true });
      ticks -= t;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Serialisierung (z. B. nach MusicXML-Import)

const DOTS = ['', '.', '..', '...'];

export function serializeNotation(score: Score): string {
  const out: string[] = [];
  if (score.title) out.push(`title: ${score.title}`);
  if (score.composer) out.push(`composer: ${score.composer}`);
  if (score.arranger) out.push(`arranger: ${score.arranger}`);
  out.push(`key: ${keyName(score.key)}`);
  out.push(`time: ${score.time[0]}/${score.time[1]}`);
  if (score.tempo) out.push(`tempo: ${score.tempo}`);
  out.push('');

  let key = score.key;
  let lastDur: Duration | null = null;
  let lastDots = 0;
  let tied = new Map<string, number>();
  let curHairpin: 'cresc' | 'dim' | null = null;
  const articStr = (a?: Articulation[]) => (a ?? []).map((x) => ARTIC_BY_NAME[x]).join('');
  const lineParts: string[] = [];

  score.measures.forEach((m, i) => {
    const acc = new Map<string, number>();
    const parts: string[] = [];
    if (m.repeatStart) parts.push('|:');
    if (m.keyChange !== undefined) {
      key = m.keyChange;
      parts.push(`[key ${keyName(key)}]`);
    }
    if (m.timeChange) parts.push(`[time ${m.timeChange[0]}/${m.timeChange[1]}]`);
    if (m.tempoChange) parts.push(`[tempo ${m.tempoChange}]`);
    if (m.section) parts.push(`[section ${m.section.marker} ${m.section.text}]`.replace(/\s+\]$/, ']'));
    if (m.volta) parts.push(`[volta ${m.volta.join(',')}]`);
    for (const j of m.jumps) parts.push(`[${jumpLabel(j)}]`);
    for (const t of m.texts) parts.push(`[text ${t}]`);
    if (m.multiRest) parts.push(`[rest ${m.multiRest}]`);

    let tuplet: number | undefined;
    for (const e of m.events) {
      if (e.kind === 'rest' && e.auto) continue; // ergänzte Pausen entstehen beim Einlesen neu
      if (e.tuplet !== tuplet) {
        if (tuplet) parts.push('}');
        if (e.tuplet) parts.push(`{${e.tuplet}`);
        tuplet = e.tuplet;
      }
      if ((e.hairpin ?? null) !== curHairpin) {
        parts.push(e.hairpin === 'cresc' ? '\\<' : e.hairpin === 'dim' ? '\\>' : '\\!');
        curHairpin = e.hairpin ?? null;
      }
      if (e.dynamic) parts.push(`!${e.dynamic}`);
      if (e.text) parts.push(`"${e.text}"`);
      if (e.kind === 'rest' && e.fullMeasure) {
        parts.push(`R${articStr(e.artics)}`);
        tied = new Map();
        continue;
      }
      let dur = '';
      if (e.duration !== lastDur || e.dots !== lastDots) {
        dur = `/${e.duration}${DOTS[e.dots]}`;
        lastDur = e.duration;
        lastDots = e.dots;
      }
      if (e.kind === 'rest') {
        parts.push(`r${dur}${articStr(e.artics)}`);
        tied = new Map();
        continue;
      }
      const heads = e.notes.map((n) => {
        const id = `${n.pitch.step}${n.pitch.octave}`;
        const expected = tied.get(id) ?? acc.get(id) ?? keyAlter(key, n.pitch.step);
        let accStr = '';
        if (n.pitch.alter !== expected) {
          accStr = n.pitch.alter === 0 ? 'n' : n.pitch.alter > 0 ? '#'.repeat(n.pitch.alter) : 'b'.repeat(-n.pitch.alter);
        }
        if (accStr) acc.set(id, n.pitch.alter);
        return `${n.pitch.step}${accStr}${n.pitch.octave}${n.forcedString ? '@' + n.forcedString : ''}`;
      });
      tied = new Map();
      if (e.tieToNext) for (const n of e.notes) tied.set(`${n.pitch.step}${n.pitch.octave}`, n.pitch.alter);
      const tie = e.tieToNext ? '~' : '';
      const art = articStr(e.artics);
      parts.push(heads.length === 1 ? `${heads[0]}${dur}${tie}${art}` : `(${heads.join(' ')})${dur}${tie}${art}`);
    }
    if (tuplet) parts.push('}');

    let bar = '|';
    if (m.repeatEnd) bar = m.repeatEnd === 2 ? ':|' : `:|x${m.repeatEnd}`;
    else if (m.barlineRight === 'double') bar = '||';
    else if (m.barlineRight === 'final') bar = '|]';
    lineParts.push(`${parts.join(' ')} ${bar}`);
    if ((i + 1) % 4 === 0) {
      out.push(lineParts.join(' '));
      lineParts.length = 0;
    }
  });
  if (lineParts.length) out.push(lineParts.join(' '));
  return out.join('\n') + '\n';
}

function jumpLabel(j: Jump): string {
  const labels: Record<Jump, string> = {
    segno: 'segno', coda: 'coda', fine: 'fine', daCapo: 'D.C.', daCapoAlCoda: 'D.C. al Coda',
    daCapoAlFine: 'D.C. al Fine', dalSegno: 'D.S.', dalSegnoAlCoda: 'D.S. al Coda', dalSegnoAlFine: 'D.S. al Fine',
    daCoda: 'to Coda',
  };
  return labels[j];
}
