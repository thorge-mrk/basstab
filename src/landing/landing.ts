// Landing Page: gepinnte Blatt-Geschichte, Live-Griffbild, Zeichen-Galerie, Modell-Liste, Fragen.

import '@fontsource-variable/tiktok-sans/standard.css';
import '@fontsource/reenie-beanie/400.css';
import './landing.css';
import { RIFF_PHOTO, RIFF_TAB, GRIP_RIFF, SHOWCASE } from './examples';

document.documentElement.classList.add('js');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s)!;
const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => [...root.querySelectorAll<T>(s)];

// alphaTab & Notenlogik erst laden, wenn sie gebraucht werden
type Engine = typeof import('./engine');
let engine: Promise<Engine> | null = null;
const loadEngine = () => (engine ??= import('./engine'));

/** Ruft fn auf, sobald el in die Nähe des Viewports kommt. */
function whenNear(el: Element, fn: () => void, margin = '600px') {
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      fn();
    }
  }, { rootMargin: margin });
  io.observe(el);
}

// ---------------------------------------------------------------------------
// Eintritt der Abschnitte: Überschrift, Text, Bild gestaffelt (Inhalt bleibt ohne JS sichtbar)

function reveal() {
  const groups = $$('main section, .foot');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -12% 0px' });
  for (const g of groups) {
    $$('h2, .beat-line, p, .seg, .grip-sheet, .card, li, .cta .btn, .models-photo', g).forEach((el, i) => {
      el.classList.add('rise');
      (el as HTMLElement).style.setProperty('--i', String(Math.min(i, 8)));
    });
    io.observe(g);
  }
}

// ---------------------------------------------------------------------------
// Gepinntes Blatt: Foto → Lesen → Prüfen → Tab

