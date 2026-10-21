// alphaTab-Darstellung (Vorschau, Mini-Takte) und PDF-Export.

import * as alphaTab from '@coderline/alphatab';
import { jsPDF } from 'jspdf';

const HIDDEN_ELEMENTS = [alphaTab.NotationElement.GuitarTuning, alphaTab.NotationElement.TrackNames];

// Notenschrift liegt in <base>/font/, die Module in <base>/assets/ (Build) bzw. /src/ (Dev).
// Als Variable, damit Vite die URL nicht als Asset-Import auflöst.
const FONT_DIR = '../font/';
const fontDirectory = new URL(FONT_DIR, import.meta.url).href;

function baseSettings(engine: 'svg' | 'html5', scale: number, barsPerRow: number, lazy = engine === 'svg'): alphaTab.json.SettingsJson {
  return {
    core: { engine, useWorkers: engine === 'svg', enableLazyLoading: lazy, fontDirectory },
    display: {
      layoutMode: alphaTab.LayoutMode.Page,
      scale,
      barsPerRow,
      padding: [10, 16, 10, 16],
    },
    // ohne Player und ohne Cursor – sonst scrollt alphaTab die Seite zum (unsichtbaren) Wiedergabe-Cursor
    player: { enablePlayer: false, enableCursor: false, scrollMode: alphaTab.ScrollMode.Off },
  };
}

/** alphaTex → Score. Mehrtaktpausen für die (einzige) Spur aktivieren – \multiBarRest gilt nur für mehrere Spuren. */
function loadScore(tex: string, settings: alphaTab.Settings): alphaTab.model.Score {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, settings);
  const score = importer.readScore();
  score.stylesheet.perTrackMultiBarRest = new Set([0]);
  return score;
}

const HEADER_ELEMENTS = [
  alphaTab.NotationElement.ScoreTitle, alphaTab.NotationElement.ScoreSubTitle, alphaTab.NotationElement.ScoreArtist,
  alphaTab.NotationElement.ScoreMusic, alphaTab.NotationElement.ScoreWords, alphaTab.NotationElement.ScoreWordsAndMusic,
  alphaTab.NotationElement.EffectTempo,
];

/** Elemente ausblenden; Dynamik nur zeigen, wenn das Stück welche notiert (sonst zeigt alphaTab sein Standard-„f“). */
function applyElements(settings: alphaTab.Settings, tex: string, bare = false): boolean {
  const els = settings.notation.elements;
  const showDyn = /\bdy (?:ppp|pp|p|mp|mf|f|ff|fff)\b/.test(tex);
  const changed = els.get(alphaTab.NotationElement.EffectDynamics) !== showDyn;
  for (const el of HIDDEN_ELEMENTS) els.set(el, false);
  els.set(alphaTab.NotationElement.EffectDynamics, showDyn);
  if (bare) for (const el of HEADER_ELEMENTS) els.set(el, false);
  return changed;
}

function setColors(settings: alphaTab.Settings, ink: string) {
  const r = settings.display.resources;
  const c = (hex: string) => alphaTab.model.Color.fromJson(hex)!;
  r.mainGlyphColor = c(ink);
  r.secondaryGlyphColor = c(`${ink}99`);
  r.scoreInfoColor = c(ink);
  r.barSeparatorColor = c(ink);
  r.staffLineColor = c('#5f6b6d');
  r.barNumberColor = c('#5f6b6d');
}

export interface ScoreViewOptions {
  scale?: number;
  barsPerRow?: number;
  /** Titel/Tempo ausblenden (Mini-Ansicht eines Takts) */
  bare?: boolean;
  ink?: string;
  /** Schrift für Texte über den Noten (z. B. Bleistift-Notizen) */
  effectFont?: { family: string; size: number };
}

/** Eine alphaTab-Ansicht in einem Container. */
export class ScoreView {
  private api: alphaTab.AlphaTabApi;
  private marker: HTMLDivElement;
  private surfaceHost: HTMLElement;
  private bare: boolean;
  onBarClick: (barIndex: number) => void = () => {};
  onError: (msg: string) => void = () => {};
  onRendered: () => void = () => {};

