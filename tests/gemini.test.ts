import { describe, it, expect } from 'vitest';
import { MeasureStream, filterUncertain, toNotation } from '../src/gemini';
import { parseNotation } from '../src/score';

const RESULT = {
  title: 'Test', composer: '', arranger: '', key: 'Ab', time: '4/4', tempo: 94,
  measures: [
    { number: 1, page: 1, box: [100, 50, 200, 300], content: 'r/4 r r r', end: '|' },
    { number: 2, page: 1, box: [100, 300, 200, 550], content: '[section 1 Strophe] !mf "tutti" F3/4.-> C3 F3/4~', end: '|', repeatStart: true },
    { number: 3, page: 1, box: [100, 550, 200, 800], content: '[segno]', end: ':|' },
    { number: 4, page: 2, box: [100, 50, 200, 300], content: '[rest 4]', end: '|]' },
  ],
  uncertain: [{ measure: 2, question: 'Gis oder G?', options: ['F3/4. C3 G3/4'] }],
};

describe('MeasureStream', () => {
  it('meldet Takte, sobald sie vollständig gestreamt sind', () => {
    const got: number[] = [];
    const s = new MeasureStream((m) => got.push(m.number));
    const json = JSON.stringify(RESULT);
    for (let i = 0; i < json.length; i += 7) s.push(json.slice(i, i + 7));
    expect(got).toEqual([1, 2, 3, 4]);
    expect(JSON.parse(s.text)).toEqual(RESULT);
  });

  it('ignoriert Klammern in Strings', () => {
    const got: string[] = [];
    const s = new MeasureStream((m) => got.push(m.content));
    s.push('{"measures":[{"number":1,"content":"{3 C3/8 D3 E3} \\"}\\" R","end":"|"}]}');
    expect(got).toEqual(['{3 C3/8 D3 E3} "}" R']);
  });
});

describe('toNotation', () => {
  it('erzeugt parsebare Notation, auch für Takte nur mit Anweisungen', () => {
    const text = toNotation(RESULT as never);
    const { score, diagnostics } = parseNotation(text);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(score.measures.length).toBe(4);
    expect(score.measures[1].repeatStart).toBe(true);
    expect(score.measures[2].jumps).toEqual(['segno']);
    expect(score.measures[3].multiRest).toBe(4);
  });
});

describe('Rückfragen filtern', () => {
  const measures = [
    { number: 1, page: 1, content: 'r/2 r/4', end: '|' },
    { number: 2, page: 1, content: 'G2/4 A2 B2', end: '|' },
    { number: 3, page: 1, content: 'F#3/4 G3/2.', end: '|' },
  ];
  const base = { key: 'G', time: '3/4', measures };

  it('verwirft Fragen, die nur Pausen betreffen', () => {
    const uncertain = filterUncertain({
      ...base,
      uncertain: [{ measure: 1, question: 'Soll der ganze Takt pausieren?', options: ['R', 'r/2.'] }],
    });
    expect(uncertain).toEqual([]);
  });

  it('verwirft Alternativen, die genauso klingen', () => {
    expect(filterUncertain({ ...base, uncertain: [{ measure: 2, question: 'Gleich?', options: ['G2/4 A2/4 B2/4'] }] })).toEqual([]);
  });

  it('behält echte Lesefragen und pro Takt nur eine', () => {
    const uncertain = filterUncertain({
      ...base,
      uncertain: [
        { measure: 3, question: 'Fis oder F?', options: ['Fn3/4 G3/2.', 'F#3/4 G3/2.'] },
        { measure: 3, question: 'Nochmal?', options: ['A3/4 G3/2.'] },
      ],
    });
    expect(uncertain).toEqual([{ measure: 3, question: 'Fis oder F?', options: ['Fn3/4 G3/2.'] }]);
  });
});
