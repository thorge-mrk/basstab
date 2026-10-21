# BassTab

Statische Web-App: Fotos von Bassnoten hochladen → Noten werden erkannt → automatisch **spielbares** Griffbild für 4-Saiter-Bass (oder Drop D / 5-Saiter) → Darstellung als Notenzeile + Tabulatur → **PDF-Download**.

## Ablauf

1. **Quelle**
   - **Foto**: Erkennung mit Gemini – Modell wählbar (Standard `gemini-3.5-flash-lite`, außerdem `gemini-3.8-flash`, `gemini-4-argon` oder eigene Modell-ID) über deinen eigenen Google-AI-Studio-API-Key.
   - **MusicXML**: ohne KI, z. B. aus Audiveris, MuseScore oder einer Scan-App.
   - **Beispiel**: Demo zum Ausprobieren.
2. **Prüfen & korrigieren** in einer kompakten Textnotation (Hilfe in der App). Falsche Taktlängen werden markiert, Gemini meldet unsichere Takte. Klick auf einen Takt in der Vorschau springt zur Zeile.
3. **Noten + Tab** mit alphaTab rendern, Griffbild-Optionen anpassen, PDF herunterladen.

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

## Stack

Vite + TypeScript · [alphaTab](https://alphatab.net) (Notensatz/Tab) · [@google/genai](https://www.npmjs.com/package/@google/genai) · jsPDF