  constructor(
    private el: HTMLElement,
    opts: ScoreViewOptions = {},
  ) {
    this.bare = !!opts.bare;
    el.classList.add('score-view');
    this.surfaceHost = document.createElement('div');
    el.appendChild(this.surfaceHost);
    this.marker = document.createElement('div');
    this.marker.className = 'bar-marker';
    this.marker.hidden = true;
    el.appendChild(this.marker);

    // Kleine Ansichten ohne Lazy-Loading: der IntersectionObserver verpasst sie sonst während des Schrittwechsels
    this.api = new alphaTab.AlphaTabApi(this.surfaceHost, baseSettings('svg', opts.scale ?? 1, opts.barsPerRow ?? -1, !this.bare));
    applyElements(this.api.settings, '', this.bare);
    setColors(this.api.settings, opts.ink ?? '#0b2f33');
    if (opts.effectFont) this.api.settings.display.resources.effectFont = new alphaTab.model.Font(opts.effectFont.family, opts.effectFont.size);
    this.api.updateSettings();
    this.api.postRenderFinished.on(() => {
      // Bibliotheks-Hinweis in kleinen Vorschauen ausblenden (im großen Notenbild und im PDF bleibt er)
      if (this.bare) {
        for (const part of this.surfaceHost.querySelectorAll<HTMLElement>('.at-surface > div')) {
          if (part.textContent?.trim() === 'rendered by alphaTab') part.style.display = 'none';
        }
      }
      this.onRendered();
    });
    this.api.error.on((e) => this.onError(e.message));
    // eigener Klick-Handler: beatMouseDown feuert nur mit aktiviertem Player
    el.addEventListener('click', (e) => {
      const bar = this.barAt(e.clientX, e.clientY);
      if (bar !== null) this.onBarClick(bar);
    });
  }

  private barAt(clientX: number, clientY: number): number | null {
    const lookup = this.api.boundsLookup;
    if (!lookup) return null;
    const r = this.surfaceHost.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const beat = lookup.getBeatAtPos(x, y);
    if (beat) return beat.voice.bar.index;
    // Klick zwischen Noten: Takt über die Systeme suchen
    for (const sys of lookup.staffSystems) {
      const b = sys.visualBounds;
      if (y < b.y || y > b.y + b.h) continue;
      for (const mb of sys.bars) {
        const v = mb.visualBounds;
        if (x >= v.x && x <= v.x + v.w) return mb.index;
      }
    }
    return null;
  }

  render(tex: string, opts: { scale?: number; barsPerRow?: number } = {}) {
    const d = this.api.settings.display;
    const elementsChanged = applyElements(this.api.settings, tex, this.bare);
    const scale = opts.scale ?? d.scale;
    const barsPerRow = opts.barsPerRow ?? d.barsPerRow;
    if (d.scale !== scale || d.barsPerRow !== barsPerRow || elementsChanged) {
      d.scale = scale;
      d.barsPerRow = barsPerRow;
      this.api.updateSettings();
    }
    this.marker.hidden = true;
    try {
      this.api.renderScore(loadScore(tex, this.api.settings), [0]);
    } catch (e) {
      this.onError((e as Error).message);
    }
  }

