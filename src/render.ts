// alphaTab-Darstellung (Vorschau) und PDF-Export.

import * as alphaTab from '@coderline/alphatab';
import { jsPDF } from 'jspdf';

const HIDDEN_ELEMENTS = [
  alphaTab.NotationElement.GuitarTuning,
  alphaTab.NotationElement.TrackNames,
  alphaTab.NotationElement.EffectDynamics,
];

function baseSettings(engine: 'svg' | 'html5', scale: number, barsPerRow: number): alphaTab.json.SettingsJson {
  return {
    core: {
      engine,
      useWorkers: engine === 'svg',
      enableLazyLoading: engine === 'svg',
      // Vite kopiert die Notenschrift nach <base>/font/ – relativ zur Seite, damit GitHub-Pages-Unterpfade funktionieren
      fontDirectory: new URL('font/', document.baseURI).href,
    },
    display: {
      layoutMode: alphaTab.LayoutMode.Page,
      scale,
      barsPerRow,
      padding: [10, 20, 10, 20],
    },
    player: { enablePlayer: false },
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

function hideElements(settings: alphaTab.Settings) {
  for (const el of HIDDEN_ELEMENTS) settings.notation.elements.set(el, false);
}

export class Preview {
  private api: alphaTab.AlphaTabApi;
  onBarClick: (barIndex: number) => void = () => {};
  onError: (msg: string) => void = () => {};

  constructor(el: HTMLElement) {
    this.api = new alphaTab.AlphaTabApi(el, baseSettings('svg', 1, -1));
    hideElements(this.api.settings);
    this.api.updateSettings();
    // eigener Klick-Handler: beatMouseDown feuert nur mit aktiviertem Player
    el.addEventListener('click', (e) => {
      const lookup = this.api.boundsLookup;
      const surface = el.querySelector('.at-surface') ?? el;
      if (!lookup) return;
      const r = surface.getBoundingClientRect();
      const beat = lookup.getBeatAtPos(e.clientX - r.left, e.clientY - r.top);
      if (beat) this.onBarClick(beat.voice.bar.index);
    });
    this.api.error.on((e) => this.onError(e.message));
  }

  render(tex: string, scale: number, barsPerRow: number) {
    const d = this.api.settings.display;
    if (d.scale !== scale || d.barsPerRow !== barsPerRow) {
      d.scale = scale;
      d.barsPerRow = barsPerRow;
      this.api.updateSettings();
    }
    try {
      this.api.renderScore(loadScore(tex, this.api.settings), [0]);
    } catch (e) {
      this.onError((e as Error).message);
    }
  }
}

/** Rendert den Text-Score per Canvas in einem unsichtbaren Container und baut daraus ein A4-PDF. */
export async function exportPdf(tex: string, fileName: string, barsPerRow: number, footer: string): Promise<void> {
  const PX_WIDTH = 2000; // Renderbreite in Pixeln (≈ 270 dpi auf A4)
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${PX_WIDTH + 200}px;top:0;width:${PX_WIDTH}px;background:#fff;`;
  const inner = document.createElement('div');
  host.appendChild(inner);
  document.body.appendChild(host);

  try {
    const api = new alphaTab.AlphaTabApi(inner, baseSettings('html5', 2, barsPerRow));
    hideElements(api.settings);
    // Druck immer schwarz auf weiß, unabhängig vom Dark Mode
    api.settings.display.resources.mainGlyphColor = alphaTab.model.Color.fromJson('#000000')!;
    api.settings.display.resources.secondaryGlyphColor = alphaTab.model.Color.fromJson('#00000099')!;
    api.settings.display.resources.staffLineColor = alphaTab.model.Color.fromJson('#555555')!;
    api.settings.display.resources.barSeparatorColor = alphaTab.model.Color.fromJson('#222222')!;
    api.settings.display.resources.scoreInfoColor = alphaTab.model.Color.fromJson('#000000')!;
    api.updateSettings();

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Rendern für PDF hat zu lange gedauert')), 60000);
      api.postRenderFinished.on(() => {
        clearTimeout(timer);
        resolve();
      });
      api.error.on((e) => {
        clearTimeout(timer);
        reject(e);
      });
      api.renderScore(loadScore(tex, api.settings), [0]);
    });
    // ein Frame warten, damit alle Canvas-Partials im DOM sind
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const hostRect = inner.getBoundingClientRect();
    const canvases = [...inner.querySelectorAll('canvas')].filter((c) => c.width > 0 && c.height > 0);
    if (!canvases.length) throw new Error('Keine Grafik zum Exportieren gefunden');

    // Partials zu Zeilen gruppieren (gleiche Oberkante)
    type Item = { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number };
    const items: Item[] = canvases.map((c) => {
      const r = c.getBoundingClientRect();
      return { canvas: c, x: r.left - hostRect.left, y: r.top - hostRect.top, w: r.width, h: r.height };
    });
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: { y: number; h: number; items: Item[] }[] = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r.y - it.y) < 2);
      if (row) {
        row.items.push(it);
        row.h = Math.max(row.h, it.h);
      } else rows.push({ y: it.y, h: it.h, items: [it] });
    }

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const pageW = 210;
    const pageH = 297;
    const margin = 10;
    const footerH = 8;
    const contentW = pageW - 2 * margin;
    const cssWidth = Math.max(...items.map((i) => i.x + i.w));
    const mmPerPx = contentW / cssWidth;
    let y = margin;
    let page = 1;

    for (const row of rows) {
      const hMm = row.h * mmPerPx;
      if (y + hMm > pageH - margin - footerH && y > margin) {
        pdf.addPage();
        page++;
        y = margin;
      }
      for (const it of row.items) {
        const data = it.canvas.toDataURL('image/png');
        pdf.addImage(data, 'PNG', margin + it.x * mmPerPx, y, it.w * mmPerPx, it.h * mmPerPx, undefined, 'FAST');
      }
      y += hMm;
    }

    const total = page;
    for (let p = 1; p <= total; p++) {
      pdf.setPage(p);
      pdf.setFontSize(8);
      pdf.setTextColor(120);
      pdf.text(footer, margin, pageH - margin / 2 - 1);
      pdf.text(`Seite ${p} / ${total}`, pageW - margin, pageH - margin / 2 - 1, { align: 'right' });
    }
    pdf.save(fileName);
    api.destroy();
  } finally {
    host.remove();
  }
}
