// Seitenlayout ohne KI: findet Notenzeilen (5 Linien) und Taktstriche direkt im Foto.
// Damit markiert BassTab Takte genau und schickt Gemini jede Zeile einzeln in voller Auflösung.

/** Graustufenbild, 1 Byte pro Pixel. */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** [ymin, xmin, ymax, xmax], normiert auf 0–1000 (wie bei Gemini). */
export type NormBox = [number, number, number, number];

export interface Barline {
  /** normiert 0–1000 */
  x: number;
  /** sicher erkannt (sauberer Strich) oder nur möglich (z. B. langer Notenhals) */
  strong: boolean;
}

export interface LayoutSystem {
  /** Bereich der fünf Linien */
  staff: NormBox;
  /** Zeile mit Platz für Zeichen darüber und darunter (Probenziffern, Dynamik, Hilfslinien) */
  area: NormBox;
  /** Ober- und Unterkante von area entlang der Zeile (schräge Fotos), normiert */
  profile: { x: number[]; top: number[]; bottom: number[] };
  /** Taktstrich-Kandidaten zwischen Zeilenanfang und -ende */
  bars: Barline[];
  /** Takte nach den sicheren Taktstrichen */
  measures: NormBox[];
}

export interface PageLayout {
  systems: LayoutSystem[];
  /** Linienabstand im analysierten Bild (Pixel) – zu klein heißt: feiner analysieren */
  spacing: number;
  /** Bild zu klein aufgelöst, um Linien sicher zu trennen (dann ohne Zeilen weiter) */
  lowRes?: boolean;
}

interface Staff {
  /** oberste/unterste Linie je Spalte (Pixel) */
  top: Float32Array;
  bottom: Float32Array;
  spacing: number;
  x0: number;
  x1: number;
}

// ---------------------------------------------------------------------------

/** Schwarz/Weiß mit lokalem Schwellwert – robust gegen Schatten, Blendung und ungleichmäßiges Licht. */
export function binarize(g: Gray): Uint8Array {
  const { width: w, height: h, data } = g;
  const W = w + 1;
  const integ = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      integ[(y + 1) * W + x + 1] = integ[y * W + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(w / 50));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = integ[y1 * W + x1] - integ[y0 * W + x1] - integ[y1 * W + x0] + integ[y0 * W + x0];
      const mean = sum / ((y1 - y0) * (x1 - x0));
      const v = data[y * w + x];
      out[y * w + x] = v < mean * 0.86 && mean - v > 12 ? 1 : 0;
    }
  }
  return out;
}

export const STRIPS = 30;

/** Schwarzanteil je Bildzeile innerhalb eines senkrechten Streifens, leicht geglättet. */
export function rowProfile(bin: Uint8Array, w: number, h: number, xa: number, xb: number): Float32Array {
  const raw = new Float32Array(h);
  const sw = xb - xa;
  for (let y = 0; y < h; y++) {
    let n = 0;
    const o = y * w;
    for (let x = xa; x < xb; x++) n += bin[o + x];
    raw[y] = n / sw;
  }
  // eine schräge Linie verteilt sich auf 2–3 Bildzeilen
  const f = new Float32Array(h);
  for (let y = 0; y < h; y++) f[y] = Math.min(1, Math.max(raw[y], (raw[y - 1] ?? 0) + raw[y], raw[y] + (raw[y + 1] ?? 0)));
  return f;
}

/** Typischer Linienabstand der Seite (häufigster Abstand zweier Linien). */
export function estimateSpacing(profiles: Float32Array[], h: number): number {
  const hist = new Float32Array(Math.ceil(h / 30) + 2);
  for (const f of profiles) {
    const lines: number[] = [];
    for (let y = 1; y < h - 1; y++) if (f[y] > 0.35 && f[y] >= f[y - 1] && f[y] > f[y + 1]) lines.push(y);
    for (let i = 1; i < lines.length; i++) {
      const g = lines[i] - lines[i - 1];
      if (g >= 3 && g < hist.length - 1) hist[g] += 1;
    }
  }
  let best = 0;
  let bestG = 10;
  for (let g = 3; g < hist.length - 1; g++) {
    const v = hist[g - 1] * 0.5 + hist[g] + hist[g + 1] * 0.5;
    if (v > best) {
      best = v;
      bestG = g;
    }
  }
  // Schwerpunkt um das Maximum für Bruchteile eines Pixels
  const sum = hist[bestG - 1] + hist[bestG] + hist[bestG + 1];
  return sum ? (hist[bestG - 1] * (bestG - 1) + hist[bestG] * bestG + hist[bestG + 1] * (bestG + 1)) / sum : bestG;
}

