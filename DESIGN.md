---
name: BassTab
description: Kopisten-Chart – kühles Notenpapier, eine Petrol-Tinte, eckige Formen.
colors:
  paper: "#f7f9f8"
  white: "#ffffff"
  tone: "#ebf0ee"
  tone-2: "#dfe7e5"
  ink: "#06525c"
  ink-deep: "#04434b"
  text: "#0b2f33"
  text-2: "#3b5b5f"
  line: "#d3dedb"
  control: "#a9bcb8"
  on-ink: "#f7f9f8"
  pencil: "#5d5f5e"
  night: "#0d1c1e"
  error: "#a3261c"
  warn: "#7a5200"
typography:
  display:
    fontFamily: "TikTok Sans Variable, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 1.1rem + 1.2vw, 2.25rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.01em"
  heading:
    fontFamily: "TikTok Sans Variable, system-ui, sans-serif"
    fontSize: "clamp(2rem, 1.3rem + 3.2vw, 4rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "TikTok Sans Variable, system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 1.1rem + 0.7vw, 1.625rem)"
    fontWeight: 400
    lineHeight: 1.3
  body:
    fontFamily: "TikTok Sans Variable, system-ui, sans-serif"
    fontSize: "clamp(1.0625rem, 1rem + 0.25vw, 1.1875rem)"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "TikTok Sans Variable, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  app-title:
    fontFamily: "TikTok Sans Variable, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  pencil:
    fontFamily: "Reenie Beanie, cursive"
    fontSize: "30px"
    fontWeight: 400
rounded:
  none: "0"
spacing:
  margin: "clamp(16px, 3vw, 40px)"
  section: "clamp(120px, 14vw, 200px)"
  control-height: "44px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.none}"
    height: "{spacing.control-height}"
    padding: "10px 18px"
  button-primary-hover:
    backgroundColor: "{colors.ink-deep}"
  button-on-ink:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    height: "{spacing.control-height}"
  panel:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.none}"
    padding: "24px"
---

## Overview

BassTab sieht aus wie ein handkopiertes Band-Chart: kühles Notenpapier, alles in einer Petrol-Tinte, Probenziffern als gefüllte Kästen. Die Landing Page ist eine Persuade-Fläche mit Archivfotos von William P. Gottlieb (Bassisten der 52nd Street, 1946–48, gemeinfrei) in einheitlichem Schwarzweiß. Das Werkzeug unter `/tool/` ist eine ruhige Arbeitsfläche im selben System. Das Notenblatt selbst ist immer weiß, auch im PDF.

## Colors

- **Papier** `#f7f9f8` ist der Grund, **Weiß** nur für Blätter, Panels und Eingabefelder.
- **Tinte** `#06525c` trägt jedes Wort, jede Fläche und jede Aktion auf der Landing Page. Im Werkzeug ist Fließtext `#0b2f33`, Nebentext `#3b5b5f` (≥ 7:1 auf Weiß).
- **Ganze Felder**: das Griffbild-Feld und der Fuß sind komplett Tinte mit Papier-Schrift.
- **Graphit** `#5d5f5e` nur für Bleistift-Notizen auf gezeigten Blättern.
- Fehler `#a3261c`, Hinweis `#7a5200` – nur im Werkzeug, nur als Text.

## Typography

Eine Familie: **TikTok Sans** (variabel, selbst gehostet). Titel in 800, auf 125–150 % Breite gezogen, auf der Landing Page in Versalien nur für Hero-Titel und Wortmarke. Fließtext in normaler Breite. **Reenie Beanie** ausschließlich als Bleistift-Handschrift in Notenbeispielen. Skala: small 14 · body 17–19 · lead 20–26 · title 24–36 · head 32–64 px; App-Titel 28 px.

## Layout

Zwölfspaltiges Raster, gleiche Außenränder `clamp(16px, 3vw, 40px)`, Abschnittsabstand 120–200 px. Landing: Text links (Spalten 1–5), Bild/Blatt rechts (7–12), gepinnte Bühnen mit `position: sticky`, kein Scroll-Hijacking. Werkzeug: max. 1080 px, ein Schritt pro Ansicht, Aktionen am Ende, auf dem Handy als fixierte Leiste unten.

## Elevation & Depth

Flach. Trennung über eine Tonstufe (`tone`) oder 1-px-Kanten (`line`) im Werkzeug. Schatten nur auf Dialogen, Bottom-Sheet und Toast. Keine Verläufe – einzige Ausnahme: neutrale Abdunklung unter Text auf dem Abschlussfoto.

## Shapes

Alles eckig: Buttons, Felder, Karten, Panels (Radius 0). Rund sind nur Punkte (Fragen-Index, Wisch-Punkte) und der Lade-Kreis.

## Components

- **Programmkarte** (Hero): Tintenfeld über gedimmtem Foto, Titel über die Oberkante verteilt, Aktion in der Mitte der Unterkante.
- **Gepinntes Blatt**: ein Notenblatt mit Zuständen Foto → Lesen (Takt-Boxen) → Prüfen (Frage) → Tab.
- **Takt-Box**: 2-px-Tintenrahmen, 10 % Tintenfläche, Nummernfähnchen oben links. Gleich im Werkzeug beim Lesen und Markieren.
- **Lesart-Karte** (Prüfen): Radio-Karte mit Mini-Noten + Tab, gewählte Karte mit Tinten-Innenrand und Häkchen.
- **Segmentschalter**: Radios als eckige Schalter, gewählt = Papierfläche.

## Do's and Don'ts

- Do: echte Notenbeispiele mit alphaTab statt Screenshots; Zustände in HTML umschalten.
- Do: Motion nur mit Zweck – Takt-Kaskade beim Lesen, Schrittwechsel 260 ms ease-out, Button-Druck `scale(0.97)`; `prefers-reduced-motion` respektieren.
- Don't: Lila/Blau-Verläufe, Glas, Icon-Kacheln, Eyebrow-Labels, Monospace als Deko (nur für echte Notation), Schatten auf ruhenden Flächen.
- Don't: Bilder als Produktfotos ausgeben – die Gottlieb-Fotos zeigen die Welt des Basses, nicht BassTab-Nutzer.
