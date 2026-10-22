// Sitzung und Einstellungen: localStorage für Text, IndexedDB für Fotos. Nichts verlässt den Browser.

import type { RecognizedMeasure, Uncertainty, PreparedImage } from '../gemini';
import { DEFAULT_MODEL } from '../gemini';

export type StepId = 'welcome' | 'source' | 'reading' | 'review' | 'overview' | 'details' | 'done';

export interface Session {
  source: 'photo' | 'xml' | null;
  notation: string;
  recognized: RecognizedMeasure[];
  uncertain: Uncertainty[];
  /** Index der Unsicherheit → Entscheidung */
  reviewed: Record<number, 'ok' | 'changed' | 'skipped'>;
  /** Was die KI als Titel usw. erkannt hat (für den Hinweis im Angaben-Schritt) */
  detected: { title: string; composer: string; arranger: string };
  step: StepId;
}

export interface Prefs {
  apiKey: string;
  model: string;
  onboarded: boolean;
  tuning: string;
  technique: 'ofpf' | 'simandl';
  openStrings: 'prefer' | 'neutral' | 'avoid';
  lowPositionBias: number;
  maxFret: number;
  barsPerRow: number;
  view: 'both' | 'tab' | 'score';
}

const PREFIX = 'basstab.';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* privates Fenster oder voller Speicher: läuft ohne Speichern weiter */
  }
}

export const emptySession = (): Session => ({
  source: null,
  notation: '',
  recognized: [],
  uncertain: [],
  reviewed: {},
  detected: { title: '', composer: '', arranger: '' },
  step: 'source',
});

const defaultPrefs: Prefs = {
  apiKey: '',
  model: DEFAULT_MODEL,
  onboarded: false,
  tuning: 'standard4',
  technique: 'ofpf',
  openStrings: 'neutral',
  lowPositionBias: 1,
  maxFret: 20,
  barsPerRow: -1,
  view: 'both',
};

// Alte Schlüssel der ersten Version übernehmen (Key/Modell)
function migrate(p: Prefs): Prefs {
  try {
    const oldKey = localStorage.getItem(PREFIX + 'apiKey');
    if (oldKey && !p.apiKey) p.apiKey = oldKey;
  } catch {
    /* egal */
  }
  // Argon wird nicht mehr angeboten; eigene Modell-IDs bleiben erlaubt
  if (!p.model?.trim() || p.model === 'gemini-4-argon') p.model = DEFAULT_MODEL;
  return p;
}

export const prefs: Prefs = migrate(read('prefs', defaultPrefs));
export let session: Session = read('session', emptySession());

export function savePrefs() {
  write('prefs', prefs);
}

export function saveSession() {
  write('session', session);
}

export function resetSession() {
  session = emptySession();
  saveSession();
  void saveImages([]);
}

// --- Fotos in IndexedDB ----------------------------------------------------

const DB = 'basstab';
const STORE = 'images';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveImages(images: PreparedImage[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(images, 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ohne IndexedDB gehen die Fotos beim Neuladen verloren */
  }
}

export async function loadImages(): Promise<PreparedImage[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get('current');
      req.onsuccess = () => resolve((req.result as PreparedImage[]) ?? []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}