/** Fünf-Linien-Kamm: wo im Streifen eine Notenzeile beginnt (oberste Linie) und mit welchem Abstand. */
export function staffCandidates(f: Float32Array, h: number, d0: number) {
  type Cand = { top: number; d: number; score: number };
  const cands: Cand[] = [];
  const at = (y: number) => {
    const yi = Math.round(y);
    return yi >= 0 && yi < h ? f[yi] : 0;
  };
  for (let y = 0; y < h - 4 * d0 * 0.8; y++) {
    if (f[y] < 0.2) continue;
    let best: Cand | null = null;
    for (let d = d0 * 0.85; d <= d0 * 1.15; d += 0.25) {
      let score = 0;
      let hits = 0;
      for (let k = 0; k < 5; k++) {
        const v = Math.max(at(y + k * d - 0.5), at(y + k * d), at(y + k * d + 0.5));
        score += Math.min(v, 0.9);
        if (v > 0.2) hits++;
      }
      // zwischen den Linien muss es heller sein als auf ihnen (sonst Text oder Balken)
      let gap = 0;
      for (let k = 0; k < 4; k++) gap += at(y + (k + 0.5) * d);
      score -= gap * 0.5;
      if (hits >= 4 && (!best || score > best.score)) best = { top: y, d, score };
    }
    if (best && best.score > 1.1) cands.push(best);
  }
  // Nicht-Maximum-Unterdrückung
  cands.sort((a, b) => b.score - a.score);
  const out: Cand[] = [];
  for (const c of cands) if (out.every((o) => Math.abs(o.top - c.top) > d0 * 2.5)) out.push(c);
  return out.sort((a, b) => a.top - b.top);
}

/** Findet alle Notenzeilen der Seite. */
function findStaves(bin: Uint8Array, w: number, h: number): Staff[] {
  const sw = Math.floor(w / STRIPS);
  const profiles = Array.from({ length: STRIPS }, (_, s) => rowProfile(bin, w, h, s * sw, s * sw + sw));
  const d0 = estimateSpacing(profiles, h);

  type Chain = { xs: number[]; tops: number[]; ds: number[]; last: number };
  const chains: Chain[] = [];
  profiles.forEach((f, s) => {
    const xc = s * sw + sw / 2;
    for (const c of staffCandidates(f, h, d0)) {
      let best: Chain | null = null;
      let bestDist = Infinity;
      for (const ch of chains) {
        if (s - ch.last > 4 || ch.last === s) continue;
        const n = ch.tops.length;
        // Fortsetzung mit bisheriger Neigung vorhersagen
        const slope = n >= 2 ? (ch.tops[n - 1] - ch.tops[n - 2]) / (ch.xs[n - 1] - ch.xs[n - 2]) : 0;
        const pred = ch.tops[n - 1] + slope * (xc - ch.xs[n - 1]);
        const dist = Math.abs(pred - c.top);
        if (dist < d0 * 1.2 && dist < bestDist) {
          best = ch;
          bestDist = dist;
        }
      }
      if (best) {
        best.xs.push(xc);
        best.tops.push(c.top);
        best.ds.push(c.d);
        best.last = s;
      } else chains.push({ xs: [xc], tops: [c.top], ds: [c.d], last: s });
    }
  });

  const staves: Staff[] = [];
  for (const ch of chains) {
    if (ch.xs.length < Math.max(4, STRIPS * 0.25)) continue;
    const d = [...ch.ds].sort((a, b) => a - b)[ch.ds.length >> 1];
    const staff = traceStaff(bin, w, h, ch.xs, ch.tops, d);
    if (staff) staves.push(staff);
  }
  staves.sort((a, b) => a.top[w >> 1] - b.top[w >> 1]);
  const unique = staves.filter((s, i) => i === 0 || Math.abs(s.top[w >> 1] - staves[i - 1].top[w >> 1]) > s.spacing * 2.5);
  // Fehlfunde (Hüllenkante, Linien am Rand) sind viel kürzer als die echten Zeilen oder haben einen anderen Linienabstand
  const widths = unique.map((s) => s.x1 - s.x0).sort((a, b) => a - b);
  const spacings = unique.map((s) => s.spacing).sort((a, b) => a - b);
  const medW = widths[widths.length >> 1] ?? 0;
  const medD = spacings[spacings.length >> 1] ?? 0;
  return unique.filter((s) => s.x1 - s.x0 > medW * 0.55 && Math.abs(s.spacing - medD) < medD * 0.2);
}

