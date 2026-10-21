// Notenerkennung aus Fotos mit Gemini (Google AI Studio API-Key, läuft im Browser).

import { GoogleGenAI, MediaResolution, ThinkingLevel, ApiError, type Part } from '@google/genai';

export const DEFAULT_MODEL = 'gemini-3.8-flash';

export interface RecognitionResult {
  notation: string;
  uncertain: { measure: number; note: string }[];
}

const SYSTEM_PROMPT = `You are an expert music engraver transcribing printed bass parts (bass guitar / double bass) from photos into a compact text notation called "BassTab notation". Accuracy of every pitch and rhythm matters more than speed.

## How to read the page
- Read ONLY the printed music. Handwritten pencil/pen annotations (note names, fingerings, arrows, crossed-out text) are NOT part of the music. You may use handwritten note names only as a hint when the print is ambiguous.
- Work system by system, measure by measure. Printed measure numbers at the start of systems help you keep count – use them to verify that you did not skip or duplicate a measure.
- If the photo contains a tablature staff under the notation, use the tab numbers to double-check pitches (standard tuning E A D G, string 1 = G).
- Multiple images are consecutive pages of the same part, in order.

## Pitch = staff position (letter + octave, scientific pitch notation, C4 = middle C)
Bass clef lines bottom→top: G2 B2 D3 F3 A3. Spaces bottom→top: A2 C3 E3 G3.
Below the staff: F2 (space under bottom line), E2 (first ledger line), D2, C2 (second ledger line).
Above the staff: B3 (space above top line), C4 (first ledger line), D4, E4 (second ledger line), F4, G4 (third ledger line).
Treble clef lines: E4 G4 B4 D5 F5, spaces F4 A4 C5 E5.
Write the letter of the staff position. Write an accidental ONLY if one is printed directly in front of that note: "#" sharp, "b" flat, "n" natural, "x" double sharp, "bb" double flat. Do NOT apply the key signature yourself and do NOT repeat accidentals that carry through the measure – the software does that automatically.
Examples: printed note on the top space with a sharp → "G#3". Same note later in the measure without accidental → "G3". A natural sign on the second line → "Bn2".

## Rhythm
Duration follows a slash: /1 whole, /2 half, /4 quarter, /8 eighth, /16 sixteenth, /32. Dots after the duration: "/4." dotted quarter, "/8.." double-dotted.
The duration is remembered: if a note has the same duration (incl. dots) as the previous event you may omit it. When in doubt write it explicitly.
Tie (curved line connecting two noteheads of the SAME pitch): write "~" directly after the first note: "F3/4~ F3/8". Ignore slurs between different pitches.
Rests: "r/4", "r/8." etc. A whole-measure rest (centered whole rest in a measure) is "R".
Chords (rare): "(E2 B2)/4".
Tuplets: wrap in braces with the number: "{3 C3/8 D3 E3}".
EVERY measure must add up exactly to the time signature (except a pickup measure). Re-check each measure: e.g. in 4/4 "/4. /4. /4" = 1.5+1.5+1 = 4 beats.

## Structure (directives in square brackets, placed at the START of the measure they belong to)
[section 1 Strophe 1+2]  rehearsal mark (boxed number/letter) followed by optional text
[volta 1] / [volta 2] / [volta 1,2]  first/second ending bracket starts in this measure
[segno] [coda] [fine] [to coda] [D.S. al Coda] [D.S.] [D.C.] [D.C. al Fine]  navigation signs/texts
[rest 7]  multi-measure rest (thick horizontal bar with a number above) – the whole measure content is just this directive
[key Eb] [time 3/4] [tempo 120]  changes in the middle of the piece
[text Fill]  other printed expression text

Barlines are given by the "end" field of each measure: "|" normal, "||" double bar, ":|" end repeat, "|]" final bar. Repeat start (|: with dots on the right) is the "repeatStart" flag of the measure it starts.

## Output
Return JSON matching the schema. key: e.g. "Ab", "F", "Eb", "G", "C" – derived from the number of flats/sharps in the key signature (4 flats = Ab, 2 sharps = D, none = C). time: e.g. "4/4". tempo: BPM number from the metronome mark or 0.
measures: one entry per printed measure in reading order, including multi-measure rests as a single entry. "number" is the printed/actual measure number of that measure (a multi-measure rest of 7 bars occupies 7 numbers; the next measure continues after them).
uncertain: list measures where the photo was unclear and the user should double-check, with a short German note.`;

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
          repeatStart: { type: 'boolean' },
          content: { type: 'string' },
          end: { type: 'string', enum: ['|', '||', ':|', '|]'] },
        },
        required: ['number', 'content', 'end'],
      },
    },
    uncertain: {
      type: 'array',
      items: {
        type: 'object',
        properties: { measure: { type: 'integer' }, note: { type: 'string' } },
        required: ['measure', 'note'],
      },
    },
  },
  required: ['key', 'time', 'measures'],
};

