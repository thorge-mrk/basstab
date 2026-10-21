// MusicXML-Import (z. B. aus Audiveris, MuseScore oder Scan-Apps) – ohne KI.

import type { Score, Measure, MusicEvent, Duration, Step, NoteHead, Jump } from './score';
import { DURATIONS, midiOf } from './score';

const TYPE_TO_DUR: Record<string, Duration> = {
  whole: 1, half: 2, quarter: 4, eighth: 8, '16th': 16, '32nd': 32,
};

export function parseMusicXml(xml: string): Score {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Datei ist kein gültiges XML');
  if (!doc.querySelector('score-partwise')) {
    throw new Error('Nur "score-partwise" MusicXML wird unterstützt (Standard bei MuseScore/Audiveris)');
  }

  const parts = [...doc.querySelectorAll('score-partwise > part')];
  if (!parts.length) throw new Error('Keine Stimme in der Datei gefunden');
  const names = new Map(
    [...doc.querySelectorAll('part-list > score-part')].map((p) => [p.getAttribute('id'), p.querySelector('part-name')?.textContent ?? '']),
  );
  // Bass-Stimme bevorzugen, sonst Stimme mit F-Schlüssel, sonst die erste
  const part =
    parts.find((p) => /bass|bajo|kontrabass/i.test(names.get(p.getAttribute('id')) ?? '')) ??
    parts.find((p) => p.querySelector('attributes clef sign')?.textContent === 'F') ??
    parts[0];

  const text = (sel: string) => doc.querySelector(sel)?.textContent?.trim() ?? '';
  const score: Score = {
    title: text('work > work-title') || text('movement-title'),
    composer: text('identification > creator[type="composer"]'),
    arranger: text('identification > creator[type="arranger"]'),
    key: 0,
    time: [4, 4],
    measures: [],
  };

  let divisions = 1;
  let first = true;
  let pendingMultiRest = 0;

  for (const mEl of part.querySelectorAll(':scope > measure')) {
    if (pendingMultiRest > 0) {
      pendingMultiRest--;
      continue;
    }
    const m: Measure = { events: [], repeatStart: false, repeatEnd: 0, jumps: [], texts: [], line: 0 };
    let lastNote: (MusicEvent & { kind: 'note' }) | null = null;

    for (const el of mEl.children) {
      switch (el.tagName) {
        case 'attributes': {
          const div = el.querySelector('divisions');
          if (div) divisions = Number(div.textContent);
          const fifths = el.querySelector('key > fifths');
          if (fifths) {
            const k = Number(fifths.textContent);
            if (first) score.key = k;
            else m.keyChange = k;
          }
          const beats = el.querySelector('time > beats');
          const beatType = el.querySelector('time > beat-type');
          if (beats && beatType) {
            const t: [number, number] = [Number(beats.textContent), Number(beatType.textContent)];
            if (first) score.time = t;
            else m.timeChange = t;
          }
          const mr = el.querySelector('measure-style > multiple-rest');
          if (mr) {
            m.multiRest = Number(mr.textContent);
            pendingMultiRest = m.multiRest - 1;
          }
          break;
        }
        case 'direction': {
          if (el.querySelector('segno')) m.jumps.push('segno');
          if (el.querySelector('coda')) m.jumps.push('coda');
          const reh = el.querySelector('rehearsal')?.textContent?.trim();
          if (reh) m.section = { marker: reh, text: '' };
          for (const w of el.querySelectorAll('words')) {
            const t = w.textContent?.trim();
            if (!t) continue;
            const j = wordsToJump(t);
            if (j) m.jumps.push(j);
            else if (m.section && !m.section.text && reh) m.section.text = t;
            else m.texts.push(t);
          }
          const tempo = el.querySelector('sound[tempo]')?.getAttribute('tempo');
          if (tempo) {
            if (first && !score.tempo) score.tempo = Math.round(Number(tempo));
            else m.tempoChange = Math.round(Number(tempo));
          }
          break;
        }
        case 'sound': {
          const tempo = el.getAttribute('tempo');
          if (tempo && first && !score.tempo) score.tempo = Math.round(Number(tempo));
          break;
        }
        case 'barline': {
          const rep = el.querySelector('repeat');
          if (rep?.getAttribute('direction') === 'forward') m.repeatStart = true;
          if (rep?.getAttribute('direction') === 'backward') m.repeatEnd = Number(rep.getAttribute('times') ?? 2) || 2;
          const ending = el.querySelector('ending');
          if (ending?.getAttribute('type') === 'start') {
            m.volta = (ending.getAttribute('number') ?? '1').split(/[,\s]+/).map(Number).filter((n) => n > 0);
          }
          const style = el.querySelector('bar-style')?.textContent;
          if (el.getAttribute('location') !== 'left') {
            if (style === 'light-light') m.barlineRight = 'double';
            if (style === 'light-heavy' && !m.repeatEnd) m.barlineRight = 'final';
          }
          break;
        }
        case 'note': {
          if (el.querySelector('grace') || el.querySelector('cue')) break;
          const voice = el.querySelector('voice')?.textContent ?? '1';
          if (voice !== '1') break;
          const isChord = !!el.querySelector('chord');
          const { duration, dots } = noteDuration(el, divisions);
          const tm = el.querySelector('time-modification > actual-notes');
          const tuplet = tm ? Number(tm.textContent) : undefined;
          const tieStart = [...el.querySelectorAll(':scope > tie')].some((t) => t.getAttribute('type') === 'start');

          if (el.querySelector('rest')) {
            const full = el.querySelector('rest')?.getAttribute('measure') === 'yes' || !el.querySelector('type');
            m.events.push({ kind: 'rest', duration, dots, tuplet, fullMeasure: full || undefined });
            lastNote = null;
            break;
          }
          const p = el.querySelector('pitch');
          if (!p) break; // unpitched
          const step = p.querySelector('step')!.textContent!.trim() as Step;
          const alter = Math.round(Number(p.querySelector('alter')?.textContent ?? 0));
          const octave = Number(p.querySelector('octave')!.textContent);
          const head: NoteHead = { pitch: { step, alter, octave, midi: midiOf(step, alter, octave) } };
          const str = el.querySelector('technical > string')?.textContent;
          if (str) head.forcedString = Number(str);

          if (isChord && lastNote) {
            lastNote.notes.push(head);
            lastNote.tieToNext ||= tieStart;
          } else {
            lastNote = { kind: 'note', notes: [head], duration, dots, tieToNext: tieStart, tuplet };
            m.events.push(lastNote);
          }
          break;
        }
      }
    }
    if (m.multiRest) m.events = [];
    score.measures.push(m);
    first = false;
  }
  return score;
}