/** Interpolierte Kurve durch Stützstellen, an den Enden linear weitergeführt. */
function interpolate(xs: number[], ys: number[], w: number): Float32Array {
  const out = new Float32Array(w);
  const n = xs.length;
  for (let x = 0; x < w; x++) {
    let i = 1;
    while (i < n - 1 && xs[i] < x) i++;
    const x0 = xs[i - 1];
    const x1 = xs[i];
    out[x] = ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - x0)) / (x1 - x0 || 1);
  }
  return out;
}

/**
 * Führt die Zeile Spalte für Spalte nach (Schräglage, Wölbung) und bestimmt, wo die Linien
 * tatsächlich laufen.
 */
function traceStaff(bin: Uint8Array, w: number, h: number, xs: number[], tops: number[], d: number): Staff | null {
  // Ausreißer in den Stützstellen glätten (gleitender Median über 3)
  const sm = tops.map((t, i) => [tops[i - 1] ?? t, t, tops[i + 1] ?? t].sort((a, b) => a - b)[1]);
  const guess = interpolate(xs, sm, w);
  const tol = Math.max(1, Math.round(d * 0.2));
  const offset = new Float32Array(w);
  const hits = new Uint8Array(w);
  const lineHit = (x: number, y: number) => {
    for (let dy = -tol; dy <= tol; dy++) {
      const yi = Math.round(y + dy);
      if (yi >= 0 && yi < h && bin[yi * w + x]) return true;
    }
    return false;
  };
  for (let x = 0; x < w; x++) {
    let bestN = -1;
    let bestOff = 0;
    for (let o = -Math.round(d * 0.5); o <= Math.round(d * 0.5); o++) {
      let n = 0;
      for (let k = 0; k < 5; k++) if (lineHit(x, guess[x] + o + k * d)) n++;
      if (n > bestN || (n === bestN && Math.abs(o) < Math.abs(bestOff))) {
        bestN = n;
        bestOff = o;
      }
    }
    offset[x] = bestOff;
    hits[x] = bestN;
  }
  // Versatz glätten (Median über ~2 Linienabstände), nur wo die Zeile sicher getroffen ist
  const win = Math.max(3, Math.round(d * 2));
  const top = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const vals: number[] = [];
    for (let k = Math.max(0, x - win); k <= Math.min(w - 1, x + win); k++) if (hits[k] >= 4) vals.push(offset[k]);
    vals.sort((a, b) => a - b);
    top[x] = guess[x] + (vals.length ? vals[vals.length >> 1] : 0);
  }
  // Ausdehnung: längster Lauf mit mindestens 4 getroffenen Linien, kleine Lücken überbrückt
  const present = (x: number) => {
    let n = 0;
    for (let k = 0; k < 5; k++) if (lineHit(x, top[x] + k * d)) n++;
    return n >= 4;
  };
  const maxGap = Math.round(d * 3);
  let best: [number, number] | null = null;
  let start = -1;
  let lastOn = -1;
  for (let x = 0; x <= w; x++) {
    const on = x < w && present(x);
    if (!on) continue;
    if (start < 0 || x - lastOn > maxGap) {
      if (start >= 0 && (!best || lastOn - start > best[1] - best[0])) best = [start, lastOn];
      start = x;
    }
    lastOn = x;
  }
  if (start >= 0 && (!best || lastOn - start > best[1] - best[0])) best = [start, lastOn];
  if (!best || best[1] - best[0] < w * 0.15) return null;
  // Textzeilen treffen die „Linien“ nur stellenweise, echte Notenlinien laufen durch
  let covered = 0;
  for (let x = best[0]; x <= best[1]; x++) if (present(x)) covered++;
  if (covered / (best[1] - best[0] + 1) < 0.55) return null;
  const bottom = top.map((t) => t + 4 * d);
  return { top, bottom, spacing: d, x0: best[0], x1: best[1] };
}

