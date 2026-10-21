// Eigens gesetzte Notenbeispiele für die Landing Page (keine fremden Arrangements).

const HEAD = 'key: Bb\ntime: 4/4\n\n';

/** Tumbao-Figur in B-Dur; im „Foto“ mit Bleistift-Notennamen, wie Bassisten sie über die Noten schreiben. */
export const RIFF_PHOTO = `${HEAD}!mf "g" G2/4. "d" D3 "g" G3/4~ | G3/4. D3 "f" F3/4~ | F3/4. "c" C3 F3/4~ | F3/4. A3/8 C4 D4/8 "es?" E4/4-> |]`;
export const RIFF_TAB = `${HEAD}!mf G2/4. D3 G3/4~ | G3/4. D3 F3/4~ | F3/4. C3 F3/4~ | F3/4. A3/8 C4 D4/8 E4/4-> |]`;

/** Riff für das Griffbild-Spiel: profitiert sichtbar von Leersaiten bzw. Lagenspiel. */
export const GRIP_RIFF = 'key: C\ntime: 4/4\n\nA2/8 C3 D3 E3 G3/4 A3/4 | G3/8 E3 D3 C3 A2/4 r/4 | D3/8 F3 G3 A3 C4/4 D4/4 | C4/8 A3 G3 E3 D3/2 |]';

export const SHOWCASE: Record<string, string> = {
  repeat: `${HEAD}|: G2/4 D3 G3 D3 | [volta 1] G2/2 D3/2 :| [volta 2] G2/1 |]`,
  jump: `${HEAD}[section A Intro] [segno] G2/4 A2 B2 D3 | [D.S. al Coda] G3/2 D3/2 ||`,
  dynamics: `${HEAD}!p G2/4 \\< A2 B2 C3 | \\! !f D3/2 !sfz G2/2 |]`,
  rhythm: `${HEAD}{3 G2/8 A2 B2} D3/4. C3/8 B2/4~ | B2/4 r/4 G2/2 |]`,
  artic: `${HEAD}G2/4-. A2-. B2-> D3-- | G3/2-^ D3/2\\fermata |]`,
  tech: `${HEAD}G2/8 G2-x D3 G3-g F3/4-/ G3/4 | C3/8-s C4-p C3-s C4-p G2/2 |]`,
};
