// PDF-Seiten als Bilder: Noten aus einem PDF sind gestochen scharf – die beste Vorlage für die Erkennung.
// pdf.js wird erst geladen, wenn wirklich ein PDF kommt.

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** Rendert jede Seite so, dass die längere Seite maxSide Pixel hat (A4 ≈ 300 dpi). */
export async function pdfPages(file: Blob, maxSide = 2560): Promise<Blob[]> {
  // Legacy-Build: enthält Polyfills für ältere Safari-/Chrome-Versionen
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const out: Blob[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: maxSide / Math.max(base.width, base.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;
      out.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PDF-Seite leer'))), 'image/png')));
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return out;
}