  /** Markiert einen Takt (Index in alphaTab, Mehrtaktpausen zählen einzeln) und scrollt ihn ins Bild. */
  mark(barIndex: number | null, scroll = false) {
    const mb = barIndex === null ? null : this.api.boundsLookup?.findMasterBarByIndex(barIndex);
    if (!mb) {
      this.marker.hidden = true;
      return;
    }
    const host = this.surfaceHost.getBoundingClientRect();
    const outer = this.el.getBoundingClientRect();
    const v = mb.visualBounds;
    Object.assign(this.marker.style, {
      left: `${v.x + host.left - outer.left}px`,
      top: `${v.y + host.top - outer.top}px`,
      width: `${v.w}px`,
      height: `${v.h}px`,
    });
    this.marker.hidden = false;
    if (scroll) {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.marker.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  /**
   * Position jedes Takts in Layout-Koordinaten relativ zu `relativeTo` (Standard: dieser Container).
   * Nutzt offsetLeft/Top statt getBoundingClientRect, damit CSS-Transforms (z. B. Perspektive) nicht verzerren.
   */
  barRects(relativeTo: HTMLElement = this.el): { x: number; y: number; w: number; h: number }[] {
    const lookup = this.api.boundsLookup;
    if (!lookup) return [];
    let dx = 0;
    let dy = 0;
    let node: HTMLElement | null = this.surfaceHost;
    while (node && node !== relativeTo) {
      dx += node.offsetLeft;
      dy += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    return lookup.staffSystems.flatMap((sys) =>
      sys.bars.map((mb) => ({ x: mb.visualBounds.x + dx, y: mb.visualBounds.y + dy, w: mb.visualBounds.w, h: mb.visualBounds.h })));
  }

  destroy() {
    this.api.destroy();
    this.el.replaceChildren();
  }
}

export interface PdfResult {
  blob: Blob;
  pages: number;
  /** Erste Seite als Bild (für die Vorschau) */
  previewUrl: string;
}

/** Rendert den Score per Canvas in einem unsichtbaren Container und baut daraus ein A4-PDF. */
export async function buildPdf(tex: string, barsPerRow: number, footer: string): Promise<PdfResult> {
  const PX_WIDTH = 2000; // Renderbreite in Pixeln (≈ 270 dpi auf A4)
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${PX_WIDTH + 200}px;top:0;width:${PX_WIDTH}px;background:#fff;`;
  const inner = document.createElement('div');
  host.appendChild(inner);
  document.body.appendChild(host);
  let api: alphaTab.AlphaTabApi | null = null;

  try {
    const a = new alphaTab.AlphaTabApi(inner, baseSettings('html5', 2, barsPerRow));
    api = a;
    applyElements(a.settings, tex);
    setColors(a.settings, '#000000'); // Druck immer schwarz auf weiß
    a.updateSettings();

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Das Rendern hat zu lange gedauert.')), 60000);
      a.postRenderFinished.on(() => {
        clearTimeout(timer);
        resolve();
      });
      a.error.on((e) => {
        clearTimeout(timer);
        reject(e);
      });
      a.renderScore(loadScore(tex, a.settings), [0]);
    });
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const hostRect = inner.getBoundingClientRect();
    const canvases = [...inner.querySelectorAll('canvas')].filter((c) => c.width > 0 && c.height > 0);
    if (!canvases.length) throw new Error('Keine Grafik zum Exportieren gefunden.');

    // Partials zu Zeilen gruppieren (gleiche Oberkante)
    type Item = { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number };
    const items: Item[] = canvases.map((c) => {
      const r = c.getBoundingClientRect();
      return { canvas: c, x: r.left - hostRect.left, y: r.top - hostRect.top, w: r.width, h: r.height };
    });
    items.sort((p, q) => p.y - q.y || p.x - q.x);
    const rows: { h: number; items: Item[] }[] = [];
    let lastY = -1e9;
    for (const it of items) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(it.y - lastY) < 2) {
        row.items.push(it);
        row.h = Math.max(row.h, it.h);
      } else rows.push({ h: it.h, items: [it] });
      lastY = it.y;
    }

    // Seiten als Canvas zusammensetzen (A4, 10 mm Rand, 8 mm Fußzeile)
    const MARGIN = 10;
    const FOOTER = 8;
    const cssWidth = Math.max(...items.map((i) => i.x + i.w));
    const pxRatio = items[0].canvas.width / items[0].w;
    const pxPerMm = (cssWidth * pxRatio) / (210 - 2 * MARGIN);
    const pageW = Math.round(210 * pxPerMm);
    const pageH = Math.round(297 * pxPerMm);
    const usableBottom = (297 - MARGIN - FOOTER) * pxPerMm;
    const pages: HTMLCanvasElement[] = [];
    let ctx: CanvasRenderingContext2D | null = null;
    let y = Infinity;
    for (const row of rows) {
      const h = row.h * pxRatio;
      if (!ctx || y + h > usableBottom) {
        const c = document.createElement('canvas');
        c.width = pageW;
        c.height = pageH;
        ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, pageW, pageH);
        pages.push(c);
        y = MARGIN * pxPerMm;
      }
      for (const it of row.items) ctx.drawImage(it.canvas, MARGIN * pxPerMm + it.x * pxRatio, y, it.w * pxRatio, h);
      y += h;
    }

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    pages.forEach((c, i) => {
      if (i > 0) pdf.addPage();
      pdf.addImage(c, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
      pdf.setFontSize(8);
      pdf.setTextColor(110);
      pdf.text(footer, MARGIN, 297 - MARGIN / 2 - 1);
      pdf.text(`Seite ${i + 1} / ${pages.length}`, 210 - MARGIN, 297 - MARGIN / 2 - 1, { align: 'right' });
    });

    // Vorschau der ersten Seite verkleinert
    const prev = document.createElement('canvas');
    prev.width = 840;
    prev.height = Math.round((840 * 297) / 210);
    prev.getContext('2d')!.drawImage(pages[0], 0, 0, prev.width, prev.height);

    return { blob: pdf.output('blob'), pages: pages.length, previewUrl: prev.toDataURL('image/png') };
  } finally {
    api?.destroy();
    host.remove();
  }
}
