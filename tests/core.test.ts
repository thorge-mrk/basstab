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

  it('meldet zu lange Takte', () => {
    const { diagnostics } = parseNotation('time: 4/4\nC3/1 | C3/2 C3/2 C3/4 |');
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].measure).toBe(2);
  });

  it('füllt zu kurze Takte still mit Pausen auf', () => {
    const { score, diagnostics } = parseNotation('time: 4/4\nC3/4 | D3/4 E3 F3 | G3/8 |');
    expect(diagnostics).toEqual([]);
    const [pickup, mid, last] = score.measures;
    // Auftakt: Pausen davor
    expect(pickup.events.map((e) => e.kind)).toEqual(['rest', 'rest', 'note']);
    expect(mid.events.at(-1)).toMatchObject({ kind: 'rest', duration: 4, auto: true });
    expect(last.events.slice(1).map((e) => e.duration)).toEqual([2, 4, 8]);
  });

  it('macht aus einem Takt nur mit Pausen eine Ganztaktpause', () => {
    const { score, diagnostics } = parseNotation('time: 3/4\nr/2 | C3/2. |');
    expect(diagnostics).toEqual([]);
    expect(score.measures[0].events).toEqual([{ kind: 'rest', duration: 1, dots: 0, fullMeasure: true }]);
  });

  it('ergänzte Pausen landen nicht im Quelltext', () => {
    const src = 'time: 4/4\n\nD3/4 E3 F3 | G3/1 |\n';
    expect(serializeNotation(parseNotation(src).score)).not.toMatch(/r/);
  });

  it('Serialisierung ist verlustfrei', () => {
    const a = parseNotation(SAMPLE).score;
    const b = parseNotation(serializeNotation(a)).score;
    expect(b).toEqual({ ...a, measures: a.measures.map((m, i) => ({ ...m, line: b.measures[i].line, src: b.measures[i].src })) });
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

describe('Ausdruck', () => {
  const SRC = 'key: C\n!mf C3/4-. \\< D3-> E3-- \\! F3-^ | !p "tutti" G3/2\\fermata \\> r/4 A3/4-x | B2/4-g C3-/ D3-h E3 | r/1\\fermata |';
  it('parst Dynamik, Gabeln, Artikulationen und Text', () => {
    const { score, diagnostics } = parseNotation(SRC);
    expect(diagnostics).toEqual([]);
    const [m1, m2, m3, m4] = score.measures.map((m) => m.events);
    expect(m1[0]).toMatchObject({ dynamic: 'mf', artics: ['staccato'] });
    expect(m1[1]).toMatchObject({ hairpin: 'cresc', artics: ['accent'] });
    expect(m1[2]).toMatchObject({ hairpin: 'cresc', artics: ['tenuto'] });
    expect(m1[3].hairpin).toBeUndefined();
    expect(m2[0]).toMatchObject({ dynamic: 'p', text: 'tutti', artics: ['fermata'] });
    expect(m2[1]).toMatchObject({ kind: 'rest', hairpin: 'dim' });
    expect(m2[2]).toMatchObject({ artics: ['dead'] });
    expect(m3.map((e) => e.artics?.[0])).toEqual(['ghost', 'slide', 'hammer', undefined]);
    expect(m4[0]).toMatchObject({ kind: 'rest', artics: ['fermata'] });
  });

  it('Serialisierung behält Ausdruck', () => {
    const a = parseNotation(SRC).score;
    const b = parseNotation(serializeNotation(a)).score;
    expect(b.measures.map((m) => m.events)).toEqual(a.measures.map((m) => m.events));
  });

  it('überträgt Ausdruck nach alphaTab', () => {
    const { score } = parseNotation(SRC);
    const { fingering } = computeFingering(score, DEFAULT_SETUP);
    const tex = toAlphaTex(score, fingering, DEFAULT_SETUP, { showNotation: true, showTab: true });
    const imp = new alphaTab.importer.AlphaTexImporter();
    imp.initFromString(tex, new alphaTab.Settings());
    const beats = imp.readScore().tracks[0].staves[0].bars.flatMap((b) => b.voices[0].beats);
    expect(beats[0].dynamics).toBe(alphaTab.model.DynamicValue.MF);
    expect(beats[0].notes[0].isStaccato).toBe(true);
    expect(beats[1].crescendo).toBe(alphaTab.model.CrescendoType.Crescendo);
    expect(beats[1].notes[0].accentuated).toBe(alphaTab.model.AccentuationType.Normal);
    expect(beats[3].notes[0].accentuated).toBe(alphaTab.model.AccentuationType.Heavy);
    expect(beats[4].dynamics).toBe(alphaTab.model.DynamicValue.P);
    expect(beats[4].text).toBe('tutti');
    expect(beats[4].fermata).not.toBeNull();
    expect(beats[6].notes[0].isDead).toBe(true);
    expect(beats[7].notes[0].isGhost).toBe(true);
  });
});

describe('Quelltext-Bereiche', () => {
  it('liefert pro Takt den bearbeitbaren Bereich', () => {
    const src = 'key: C\n\n|: C3/4 D3 E3 F3 | [section A] G3/1 :| R |]\n';
    const { score } = parseNotation(src);
    const slices = score.measures.map((m) => src.slice(m.src.start, m.src.end).trim());
    expect(slices).toEqual(['C3/4 D3 E3 F3', '[section A] G3/1', 'R']);
  });
});