function noteDuration(el: Element, divisions: number): { duration: Duration; dots: number } {
  const type = el.querySelector('type')?.textContent?.trim();
  const dots = el.querySelectorAll('dot').length;
  if (type && TYPE_TO_DUR[type]) return { duration: TYPE_TO_DUR[type], dots };
  // Fallback: aus <duration> ableiten
  const quarters = Number(el.querySelector('duration')?.textContent ?? divisions) / divisions;
  for (const d of DURATIONS) {
    const base = 4 / d;
    if (Math.abs(base - quarters) < 1e-6) return { duration: d, dots: 0 };
    if (Math.abs(base * 1.5 - quarters) < 1e-6) return { duration: d, dots: 1 };
  }
  return { duration: 4, dots: 0 };
}

function wordsToJump(t: string): Jump | null {
  const s = t.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^d\.? ?s\.? al coda/.test(s) || s === 'dal segno al coda') return 'dalSegnoAlCoda';
  if (/^d\.? ?s\.? al fine/.test(s)) return 'dalSegnoAlFine';
  if (/^d\.? ?s\.?$/.test(s) || s === 'dal segno') return 'dalSegno';
  if (/^d\.? ?c\.? al coda/.test(s)) return 'daCapoAlCoda';
  if (/^d\.? ?c\.? al fine/.test(s)) return 'daCapoAlFine';
  if (/^d\.? ?c\.?$/.test(s) || s === 'da capo') return 'daCapo';
  if (s === 'fine') return 'fine';
  if (s === 'to coda' || s === 'al coda') return 'daCoda';
  return null;
}
