import { describe, it, expect } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { parseNotation, serializeNotation } from '../src/score';
import { computeFingering, DEFAULT_SETUP } from '../src/fingering';
import { toAlphaTex } from '../src/alphatex';
import { DEMO as SAMPLE } from '../src/demo';

describe('Notation', () => {
  it('parst das Beispiel ohne Fehler und wendet die Tonart an', () => {
    const { score, diagnostics } = parseNotation(SAMPLE);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(diagnostics.filter((d) => d.measure !== 1)).toEqual([]);
    expect(score.key).toBe(-4);
    // Takt 6: D3 in As-Dur = Des3
    const m6 = score.measures[5].events[0];
    expect(m6.kind === 'note' && m6.notes[0].pitch.midi).toBe(49);
    // Takt 2: G#3 dann G-Auflösung
    const m2 = score.measures[1].events;
    expect(m2[1].kind === 'note' && m2[1].notes[0].pitch.midi).toBe(56);
    expect(m2[2].kind === 'note' && m2[2].notes[0].pitch.midi).toBe(55);
  });

  it('übernimmt Versetzungszeichen über Haltebögen', () => {
    const { score } = parseNotation('key: C\nF#3/2~ | F3/2 F3 |');
    const [a, b] = [score.measures[1].events[0], score.measures[1].events[1]];
    expect(a.kind === 'note' && a.notes[0].pitch.midi).toBe(54);
    expect(b.kind === 'note' && b.notes[0].pitch.midi).toBe(53);
  });

  it('meldet falsche Taktlängen', () => {
    const { diagnostics } = parseNotation('time: 4/4\nC3/4 C3 C3 | C3/1 |');
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].measure).toBe(1);
  });

  it('Serialisierung ist verlustfrei', () => {
    const a = parseNotation(SAMPLE).score;
    const b = parseNotation(serializeNotation(a)).score;
    expect(b).toEqual({ ...a, measures: a.measures.map((m, i) => ({ ...m, line: b.measures[i].line })) });
  });
});

describe('Griffbild', () => {
  it('bleibt bei einfachem Riff in einer Lage', () => {
    const { score } = parseNotation('key: C\nF2/4 A2 C3 F3 | F2/4 A2 C3 F3 |');
    const { fingering } = computeFingering(score, DEFAULT_SETUP);
    const pos = fingering.flat().map((p) => `${p[0].string}:${p[0].fret}`);
    // F2 E-Saite 1, A2 Leersaite oder E5, C3 A3, F3 D3
    const frets = fingering.flat().map((p) => p[0].fret).filter((f) => f > 0);
    expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(4);
    expect(pos.length).toBe(8);
  });

  it('respektiert erzwungene Saiten und Haltebögen', () => {
    const { score } = parseNotation('key: C\nC3@4/2~ C3/2 |');
    const { fingering } = computeFingering(score, DEFAULT_SETUP);
    expect(fingering[0][0][0]).toEqual({ string: 0, fret: 8 });
    expect(fingering[0][1][0]).toEqual({ string: 0, fret: 8 });
  });
});

describe('alphaTex', () => {
  it('erzeugt gültiges alphaTex mit korrekten Tonhöhen', () => {
    const { score } = parseNotation(SAMPLE);
    const { fingering } = computeFingering(score, DEFAULT_SETUP);
    const tex = toAlphaTex(score, fingering, DEFAULT_SETUP, { showNotation: true, showTab: true });
    const settings = new alphaTab.Settings();
    const imp = new alphaTab.importer.AlphaTexImporter();
    imp.initFromString(tex, settings);
    const s = imp.readScore();
    const expected = score.measures.flatMap((m) =>
      m.multiRest ? [] : m.events.flatMap((e) => (e.kind === 'note' ? e.notes.map((n) => n.pitch.midi) : [])),
    );
    const actual = s.tracks[0].staves[0].bars.flatMap((b) => b.voices[0].beats.flatMap((bt) => bt.notes.map((n) => n.displayValue)));
    expect(actual).toEqual(expected);
    // klingend eine Oktave tiefer
    expect(s.tracks[0].staves[0].bars[1].voices[0].beats[1].notes[0].realValue).toBe(expected[0] - 12);
    const expectedBars = score.measures.reduce((n, m) => n + (m.multiRest ?? 1), 0);
    expect(s.masterBars.length).toBe(expectedBars);
    expect(s.masterBars[23].isRepeatStart).toBe(true);
  });
});
