// Notenerkennung aus Fotos mit Gemini (Google AI Studio API-Key, läuft im Browser).

import { GoogleGenAI, MediaResolution, ThinkingLevel, ApiError, type Part } from '@google/genai';
import { durationTicks, parseNotation } from './score';

export const MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', hint: 'schnell und günstig – für saubere Fotos' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', hint: 'genauer – für schiefe Handyfotos und dichte Seiten' },
];
export const DEFAULT_MODEL = MODELS[0].id;

/** Normierte Box auf der Seite: [ymin, xmin, ymax, xmax], jeweils 0–1000. */
export type Box = [number, number, number, number];

export interface RecognizedMeasure {
  number: number;
  /** 1-basiert, Reihenfolge der hochgeladenen Fotos */
  page: number;
  box?: Box;
  repeatStart?: boolean;
  content: string;
  end: string;
}

export interface Uncertainty {
  measure: number;
  question: string;
  /** Alternative Lesarten für den ganzen Takt (BassTab-Notation) */
  options: string[];
}

export interface RecognitionResult {
  notation: string;
  measures: RecognizedMeasure[];
  uncertain: Uncertainty[];
  meta: { title: string; composer: string; arranger: string };
}

const SYSTEM_PROMPT = `You are an expert music engraver transcribing printed bass parts (bass guitar / double bass) from photos into a compact text notation called "BassTab notation". Accuracy of every pitch, rhythm and marking matters more than speed.

## How to read the page
- Read ONLY the printed music. Handwritten pencil/pen annotations (note names, fingerings, arrows, crossed-out text) are NOT part of the music. You may use handwritten note names only as a hint when the print is ambiguous.
- Work system by system, measure by measure. Printed measure numbers at the start of systems help you keep count – use them to verify that you did not skip or duplicate a measure.
- If the photo contains a tablature staff under the notation, use the tab numbers to double-check pitches (standard tuning E A D G, string 1 = G).
- Multiple images are consecutive pages of the same part, in order. "page" is the 1-based image number.

## Pitch = staff position (letter + octave, scientific pitch notation, C4 = middle C)
Bass clef lines bottom→top: G2 B2 D3 F3 A3. Spaces bottom→top: A2 C3 E3 G3.
Below the staff: F2 (space under bottom line), E2 (first ledger line), D2, C2 (second ledger line).
Above the staff: B3 (space above top line), C4 (first ledger line), D4, E4 (second ledger line), F4, G4 (third ledger line).
Treble clef lines: E4 G4 B4 D5 F5, spaces F4 A4 C5 E5.
Write the letter of the staff position. Write an accidental ONLY if one is printed directly in front of that note: "#" sharp, "b" flat, "n" natural, "x" double sharp, "bb" double flat. Do NOT apply the key signature yourself and do NOT repeat accidentals that carry through the measure – the software does that automatically.
Examples: printed note on the top space with a sharp → "G#3". Same note later in the measure without accidental → "G3". A natural sign on the second line → "Bn2".

## Rhythm
Duration follows a slash: /1 whole, /2 half, /4 quarter, /8 eighth, /16 sixteenth, /32. Dots after the duration: "/4." dotted quarter, "/8.." double-dotted.
The duration is remembered: if a note has the same duration (incl. dots) as the previous event you may omit it – but ALWAYS write the duration on the first event of every measure.
Tie (curved line connecting two noteheads of the SAME pitch): write "~" directly after the first note: "F3/4~ F3/8". Ignore slurs between different pitches.
Rests: "r/4", "r/8." etc. A whole-measure rest (centered whole rest in a measure) is "R".
Chords (rare): "(E2 B2)/4".
Tuplets: wrap in braces with the number: "{3 C3/8 D3 E3}".
EVERY measure must add up exactly to the time signature (except a pickup measure). Re-check each measure: e.g. in 4/4 "/4. /4. /4" = 1.5+1.5+1 = 4 beats.

## Engraving conventions – apply them silently, never ask about them
- A single rest centered in an otherwise empty measure is a whole-measure rest in ANY time signature (also 3/4, 6/8, 2/2) → "R". This is by far the most common case on bass parts. A whole rest hangs below the 4th line, a half rest sits on the 3rd line – if a lone rest fills the measure visually, it is "R".
- A measure that looks empty is a whole-measure rest → "R".
- If beats look empty after your reading, look again: you probably missed a rest or misread a duration (dot, flag, beam). If it still does not add up, complete the measure with rests yourself. Do not ask.
- The first measure may be a pickup (anacrusis) and is shorter – write only what is printed.
- Repeat-measure sign (slash with two dots, "%"): write the content of the previous measure again; a two-bar repeat sign repeats the previous two measures.
- Rhythm/slash notation without pitches (e.g. comping or "walk" sections): write rests of the same total length and add the printed instruction as [text ...].
- Cue notes (smaller notes, often labelled with another instrument) and grace notes are not played: write rests for cue notes, omit grace notes.
- Chord symbols above the staff (C7, Fm9 …) are not notes – ignore them.
- Courtesy accidentals in parentheses are written like normal accidentals.
- Octave clefs and "8vb"/"8va" lines: write the pitch as printed on the staff (the software handles the bass octave).

## Everything else printed on the part – do not drop any of it
Dynamics: write before the note they apply to: "!pp !p !mp !mf !f !ff !fff", sforzando "!sfz". Example: "!mf F3/4".
Hairpins: "\\<" starts a crescendo, "\\>" a decrescendo (diminuendo) before the first note under it, "\\!" ends it before the first note after it. Written "cresc." / "dim." text counts as a hairpin too.
Articulations directly after the note (after duration, dots and tie): "-." staccato, "->" accent, "--" tenuto, "-^" marcato/strong accent, "\\fermata" fermata (also on rests: "r/4\\fermata", "R\\fermata").
Bass techniques: "-x" dead/muted note (x notehead), "-g" ghost note (parenthesized), "-/" slide to the next note, "-h" hammer-on/pull-off, "-s" slap (S), "-p" pop (P).
Expression or instruction text over a note (e.g. tutti, solo, pizz., arco, swing, fill, ad lib.): write it in double quotes right before the note: ""tutti" F3/4".
Example: "!f "tutti" F3/8-. F3-. r/4 C3/4-> \\< E3/4 | G3/2 \\! !ff C4/2\\fermata".

## Structure (directives in square brackets, placed at the START of the measure they belong to)
[section 1 Strophe 1+2]  rehearsal mark (boxed number/letter) followed by optional text
[volta 1] / [volta 2] / [volta 1,2]  first/second ending bracket starts in this measure
[segno] [coda] [fine] [to coda] [D.S. al Coda] [D.S.] [D.C.] [D.C. al Fine]  navigation signs/texts
[rest 7]  multi-measure rest (thick horizontal bar with a number above) – the whole measure content is just this directive
[key Eb] [time 3/4] [tempo 120]  changes in the middle of the piece
[text Fill]  other printed text that belongs to the measure rather than a single note

Barlines are given by the "end" field of each measure: "|" normal, "||" double bar, ":|" end repeat, "|]" final bar. Repeat start (|: with dots on the right) is the "repeatStart" flag of the measure it starts.

## Output
Return JSON matching the schema, measures in reading order.
- title/composer/arranger exactly as printed ("" if not printed). key: e.g. "Ab", "F", "Eb", "G", "C" – from the number of flats/sharps (4 flats = Ab, 2 sharps = D, none = C). time: e.g. "4/4". tempo: BPM from the metronome mark or 0.
- measures: one entry per printed measure, multi-measure rests as a single entry. "number" is the measure number (a multi-measure rest of 7 bars occupies 7 numbers; the next measure continues after them). "page" is the image it is on. "box" is the bounding box of that measure on its page as [ymin, xmin, ymax, xmax] normalized to 0–1000, from barline to barline horizontally and covering the staff plus notes above and below vertically.
- uncertain: ONLY measures where something that changes what the bassist PLAYS is physically hard to read – blurry, cut off, covered by pencil or a fold – and two readings are both plausible. Typical: an accidental you cannot see clearly, a notehead between line and space, a dot or flag you cannot make out. At most one entry per measure.
  Never ask about: rests, whole-measure rests, measure length, pickups, the conventions above, pencil annotations, dynamics, articulations or text, or anything you can decide from the printed music.
  For each entry: a short, concrete question in German for the bassist (e.g. "Ist die zweite Note ein Gis oder ein G?") and 1–2 alternative readings of the WHOLE measure content in BassTab notation, each with every duration written explicitly, each adding up to the time signature and each differing from your main reading in pitch or rhythm of the notes. On a clean print this list is usually empty.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    composer: { type: 'string' },
    arranger: { type: 'string' },
    key: { type: 'string' },
    time: { type: 'string' },
    tempo: { type: 'integer' },
    measures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          page: { type: 'integer' },
          box: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4 },
          repeatStart: { type: 'boolean' },
          content: { type: 'string' },
          end: { type: 'string', enum: ['|', '||', ':|', '|]'] },
        },
        required: ['number', 'page', 'box', 'content', 'end'],
      },
    },
    uncertain: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          measure: { type: 'integer' },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
        },
        required: ['measure', 'question', 'options'],
      },
    },
  },
  required: ['title', 'key', 'time', 'measures', 'uncertain'],
};

interface RawResult {
  title?: string;
  composer?: string;
  arranger?: string;
  key: string;
  time: string;
  tempo?: number;
  measures: RecognizedMeasure[];
  uncertain?: Uncertainty[];
}

export interface PreparedImage {
  mimeType: string;
  data: string; // base64
  /** data:-URL zum Anzeigen/Ausschneiden (gleiche Pixel wie an Gemini geschickt) */
  url: string;
  width: number;
  height: number;
}

/** Skaliert große Fotos herunter (Gemini braucht keine 12 MP) und korrigiert die EXIF-Drehung. */
export async function prepareImage(file: Blob, maxSide = 2560): Promise<PreparedImage> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bmp) {
    // z. B. HEIC in Chrome: Original schicken, Gemini kann HEIC lesen (ohne Vorschau-Ausschnitte)
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const mimeType = file.type || 'image/heic';
    return { mimeType, data: btoa(bin), url: '', width: 0, height: 0 };
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const url = canvas.toDataURL('image/jpeg', 0.88);
  return { mimeType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), url, width: canvas.width, height: canvas.height };
}

export interface RecognizeOptions {
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  /** Wird für jeden fertig gelesenen Takt aufgerufen, während die Antwort noch streamt. */
  onMeasure?: (m: RecognizedMeasure, index: number) => void;
  onProgress?: (chars: number) => void;
}

export async function recognizeSheet(images: PreparedImage[], opts: RecognizeOptions): Promise<RecognitionResult> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const parts: Part[] = [];
  images.forEach((img, i) => {
    parts.push({ text: `Seite ${i + 1}:` });
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  });
  parts.push({ text: 'Transcribe the bass part on these pages into BassTab notation.' });

  const run = async (withThinking: boolean) => {
    const stream = new MeasureStream(opts.onMeasure);
    const response = await ai.models.generateContentStream({
      model: opts.model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_SCHEMA,
        ...(withThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } } : {}),
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
        abortSignal: opts.signal,
      },
    });
    for await (const chunk of response) {
      stream.push(chunk.text ?? '');
      opts.onProgress?.(stream.text.length);
    }
    return stream.text;
  };

  let text: string;
  try {
    try {
      text = await run(true);
    } catch (e) {
      // Kleinere Modelle (z. B. Flash-Lite) unterstützen evtl. kein thinkingLevel → ohne erneut versuchen
      if (e instanceof ApiError && e.status === 400 && /think/i.test(e.message)) text = await run(false);
      else throw e;
    }
  } catch (e) {
    throw friendlyError(e, opts.model);
  }

  let raw: RawResult;
  try {
    raw = JSON.parse(text) as RawResult;
  } catch {
    throw new Error('Die Antwort war unvollständig (kein gültiges JSON). Bitte nochmal versuchen – oder ein stärkeres Modell wählen.');
  }
  return {
    notation: toNotation(raw),
    measures: raw.measures,
    uncertain: filterUncertain(raw),
    meta: { title: raw.title ?? '', composer: raw.composer ?? '', arranger: raw.arranger ?? '' },
  };
}

function friendlyError(e: unknown, model: string): Error {
  if (e instanceof ApiError) {
    if (e.status === 400 && /API key/i.test(e.message)) return new Error('Der API-Key ist ungültig. Prüfe ihn in den Einstellungen.');
    if (e.status === 403) return new Error('Zugriff verweigert. Ist der Key im AI Studio für die Gemini API freigeschaltet?');
    if (e.status === 404) return new Error(`Das Modell „${model}“ gibt es nicht (mehr). Wähle ein anderes Modell.`);
    if (e.status === 429) return new Error('Kontingent erreicht. Warte kurz oder prüfe die Abrechnung im AI Studio.');
    if (e.status >= 500) return new Error('Gemini ist gerade überlastet. Bitte gleich nochmal versuchen.');
    return new Error(`Gemini-Fehler ${e.status}: ${e.message}`);
  }
  if (e instanceof Error && e.name === 'AbortError') return e;
  if (e instanceof TypeError) return new Error('Keine Verbindung zu Gemini. Bist du online?');
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * Liest gestreamtes JSON mit und meldet jedes vollständige Objekt im Array "measures",
 * sobald seine schließende Klammer ankommt.
 */
export class MeasureStream {
  text = '';
  private arrayStart = -1;
  private scan = 0;
  private depth = 0;
  private inString = false;
  private escape = false;
  private objStart = -1;
  private count = 0;
  private done = false;

  constructor(private onMeasure?: (m: RecognizedMeasure, index: number) => void) {}

  push(chunk: string) {
    this.text += chunk;
    if (this.done || !this.onMeasure) return;
    if (this.arrayStart < 0) {
      const m = /"measures"\s*:\s*\[/.exec(this.text);
      if (!m) return;
      this.arrayStart = m.index + m[0].length;
      this.scan = this.arrayStart;
    }
    const t = this.text;
    for (; this.scan < t.length; this.scan++) {
      const c = t[this.scan];
      if (this.inString) {
        if (this.escape) this.escape = false;
        else if (c === '\\') this.escape = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') this.inString = true;
      else if (c === '{') {
        if (this.depth === 0) this.objStart = this.scan;
        this.depth++;
      } else if (c === '}') {
        this.depth--;
        if (this.depth === 0 && this.objStart >= 0) {
          try {
            this.onMeasure(JSON.parse(t.slice(this.objStart, this.scan + 1)) as RecognizedMeasure, this.count++);
          } catch {
            /* unvollständiges Objekt ignorieren */
          }
          this.objStart = -1;
        }
      } else if (c === ']' && this.depth === 0) {
        this.done = true;
        return;
      }
    }
  }
}

const HAS_EVENT = /(^|\s|\]|\{|\()(?:[A-G](?:##|bb|#|b|n|x)?-?\d|r(?:\/|\s|$)|R(?:\s|$|\\)|\(\s*[A-G])/;

export function toNotation(r: RawResult): string {
  const head: string[] = [];
  if (r.title) head.push(`title: ${r.title}`);
  if (r.composer) head.push(`composer: ${r.composer}`);
  if (r.arranger) head.push(`arranger: ${r.arranger}`);
  head.push(`key: ${r.key || 'C'}`);
  head.push(`time: ${r.time || '4/4'}`);
  if (r.tempo) head.push(`tempo: ${r.tempo}`);

  const lines: string[] = [];
  let line: string[] = [];
  r.measures.forEach((m, i) => {
    let content = m.content.trim().replace(/\|/g, ' ');
    // Takt ohne Noten/Pausen (nur Anweisungen) würde sonst verschluckt
    if (!/\[rest\s+\d+\]/i.test(content) && !HAS_EVENT.test(content)) content = `${content} R`.trim();
    const end = ['|', '||', ':|', '|]'].includes(m.end) ? m.end : '|';
    line.push(`${m.repeatStart ? '|: ' : ''}${content} ${end}`);
    if (line.length === 4 || i === r.measures.length - 1) {
      lines.push(`% Takt ${r.measures[i - line.length + 1].number}\n${line.join(' ')}`);
      line = [];
    }
  });
  return `${head.join('\n')}\n\n${lines.join('\n')}\n`;
}

/**
 * Behält nur Rückfragen, die etwas am Gespielten ändern: Alternativen, die dieselben Töne
 * zur selben Zeit ergeben (etwa andere Pausen oder fehlende Pausen), fallen weg – das gleicht
 * BassTab beim Einlesen ohnehin aus. Pro Takt höchstens eine Frage.
 */
export function filterUncertain(raw: Pick<RawResult, 'key' | 'time' | 'measures' | 'uncertain'>): Uncertainty[] {
  // Taktart je Takt (Wechsel per [time …] im Stück)
  const times: string[] = [];
  let time = raw.time || '4/4';
  for (const m of raw.measures) {
    const t = /\[time\s+(\d+\/\d+)\]/.exec(m.content);
    if (t) time = t[1];
    times.push(time);
  }
  const played = (content: string, t: string): string | null => {
    const { score, diagnostics } = parseNotation(`key: ${raw.key || 'C'}\ntime: ${t}\n\n${content.replace(/\|/g, ' ')} |`);
    if (diagnostics.some((d) => d.severity === 'error') || !score.measures.length) return null;
    let onset = 0;
    const out: string[] = [];
    for (const m of score.measures) {
      for (const e of m.events) {
        const d = durationTicks(e);
        if (e.kind === 'note') out.push(`${onset}:${e.notes.map((n) => n.pitch.midi).sort().join('+')}:${d}${e.tieToNext ? '~' : ''}`);
        onset += d;
      }
    }
    return out.join(' ');
  };
  const asked = new Set<number>();
  const out: Uncertainty[] = [];
  for (const u of raw.uncertain ?? []) {
    const idx = raw.measures.findIndex((m) => m.number === u.measure);
    if (!u.question?.trim() || idx < 0 || asked.has(u.measure)) continue;
    const main = played(raw.measures[idx].content, times[idx]);
    const options = [...new Set((u.options ?? []).map((o) => o.trim()).filter(Boolean))].filter((o) => {
      const p = played(o, times[idx]);
      return p !== null && p !== main;
    });
    if (!options.length) continue;
    asked.add(u.measure);
    out.push({ ...u, options });
  }
  return out;
}

/** Prüft Key und Modell mit einem kostenlosen Metadaten-Aufruf. */
export async function checkKey(apiKey: string, model: string): Promise<void> {
  const ai = new GoogleGenAI({ apiKey });
  try {
    await ai.models.get({ model });
  } catch (e) {
    throw friendlyError(e, model);
  }
}
