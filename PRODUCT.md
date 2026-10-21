# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Bassistinnen und Bassisten aller Niveaus im deutschsprachigen Raum: Hobby-Bassisten, Bandmitglieder, Musikschüler. Typische Situation: Sie bekommen eine Bassstimme als Notenblatt (Papier, Foto, PDF) – z. B. ein Arrangement für die Band – lesen aber lieber Tabs oder wollen sich das Griffbild sparen. Sie fotografieren das Blatt mit dem Handy und wollen schnell ein sauberes, spielbares Blatt mit Noten + Tab zum Üben/Proben.

## Product Purpose

BassTab macht aus einem Foto einer Bassstimme ein druckfertiges PDF mit Notenzeile und 4-Saiter-Tabulatur darunter. Erfolg = das PDF stimmt mit dem Original überein (Tonhöhen, Rhythmus, Form, Zeichen) und das Griffbild ist bequem spielbar.

## Positioning

- Kein reiner Notenscanner: das Griffbild wird für das ganze Stück optimiert (Lagenwechsel, Dehnungen, Leersaiten, Technik wählbar), nicht Note für Note umgerechnet.
- Der Mensch bestätigt: unsichere Stellen werden einzeln gezeigt und bestätigt/korrigiert, danach Gesamtkontrolle.
- Läuft komplett im Browser, kein eigener Server, kein Konto. Eigener Google-AI-Studio-Key (Bring your own key), Modell wählbar.

## Operating Context

- Upload meist vom Handy (Kamera-Foto, mehrere Seiten), Korrektur und PDF oft am Handy oder Laptop.
- Notenblätter können Bleistift-Notizen enthalten (Notennamen, Fingersätze), die ignoriert werden müssen.
- Inhalte eines Bassblatts: Schlüssel, Tonart, Taktart, Tempo, Noten/Pausen, Bindebögen, Triolen, Wiederholungen, Volten, Segno/Coda/D.S., Probenziffern, Mehrtaktpausen, Dynamik (p, mf, f, cresc.), Artikulation (Staccato, Akzent), Spielanweisungen (z. B. „tutti“, „solo“).
- Alternative ohne KI: MusicXML-Import.

## Capabilities and Constraints

- Statische Seite auf GitHub Pages (`/` Landing, `/tool/` Werkzeug). Vite + TypeScript, alphaTab für Notensatz, jsPDF.
- Erkennung via Gemini (Standard `gemini-3.5-flash-lite`, wählbar: 3.8 Flash, 4 Argon, eigene ID). Key nur im localStorage.
- Erkennung ist nicht fehlerfrei; das Produkt muss die Kontrolle durch den Menschen leicht machen.
- Offen: kein Konto, keine Synchronisation, keine Wiedergabe/Audio.

## Brand Commitments

- Name: **BassTab**.
- Sprache: Deutsch, direkt, per Du, ohne Marketing-Floskeln.
- Nicht: typischer KI-SaaS-Look (Lila-Blau-Verläufe, Glas-Karten, generische Icon-Kacheln), nicht verspielt/comichaft, nicht nüchtern-amtlich – Musik-Atmosphäre ja, aber mit Präzision.

## Evidence on Hand

- Echtes Beispiel: Bassstimme „Todo tiene su final“ (Hector Lavoe, Arr. Sebastian Wiesener) als Demo-Notation (`src/demo.ts`) und daraus erzeugtes PDF.
- Keine Nutzerzahlen, Testimonials oder Pressestimmen – nichts davon erfinden.

## Product Principles

1. Das Blatt ist das Produkt: Notensatz und PDF-Qualität haben Vorrang vor UI-Effekten.
2. Vertrauen durch Kontrolle: jede KI-Unsicherheit wird sichtbar und ist mit einem Tipp lösbar.
3. Spielbarkeit vor Mechanik: Griffbilder so, wie ein guter Bassist sie wählen würde.
4. Privat by default: keine Server, keine Konten, Daten bleiben im Browser (außer der Bildanfrage an Google).

## Accessibility & Inclusion

Mobile first (Handy-Kamera als Hauptquelle), große Touch-Ziele, Tastaturbedienung, prefers-reduced-motion respektieren, ausreichende Kontraste auch im Dark Mode.
