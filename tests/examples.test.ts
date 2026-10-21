import { describe, it, expect } from 'vitest';
import { parseNotation } from '../src/score';
import { RIFF_PHOTO, RIFF_TAB, GRIP_RIFF, SHOWCASE } from '../src/landing/examples';

describe('Landing-Beispiele', () => {
  for (const [name, src] of Object.entries({ RIFF_PHOTO, RIFF_TAB, GRIP_RIFF, ...SHOWCASE })) {
    it(`${name} ist fehlerfrei`, () => {
      const { diagnostics, score } = parseNotation(src);
      expect(diagnostics).toEqual([]);
      expect(score.measures.length).toBeGreaterThan(0);
    });
  }
});