interface RawResult {
  title?: string;
  composer?: string;
  arranger?: string;
  key: string;
  time: string;
  tempo?: number;
  measures: { number: number; repeatStart?: boolean; content: string; end: string }[];
  uncertain?: { measure: number; note: string }[];
}

export interface PreparedImage {
  mimeType: string;
  data: string; // base64
}

/** Skaliert große Fotos herunter (Gemini braucht keine 12 MP) und korrigiert die EXIF-Drehung. */
export async function prepareImage(file: File, maxSide = 3072): Promise<PreparedImage> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const url = canvas.toDataURL('image/jpeg', 0.92);
    return { mimeType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
  } catch {
    // z. B. HEIC in Chrome: Original schicken, Gemini kann HEIC lesen
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { mimeType: file.type || 'image/jpeg', data: btoa(bin) };
  }
}

export async function recognizeSheet(
  images: PreparedImage[],
  apiKey: string,
  model: string,
  onProgress: (chars: number) => void,
  signal?: AbortSignal,
): Promise<RecognitionResult> {
  const ai = new GoogleGenAI({ apiKey });
  const parts: Part[] = [];
  images.forEach((img, i) => {
    parts.push({ text: `Seite ${i + 1}:` });
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  });
  parts.push({ text: 'Transcribe the bass part on these pages into BassTab notation.' });

  let text = '';
  try {
    const stream = await ai.models.generateContentStream({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
        abortSignal: signal,
      },
    });
    for await (const chunk of stream) {
      text += chunk.text ?? '';
      onProgress(text.length);
    }
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 400 && /API key/i.test(e.message)) throw new Error('API-Key ungültig. Bitte in den Einstellungen prüfen.');
      if (e.status === 403) throw new Error('Zugriff verweigert (403). Ist der API-Key für die Gemini API freigeschaltet?');
      if (e.status === 404) throw new Error(`Modell "${model}" nicht gefunden. Bitte Modellnamen in den Einstellungen prüfen.`);
      if (e.status === 429) throw new Error('Rate-Limit/Kontingent erreicht (429). Kurz warten oder Abrechnung im AI Studio prüfen.');
      throw new Error(`Gemini-Fehler ${e.status}: ${e.message}`);
    }
    throw e;
  }

  let raw: RawResult;
  try {
    raw = JSON.parse(text) as RawResult;
  } catch {
    throw new Error('Antwort von Gemini war kein gültiges JSON (evtl. abgeschnitten). Bitte erneut versuchen.');
  }
  return { notation: toNotation(raw), uncertain: raw.uncertain ?? [] };
}

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
    const content = m.content.trim().replace(/\|/g, ' ') || 'R';
    const end = ['|', '||', ':|', '|]'].includes(m.end) ? m.end : '|';
    line.push(`${m.repeatStart ? '|: ' : ''}${content} ${end}`);
    const next = r.measures[i + 1];
    if (line.length === 4 || !next) {
      lines.push(`% Takt ${r.measures[i - line.length + 1].number}\n${line.join(' ')}`);
      line = [];
    }
  });
  return `${head.join('\n')}\n\n${lines.join('\n')}\n`;
}