function story() {
  const sheet = $('.sheet');
  const beats = $$('.beat');
  const boxes = $('.sheet-boxes');
  let rects: { x: number; y: number; w: number; h: number }[] = [];
  let readTimer = 0;

  const setState = (state: string) => {
    if (sheet.dataset.state === state) return;
    sheet.dataset.state = state;
    beats.forEach((b) => b.classList.toggle('is-active', b.dataset.state === state));
    $$('.beat-dots button').forEach((d, i) => d.classList.toggle('is-on', beats[i]?.dataset.state === state));
    clearInterval(readTimer);
    if (state === 'read') animateRead();
    if (state === 'check') {
      $$('.sbox', boxes).forEach((b, i) => {
        b.classList.add('lit');
        b.classList.toggle('is-question', i === rects.length - 1);
      });
    }
  };

  // Takte nacheinander aufleuchten lassen, wie im Werkzeug
  const animateRead = () => {
    const all = $$('.sbox', boxes);
    all.forEach((b) => b.classList.remove('lit', 'is-question'));
    const count = $('.sheet-status b');
    let i = 0;
    const step = () => {
      if (i >= all.length) return clearInterval(readTimer);
      all[i].classList.add('lit');
      count.textContent = String(i + 1);
      i++;
    };
    step();
    readTimer = window.setInterval(step, reduce ? 0 : 420);
  };

  // Desktop: Schritte scrollen am gepinnten Blatt vorbei. Telefon: Schritte unter dem Blatt zum Wischen.
  const phone = matchMedia('(max-width: 900px)');
  const strip = $('.beats');
  const onBeat = (forPhone: boolean) => (entries: IntersectionObserverEntry[]) => {
    if (phone.matches !== forPhone) return;
    for (const e of entries) if (e.isIntersecting) setState((e.target as HTMLElement).dataset.state!);
  };
  const desktopIo = new IntersectionObserver(onBeat(false), { rootMargin: '-45% 0px -45% 0px' });
  const phoneIo = new IntersectionObserver(onBeat(true), { root: strip, threshold: 0.6 });
  beats.forEach((b) => {
    desktopIo.observe(b);
    phoneIo.observe(b);
  });
  beats[0].classList.add('is-active');
  $$('.beat-dots button').forEach((d, i) =>
    d.addEventListener('click', () => strip.scrollTo({ left: beats[i].offsetLeft - beats[0].offsetLeft, behavior: reduce ? 'auto' : 'smooth' })));

  whenNear(sheet, async () => {
    const { ScoreView, texFor } = await loadEngine();
    await document.fonts.load('22px "Reenie Beanie"').catch(() => null);
    // am Telefon kleiner, damit Blatt und Erklärung zusammen auf den Bildschirm passen
    const scale = phone.matches ? Math.min(0.8, Math.max(0.58, $('.sheet-paper').clientWidth / 560)) : Math.min(1.45, Math.max(0.8, $('.sheet-paper').clientWidth / 520));
    const photoView = new ScoreView($('.sheet-photo'), { bare: true, ink: '#1f2523', effectFont: { family: 'Reenie Beanie', size: 30 }, scale, barsPerRow: 2 });
    const tabView = new ScoreView($('.sheet-tab'), { bare: true, scale, barsPerRow: 2 });
    photoView.onRendered = () => {
      rects = photoView.barRects($('.sheet-paper'));
      boxes.replaceChildren(...rects.map((r, i) => {
        const b = document.createElement('span');
        b.className = 'sbox';
        Object.assign(b.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
        b.dataset.n = String(i + 1);
        return b;
      }));
      // Zustand neu anwenden, falls die Boxen erst nach dem Scrollen fertig wurden
      const st = sheet.dataset.state!;
      sheet.dataset.state = '';
      setState(st);
    };
    photoView.render(texFor(RIFF_PHOTO, { view: 'score' }));
    tabView.render(texFor(RIFF_TAB, { view: 'both' }));
  });
}

// ---------------------------------------------------------------------------
// Live-Griffbild

function grip() {
  const host = $('.grip-score');
  const readout = $('.grip-readout');
  whenNear(host, async () => {
    const { ScoreView, texFor, fingeringStats } = await loadEngine();
    const view = new ScoreView(host, { bare: true });
    const update = () => {
      const technique = ($<HTMLInputElement>('input[name=tech]:checked').value) as 'ofpf' | 'simandl';
      const openStrings = ($<HTMLInputElement>('input[name=open]:checked').value) as 'prefer' | 'neutral' | 'avoid';
      const opts = { view: 'both' as const, technique, openStrings };
      view.render(texFor(GRIP_RIFF, opts));
      const s = fingeringStats(GRIP_RIFF, opts);
      readout.textContent = `${s.open} ${s.open === 1 ? 'Leersaite' : 'Leersaiten'} · ${s.crossings} Saitenwechsel · höchster Bund ${s.maxFret}`;
      if (!reduce) host.animate([{ opacity: 0.55, filter: 'blur(2px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    };
    $$('.grip input').forEach((i) => i.addEventListener('change', update));
    update();
  });
}

// ---------------------------------------------------------------------------
// Zeichen-Galerie: Karten wandern über das gehaltene Foto

function showcase() {
  const section = $('.showcase');
  const track = $('.showcase-track');
  const title = $('.showcase h2');
  const wide = matchMedia('(min-width: 901px)');

  whenNear(section, async () => {
    const { ScoreView, texFor } = await loadEngine();
    for (const card of $$('.card')) {
      const src = SHOWCASE[card.dataset.example!];
      if (src) new ScoreView($('.card-score', card), { bare: true, scale: innerWidth > 900 ? 1.1 : 0.85 }).render(texFor(src, { view: 'both' }));
    }
  }, '900px');

  // Höhe des Abschnitts = Bildschirm + Kartenstrecke, damit Scrollen und Wandern zusammenpassen
  let travel = 0;
  const measure = () => {
    const win = track.parentElement as HTMLElement;
    travel = Math.max(0, track.offsetLeft + track.scrollWidth - win.clientWidth);
    section.style.height = reduce ? '' : `${Math.round(innerHeight + travel * (wide.matches ? 0.5 : 1))}px`;
  };

  const texts = $$('.card h3, .card p', track);
  const textRange = document.createRange();
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (reduce) return;
      const r = section.getBoundingClientRect();
      const range = section.offsetHeight - innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, range)));
      track.style.transform = `translate3d(${-p * travel}px, 0, 0)`;
      // Text einer Karte erst zeigen, wenn er ganz im Fenster steht – nie angeschnitten
      const win = track.parentElement!.getBoundingClientRect();
      for (const el of texts) {
        textRange.selectNodeContents(el); // Ausmaß des Textes selbst, nicht der ganzen Zeile
        const er = textRange.getBoundingClientRect();
        el.classList.toggle('is-cut', er.left < win.left - 1 || er.right > win.right + 1);
      }
      // Desktop: Überschrift wandert den Karten voraus aus dem Bild
      const margin = (track.parentElement as HTMLElement).offsetLeft;
      title.style.transform = wide.matches ? `translate3d(${-Math.min(1, p * 2.2) * (title.offsetWidth + margin * 2)}px, 0, 0)` : '';
    });
  };
  // nur bei echter Breitenänderung neu messen (die Adressleiste am Handy ändert ständig die Höhe)
  let lastWidth = innerWidth;
  addEventListener('resize', () => {
    if (innerWidth !== lastWidth) {
      lastWidth = innerWidth;
      measure();
    }
    onScroll();
  });
  measure();
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ---------------------------------------------------------------------------
// Modell-Liste mit wechselndem Foto