const dark = (bin: Uint8Array, w: number, h: number, x: number, y: number) => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  return xi >= 0 && xi < w && yi >= 0 && yi < h && bin[yi * w + xi] === 1;
};

const fill = (bin: Uint8Array, w: number, h: number, xa: number, xb: number, ya: number, yb: number) => {
  let n = 0;
  let tot = 0;
  for (let y = Math.round(ya); y <= Math.round(yb); y++) {
    for (let x = Math.round(xa); x <= Math.round(xb); x++) {
      tot++;
      if (dark(bin, w, h, x, y)) n++;
    }
  }
  return tot ? n / tot : 0;
};

/** Taktstrich-Kandidaten: senkrechte Linien über die ganze Zeilenhöhe. */
function findBarlines(bin: Uint8Array, w: number, h: number, s: Staff): { x: number; strong: boolean }[] {
  const d = s.spacing;
  const colFrac = (x: number) => {
    const t = s.top[x];
    const b = s.bottom[x];
    let n = 0;
    let tot = 0;
    for (let y = Math.ceil(t + 1); y <= b - 1; y++) {
      tot++;
      if (dark(bin, w, h, x, y) || dark(bin, w, h, x - 1, y) || dark(bin, w, h, x + 1, y)) n++;
    }
    return tot ? n / tot : 0;
  };
  const runs: [number, number][] = [];
  for (let x = s.x0; x <= s.x1; x++) {
    if (colFrac(x) < 0.9) continue;
    const last = runs[runs.length - 1];
    if (last && x - last[1] <= 1) last[1] = x;
    else runs.push([x, x]);
  }
  // breite Läufe sind Notenköpfe, Balken oder Mehrtaktpausen – keine Striche
  const thin = runs.filter(([a, b]) => b - a <= d * 0.8);

  // Notenhals statt Taktstrich? Hälse ragen über die Zeile hinaus oder tragen einen Notenkopf.
  const judge = ([a, b]: [number, number]) => {
    const x = Math.round((a + b) / 2);
    const t = s.top[x];
    const bt = s.bottom[x];
    const above = fill(bin, w, h, x - 1, x + 1, t - d * 1.5, t - d * 0.5);
    const below = fill(bin, w, h, x - 1, x + 1, bt + d * 0.5, bt + d * 1.5);
    // ein Notenkopf sitzt ohne Abstand am Hals; Noten neben einem Taktstrich halten Abstand
    let head = 0;
    for (let yc = t - d; yc <= bt + d; yc += d * 0.25) {
      const ya = yc - d * 0.3;
      const yb = yc + d * 0.3;
      const left = Math.min(fill(bin, w, h, a - d * 0.5, a - 1, ya, yb), fill(bin, w, h, a - d * 1.1, a - d * 0.5, ya, yb) + 0.2);
      const right = Math.min(fill(bin, w, h, b + 1, b + d * 0.5, ya, yb), fill(bin, w, h, b + d * 0.5, b + d * 1.1, ya, yb) + 0.2);
      head = Math.max(head, left, right);
    }
    const stemLike = above > 0.75 || below > 0.75 || head > 0.7;
    return { x: (a + b) / 2, strong: !stemLike, extends: Math.max(above, below), head };
  };
  const judged = thin.map(judge).filter((c) => c.strong || (c.extends < 0.9 && c.head < 0.8));

  // Doppelstriche, Schlussstriche, Wiederholungen zu einem Strich zusammenfassen
  const merged: { x: number; strong: boolean }[] = [];
  for (const c of judged) {
    const last = merged[merged.length - 1];
    if (last && c.x - last.x <= d * 1.3) {
      last.x = c.strong && !last.strong ? c.x : last.x;
      last.strong ||= c.strong;
    } else merged.push({ x: c.x, strong: c.strong });
  }
  return merged;
}

