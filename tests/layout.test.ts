import { describe, it, expect } from 'vitest';
import { analyzePage, measureBoxes } from '../src/layout';

/** Zeichnet eine leicht schräge Seite mit Notenzeilen, Taktstrichen und ein paar Notenköpfen samt Hals. */
function page(systems: number, barsPerSystem: number, tilt = 0.02) {
  const width = 1000;
  const height = 1300;
  const data = new Uint8Array(width * height).fill(235);
  const d = 10;
  const set = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi >= 0 && xi < width && yi >= 0 && yi < height) data[yi * width + xi] = 30;
  };
  for (let s = 0; s < systems; s++) {
    const top = 150 + s * 110;
    const y = (x: number) => top + (x - 100) * tilt;
    for (let k = 0; k < 5; k++) for (let x = 100; x <= 900; x++) set(x, y(x) + k * d);
    for (let b = 1; b <= barsPerSystem; b++) {
      const x = 100 + (800 * b) / barsPerSystem;
      for (let yy = 0; yy <= 4 * d; yy++) set(x, y(x) + yy);
    }
    // Notenkopf mit Hals nach oben, der über die Zeile hinausragt
    const nx = 100 + 800 / barsPerSystem / 2;
    for (let dx = -6; dx <= 6; dx++) for (let dy = -4; dy <= 4; dy++) if ((dx * dx) / 36 + (dy * dy) / 16 <= 1) set(nx + dx, y(nx) + 4 * d + dy);
    for (let yy = -1.5 * d; yy <= 4 * d; yy++) set(nx + 6, y(nx) + yy);
  }
  return { width, height, data };
}

describe('Layout-Erkennung', () => {
  it('findet schräge Notenzeilen und ihre Taktstriche', () => {
    const { systems } = analyzePage(page(4, 4));
    expect(systems).toHaveLength(4);
    for (const s of systems) expect(s.measures).toHaveLength(4);
    // Takte liegen nebeneinander zwischen Zeilenanfang und -ende
    const m = systems[0].measures;
    expect(m[0][1]).toBeLessThan(m[1][1]);
    expect(m[3][3]).toBeGreaterThan(880);
  });

  it('verteilt abweichende Taktzahlen sinnvoll', () => {
    const [sys] = analyzePage(page(1, 4)).systems;
    expect(measureBoxes(sys, 4)).toEqual(sys.measures);
    const five = measureBoxes(sys, 5);
    expect(five).toHaveLength(5);
    expect(five[4][3]).toBe(sys.measures[3][3]);
    expect(measureBoxes(sys, 3)).toHaveLength(3);
  });
});
