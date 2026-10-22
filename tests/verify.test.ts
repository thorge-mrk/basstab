import { describe, it, expect } from 'vitest';
import { mergeVerified } from '../src/verify';
import type { RecognizedMeasure } from '../src/gemini';

const m = (number: number, system: number, content: string, page = 1): RecognizedMeasure => ({ number, page, system, content, end: '|' });

describe('Zweiter Durchgang', () => {
  const first = [m(1, 1, 'C3/4 D3 E3 F3'), m(2, 1, 'G3/1'), m(3, 2, 'A3/2 B3'), m(4, 2, 'C4/1'), m(5, 1, 'E2/1', 2)];

  it('übernimmt Korrekturen und meldet, welche Takte sich geändert haben', () => {
    const { measures, changed } = mergeVerified(first, 1, [
      { system: 1, measures: [{ number: 1, content: 'C3/4 D3 Eb3 F3', end: '|' }, { number: 2, content: 'G3/1', end: '|' }] },
    ]);
    expect(measures[0].content).toBe('C3/4 D3 Eb3 F3');
    expect(changed).toEqual([0]);
    // Box, Seite und Zeile bleiben erhalten
    expect(measures[0]).toMatchObject({ page: 1, system: 1, number: 1 });
  });

  it('behält die erste Lesung, wenn sich die Taktzahl einer Zeile ändert', () => {
    const { measures, changed } = mergeVerified(first, 1, [{ system: 2, measures: [{ number: 3, content: 'A3/1', end: '|' }] }]);
    expect(measures.slice(2, 4).map((x) => x.content)).toEqual(['A3/2 B3', 'C4/1']);
    expect(changed).toEqual([]);
  });

  it('fasst nur die eigene Seite an und ignoriert Leerzeichen-Unterschiede', () => {
    const { measures, changed } = mergeVerified(first, 2, [{ system: 1, measures: [{ number: 5, content: ' E2/1 ', end: '|' }] }]);
    expect(changed).toEqual([]);
    expect(measures[0].content).toBe('C3/4 D3 E3 F3');
  });
});
