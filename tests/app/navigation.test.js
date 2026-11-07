import { describe, expect, test } from 'bun:test';
import { bootApp, makeSeed } from '../harness/app.js';
import { useApp } from '../harness/use-app.js';

const slot = useApp();

describe('navegación', () => {
  test('cada pestaña muestra su sección y marca aria-current', async () => {
    slot.app = await bootApp();

    for (const section of [
      'incidencia',
      'aprender',
      'reportar',
      'progreso',
    ]) {
      slot.app.click(`.navbtn[data-sec="${section}"]`);

      expect(slot.app.hasClass(`sec-${section}`, 'active')).toBe(true);
      const nav = slot.app.q(`.navbtn[data-sec="${section}"]`);
      expect(nav.classList.contains('active')).toBe(true);
      expect(nav.getAttribute('aria-current')).toBe('page');
    }
  });

  test('Riesgo muestra la semana publicada para el municipio', async () => {
    slot.app = await bootApp();

    slot.app.click('.navbtn[data-sec="incidencia"]');

    const hero = slot.app.q('.risk-hero');
    expect(hero).not.toBeNull();
    expect(hero.textContent).toContain('Gobernador Virasoro');
    expect(hero.textContent).toContain('Semana 45');
    expect(hero.textContent).toContain('Riesgo alto');
  });

  test('un deep link ?sec= abre la pestaña pedida', async () => {
    slot.app = await bootApp({
      path: '/?sec=aprender',
    });

    await slot.app.waitFor(() => slot.app.hasClass('sec-aprender', 'active'));
    expect(slot.app.hasClass('sec-aprender', 'active')).toBe(true);
  });

  test('el tour de bienvenida se recorre y marca la cuenta como onboarded', async () => {
    slot.app = await bootApp({
      seed: makeSeed({ profile: { onboarded: false } }),
    });

    expect(slot.app.hasClass('tourOverlay', 'show')).toBe(true);

    for (let i = 0; i < 5; i += 1) {
      slot.app.click('#tourNext');
    }

    expect(slot.app.hasClass('tourOverlay', 'show')).toBe(false);
    await slot.app.waitFor(() => {
      const profile = slot.app
        .fakeState()
        .tables.profiles.find((candidate) => candidate.id === 'user-1');
      return profile.onboarded === true;
    });
  });
});