/** Wiederholungspunkte rechts eines Taktstrichs (|: am Zeilenanfang nach Schlüssel und Vorzeichen). */
function repeatDotsRight(bin: Uint8Array, w: number, h: number, s: Staff, x: number): boolean {
  const d = s.spacing;
  const xi = Math.round(x);
  const t = s.top[Math.max(0, Math.min(w - 1, xi))];
  let hits = 0;
  for (const k of [1.5, 2.5]) {
    const yc = t + k * d;
    let best = 0;
    for (let xs = xi + 2; xs < xi + d * 1.8; xs++) best = Math.max(best, fill(bin, w, h, xs, xs + d * 0.3, yc - d * 0.15, yc + d * 0.15));
    if (best > 0.6) hits++;
  }
  return hits === 2;
}

/** Komplette Seitenanalyse. Liefert normierte Boxen (0–1000). */
export function analyzePage(g: Gray): PageLayout {
  const { width: w, height: h } = g;
  const bin = binarize(g);
  const staves = findStaves(bin, w, h);
  const spacing = staves.length ? [...staves.map((s) => s.spacing)].sort((a, b) => a - b)[staves.length >> 1] : 0;
  const ny = (y: number) => Math.max(0, Math.min(1000, Math.round((y / h) * 1000)));
  const nx = (x: number) => Math.max(0, Math.min(1000, Math.round((x / w) * 1000)));

  const systems: LayoutSystem[] = staves.map((s, i) => {
    const d = s.spacing;
    let bars = findBarlines(bin, w, h, s).filter((b) => b.x - s.x0 > d * 1.5);
    // |: direkt nach Schlüssel und Vorzeichen: davor steht kein eigener Takt
    if (bars.length && bars[0].x - s.x0 < d * 12 && repeatDotsRight(bin, w, h, s, bars[0].x)) bars = bars.slice(1);
    // Zeilenende ohne erkannten Strich: Linienende als Grenze
    if (!bars.length || s.x1 - bars[bars.length - 1].x > d * 2) bars.push({ x: s.x1, strong: true });
    else bars[bars.length - 1].strong = true;

    // Platz über/unter der Zeile – höchstens bis zur Mitte des Abstands zur Nachbarzeile
    const prev = staves[i - 1];
    const next = staves[i + 1];
    const xsProf = Array.from({ length: 21 }, (_, k) => Math.round(s.x0 + ((s.x1 - s.x0) * k) / 20));
    const areaTop = xsProf.map((x) => {
      const room = prev ? (s.top[x] - prev.bottom[x]) / 2 : d * 5;
      return s.top[x] - Math.min(d * 5, Math.max(d * 1.5, room));
    });
    const areaBottom = xsProf.map((x) => {
      const room = next ? (next.top[x] - s.bottom[x]) / 2 : d * 5;
      return s.bottom[x] + Math.min(d * 5, Math.max(d * 1.5, room));
    });
    const sys: LayoutSystem = {
      staff: [ny(Math.min(s.top[s.x0], s.top[s.x1], s.top[(s.x0 + s.x1) >> 1])), nx(s.x0), ny(Math.max(s.bottom[s.x0], s.bottom[s.x1], s.bottom[(s.x0 + s.x1) >> 1])), nx(s.x1)],
      area: [ny(Math.min(...areaTop)), nx(Math.max(0, s.x0 - d * 2)), ny(Math.max(...areaBottom)), nx(Math.min(w, s.x1 + d * 2))],
      profile: { x: xsProf.map(nx), top: areaTop.map(ny), bottom: areaBottom.map(ny) },
      bars: bars.map((b) => ({ x: nx(b.x), strong: b.strong })),
      measures: [],
    };
    sys.measures = boxesFor(sys, [sys.staff[1], ...sys.bars.filter((b) => b.strong).map((b) => b.x)]);
    return sys;
  });
  return { systems, spacing };
}

