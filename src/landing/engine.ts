// Nachgeladener Teil der Landing Page: Notenlogik + alphaTab.

import { parseNotation } from '../score';
import { computeFingering, DEFAULT_SETUP, type BassSetup } from '../fingering';
import { toAlphaTex } from '../alphatex';

export { ScoreView } from '../render';

interface Opts {
  view: 'both' | 'score' | 'tab';
  technique?: BassSetup['technique'];
  openStrings?: BassSetup['openStrings'];
}

const setupOf = (o: Opts): BassSetup => ({
  ...DEFAULT_SETUP,
  technique: o.technique ?? 'ofpf',
  openStrings: o.openStrings ?? 'neutral',
});

export function texFor(notation: string, o: Opts): string {
  const { score } = parseNotation(notation);
  const setup = setupOf(o);
  const { fingering } = computeFingering(score, setup);
  return toAlphaTex(score, fingering, setup, { showNotation: o.view !== 'tab', showTab: o.view !== 'score' });
}

/** Zahlen zum Griffbild: Leersaiten, Saitenwechsel, höchster Bund. */
export function fingeringStats(notation: string, o: Opts) {
  const { score } = parseNotation(notation);
  const { fingering } = computeFingering(score, setupOf(o));
  const positions = fingering.flat().filter((p) => p.length).map((p) => p[0]);
  let crossings = 0;
  for (let i = 1; i < positions.length; i++) if (positions[i].string !== positions[i - 1].string) crossings++;
  return {
    open: positions.filter((p) => p.fret === 0).length,
    crossings,
    maxFret: Math.max(0, ...positions.map((p) => p.fret)),
  };
}