function models() {
  const items = $$('.models-list li');
  const photos = $$<HTMLImageElement>('.models-photo img');
  const activate = (i: number) => {
    items.forEach((li, j) => {
      li.classList.toggle('is-active', i === j);
      $('button', li).setAttribute('aria-expanded', String(i === j));
    });
    photos.forEach((p, j) => p.classList.toggle('is-active', i === j));
  };
  items.forEach((li, i) => {
    const btn = $('button', li);
    btn.addEventListener('click', () => activate(i));
    btn.addEventListener('focus', () => activate(i));
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) li.addEventListener('pointerenter', () => activate(i));
  });
  activate(0);
}

// ---------------------------------------------------------------------------
// Fragen: links die Frage, rechts groß die Antwort (am Handy aufklappen)

function faq() {
  const tabs = $$<HTMLButtonElement>('.faq [role=tab]');
  const pane = $('.faq-answer');
  const select = (i: number, focus = false) => {
    tabs.forEach((t, j) => {
      t.setAttribute('aria-selected', String(i === j));
      t.tabIndex = i === j ? 0 : -1;
      t.closest('li')!.classList.toggle('is-open', i === j);
    });
    pane.setAttribute('aria-labelledby', tabs[i].id);
    $('.faq-q', pane).textContent = tabs[i].textContent;
    $('.faq-text', pane).textContent = tabs[i].nextElementSibling!.textContent;
    if (!reduce) pane.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
    if (focus) tabs[i].focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(i));
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) t.addEventListener('pointerenter', () => select(i));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') select((i + 1) % tabs.length, true);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') select((i - 1 + tabs.length) % tabs.length, true);
      else return;
      e.preventDefault();
    });
  });
  select(0);
}

// ---------------------------------------------------------------------------
// Ticket-Abriss: „BassTab öffnen“ bleibt unten links, sobald die Hero-Karte weg ist

function stub() {
  // nur während der langen Blatt-Geschichte – dort verdeckt er nichts
  const el = $<HTMLAnchorElement>('.stub');
  el.hidden = false;
  new IntersectionObserver(([e]) => el.classList.toggle('is-shown', e.isIntersecting), { rootMargin: '-30% 0px -30% 0px' }).observe($('.story'));
}

function video() {
  const v = $<HTMLVideoElement>('.grip-video video');
  if (reduce) {
    v.removeAttribute('autoplay');
    v.controls = true;
    return;
  }
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) void v.play().catch(() => (v.controls = true));
    else v.pause();
  }, { threshold: 0.25 }).observe(v);
}

reveal();
video();
story();
grip();
showcase();
models();
faq();
stub();