/** Boxen zwischen Grenzen; Höhe folgt dem Profil der Zeile. */
function boxesFor(sys: LayoutSystem, bounds: number[]): NormBox[] {
  const { x, top, bottom } = sys.profile;
  const range = (xa: number, xb: number, arr: number[], pick: (...v: number[]) => number) => {
    const vals = x.map((px, k) => (px >= xa - 50 && px <= xb + 50 ? arr[k] : NaN)).filter((v) => !Number.isNaN(v));
    return vals.length ? pick(...vals) : pick(...arr);
  };
  const out: NormBox[] = [];
  for (let k = 1; k < bounds.length; k++) {
    const xa = bounds[k - 1];
    const xb = bounds[k];
    out.push([range(xa, xb, top, Math.min), xa, range(xa, xb, bottom, Math.max), xb]);
  }
  return out;
}

/**
 * Ordnet n gelesene Takte einer Zeile den erkannten Taktstrichen zu: Passt die Zahl der sicheren
 * Striche, gelten sie; sonst werden mögliche Striche dazugenommen bzw. die schwächsten
 * weggelassen. Bleibt eine Lücke, wird der breiteste Takt geteilt.
 */
export function measureBoxes(sys: LayoutSystem, n: number): NormBox[] {
  if (n <= 0) return [];
  const start = sys.staff[1];
  const end = sys.bars[sys.bars.length - 1]?.x ?? sys.staff[3];
  const inner = sys.bars.slice(0, -1);
  let chosen = inner.filter((b) => b.strong).map((b) => b.x);
  const need = n - 1;
  if (chosen.length > need) {
    // zu viele: die Striche weglassen, die die kleinsten Takte erzeugen
    while (chosen.length > need) {
      const pts = [start, ...chosen, end];
      let worst = 0;
      let worstW = Infinity;
      for (let i = 0; i < chosen.length; i++) {
        const wdt = Math.min(pts[i + 1] - pts[i], pts[i + 2] - pts[i + 1]);
        if (wdt < worstW) {
          worstW = wdt;
          worst = i;
        }
      }
      chosen.splice(worst, 1);
    }
  } else if (chosen.length < need) {
    // zu wenige: mögliche Striche nahe der gleichmäßigen Teilung dazunehmen
    const weak = inner.filter((b) => !b.strong).map((b) => b.x);
    while (chosen.length < need && weak.length) {
      const pts = [start, ...chosen, end].sort((a, b) => a - b);
      let gi = 0;
      for (let i = 1; i < pts.length - 1; i++) if (pts[i + 1] - pts[i] > pts[gi + 1] - pts[gi]) gi = i;
      const mid = (pts[gi] + pts[gi + 1]) / 2;
      const inGap = weak.filter((x) => x > pts[gi] && x < pts[gi + 1]);
      if (!inGap.length) break;
      const pick = inGap.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
      chosen.push(pick);
      weak.splice(weak.indexOf(pick), 1);
      chosen.sort((a, b) => a - b);
    }
    while (chosen.length < need) {
      const pts = [start, ...chosen, end];
      let gi = 0;
      for (let i = 1; i < pts.length - 1; i++) if (pts[i + 1] - pts[i] > pts[gi + 1] - pts[gi]) gi = i;
      chosen.push(Math.round((pts[gi] + pts[gi + 1]) / 2));
      chosen.sort((a, b) => a - b);
    }
  }
  return boxesFor(sys, [start, ...chosen.sort((a, b) => a - b), end]);
}
