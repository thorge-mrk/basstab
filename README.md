# BassTab

Statische Web-App: Fotos von Bassnoten hochladen → Noten werden erkannt → automatisch **spielbares** Griffbild für 4-Saiter-Bass (oder Drop D / 5-Saiter) → Darstellung als Notenzeile + Tabulatur → **PDF-Download**.

- `/` – Landing Page (erklärt das Werkzeug, Live-Griffbild zum Ausprobieren)
- `/tool/` – das Werkzeug, Schritt für Schritt: Einrichten (API-Key, Modell) → Fotos → Lesen (live animiert) → unsichere Stellen bestätigen → Gesamtbild → Angaben → PDF

## Ablauf

1. **Quelle**
   - **Foto**: Erkennung mit Gemini – Modell wählbar (Standard `gemini-3.5-flash-lite`, außerdem `gemini-3.8-flash` oder eine eigene Modell-ID) über deinen eigenen Google-AI-Studio-API-Key.
   - **MusicXML**: ohne KI, z. B. aus Audiveris, MuseScore oder einer Scan-App.
   - **Beispiel**: Demo zum Ausprobieren.
2. **Lesen**: Gemini liefert pro Takt Inhalt und Position im Foto; jeder fertige Takt leuchtet live auf dem Foto auf.
3. **Prüfen**: unsichere Takte einzeln – Foto-Ausschnitt, Frage der KI, Alternativen als Mini-Noten, eigene Eingabe.
4. **Gesamtbild**: Noten + Tab, Griffbild-Optionen, Takt antippen → mit Foto vergleichen und korrigieren; Taktlängen werden geprüft.
5. **Angaben & PDF**: Titel/Interpret bestätigen, A4-PDF im Browser erzeugen, herunterladen oder teilen.

Erkannt und gesetzt werden u. a. Tonart, Taktart, Tempo, Haltebögen, Triolen, Wiederholungen, Volten, Segno/Coda/D.S., Probenziffern, Mehrtaktpausen, Dynamik und Gabeln, Staccato/Akzent/Tenuto/Marcato/Fermate, Ghost/Dead Notes, Slides, Hammer-on, Slap/Pop und Spielanweisungen wie „tutti“.

## Griffbild-Algorithmus (`src/fingering.ts`)

Dynamische Programmierung (Viterbi) über alle Noten. Zustand = (Saite/Bund je Note, Handlage). Kosten für:
Lagenwechsel (in Pausen oder bei klingender Leersaite günstiger), Dehnungen (1-Finger-pro-Bund vs. Simandl 1-2-4),
Saitensprünge, gleiche Tonhöhe auf anderer Saite, Rollen mit demselben Finger, hohe Lagen, Leersaiten (bevorzugen / normal / vermeiden).
Haltebögen bleiben auf derselben Saite, `@n` erzwingt eine Saite.

## Entwicklung

```bash
npm install
npm run dev      # lokaler Server
npm test         # Parser, Griffbild, alphaTex
npm run build    # nach dist/
```

## Deployment auf GitHub Pages

1. Repo auf GitHub anlegen und Code auf `main` pushen.
2. Repo → **Settings → Pages → Source: GitHub Actions**.
3. Der Workflow `.github/workflows/deploy.yml` baut, testet und veröffentlicht bei jedem Push.
   Die Seite läuft unter `https://<user>.github.io/<repo>/` (relativer `base` in `vite.config.ts`).

## Datenschutz

Kein eigener Server. API-Key und Notation liegen nur im `localStorage` des Browsers. Fotos gehen ausschließlich direkt an die Gemini API.
Hinweis: Ein im Browser genutzter API-Key ist für jeden mit Zugriff auf diesen Browser lesbar – Key im AI Studio ggf. auf die Gemini API beschränken.

## Design

Siehe `PRODUCT.md` (Produktwahrheit) und `DESIGN.md` (Design-System). Gebaut mit den Skills *impeccable*, *design-taste-frontend* (taste-skill) und *emil-design-eng*, die unter `.claude/skills/` liegen. Fotos: William P. Gottlieb / Library of Congress (gemeinfrei), Video: Wikimedia Commons (CC BY 4.0) – Nachweise im Footer der Landing Page und in `assets/credits.json`.

## Stack

Vite + TypeScript · [alphaTab](https://alphatab.net) (Notensatz/Tab) · [@google/genai](https://www.npmjs.com/package/@google/genai) · jsPDF
