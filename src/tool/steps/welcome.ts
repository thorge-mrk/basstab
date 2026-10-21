// Erster Besuch: Willkommen, kurz erklären, API-Key einrichten, Modell wählen.

import { h, icon } from '../dom';
import { prefs, savePrefs } from '../state';
import { looksLikeKey, modelPicker } from '../widgets';
import { checkKey } from '../../gemini';
import type { Ctx } from '../app';

export function renderWelcome(root: HTMLElement, ctx: Ctx) {
  const keyInput = h('input', {
    type: 'password', id: 'key', autocomplete: 'off', spellcheck: 'false', placeholder: 'AQ.… oder AIza…', value: prefs.apiKey,
    'aria-describedby': 'key-help key-status',
  });
  const status = h('p', { id: 'key-status', class: 'status', role: 'status' });
  const picker = modelPicker(prefs.model);
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Key prüfen und loslegen');

  const form = h('form', { class: 'key-form', novalidate: true },
    h('label', { class: 'field', for: 'key' }, 'Dein Gemini-API-Key'),
    h('div', { class: 'input-row' }, keyInput,
      h('button', { class: 'btn quiet icon-only', type: 'button', 'aria-label': 'Key anzeigen', onclick: () => {
        keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      } }, icon('eye'))),
    h('p', { id: 'key-help', class: 'help' },
      'Kostenlos im Google AI Studio unter ',
      h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'),
      ' erstellen und hier einfügen.'),
    h('p', { class: 'help' },
      'Es gelten die ', h('a', { href: '../nutzungsbedingungen/' }, 'Nutzungsbedingungen'),
      ' von BassTab und die Bedingungen von Google. Was mit deinen Fotos passiert, steht im ',
      h('a', { href: '../datenschutz/' }, 'Datenschutz'), '.'),
    h('p', { class: 'field' }, 'Welches Modell soll lesen?'),
    picker.el,
    status,
    h('div', { class: 'step-actions' },
      submit,
      h('button', { class: 'btn quiet', type: 'button', onclick: () => {
        prefs.onboarded = true;
        savePrefs();
        ctx.go('source');
      } }, 'Erst mal ohne Key')),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = keyInput.value.trim();
    if (!looksLikeKey(key)) {
      status.className = 'status error';
      status.textContent = 'Das sieht nicht nach einem API-Key aus. Neue Keys beginnen mit „AQ.“, ältere mit „AIza“.';
      keyInput.focus();
      return;
    }
    submit.disabled = true;
    status.className = 'status busy';
    status.textContent = 'Prüfe den Key bei Google …';
    try {
      await checkKey(key, picker.value());
      prefs.apiKey = key;
      prefs.model = picker.value();
      prefs.onboarded = true;
      savePrefs();
      ctx.go('source');
    } catch (err) {
      status.className = 'status error';
      status.textContent = (err as Error).message;
      submit.disabled = false;
    }
  });

  root.append(
    h('div', { class: 'welcome' },
      h('div', { class: 'welcome-intro' },
        h('h1', {}, 'Willkommen bei BassTab'),
        h('p', { class: 'lead' }, 'Du fotografierst deine Bassstimme, BassTab liest sie, du prüfst die unsicheren Stellen – und bekommst ein PDF mit Noten und spielbarer Tab.'),
        h('div', { class: 'local-note' },
          icon('lock', 22),
          h('p', {}, h('strong', {}, 'Alles läuft bei dir im Browser.'), ' Kein Konto, kein BassTab-Server. Dein Key, deine Fotos und dein Stück bleiben auf diesem Gerät – nur zum Lesen geht das Foto mit deinem Key direkt an Google.')),
        h('ol', { class: 'howto' },
          h('li', {}, h('strong', {}, 'Foto machen'), h('span', {}, 'Eine oder mehrere Seiten, gerade von oben.')),
          h('li', {}, h('strong', {}, 'Lesen lassen'), h('span', {}, 'Gemini liest Takt für Takt, mit Dynamik, Wiederholungen und allen Zeichen.')),
          h('li', {}, h('strong', {}, 'Bestätigen'), h('span', {}, 'Wo die KI unsicher ist, zeigt BassTab dir den Ausschnitt aus dem Foto.')),
          h('li', {}, h('strong', {}, 'PDF holen'), h('span', {}, 'Griffbild für 4-Saiter, wie ein Bassist es greifen würde.')),
        ),
      ),
      h('section', { class: 'panel', 'aria-labelledby': 'key-title' },
        h('h2', { id: 'key-title' }, 'Einmal einrichten'),
        form,
      ),
    ),
  );
  if (!prefs.apiKey) keyInput.focus({ preventScroll: true });
}
