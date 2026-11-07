import { afterEach, expect, test } from 'bun:test';
import { bootApp, bootGuest, makeSeed } from '../harness/app.js';

let app = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

test('smoke: la primera visita muestra el onboarding antes del login', async () => {
  app = await bootGuest({
    seed: makeSeed({ session: false }),
    welcomeSeen: false,
  });

  expect(app.hasClass('onbOverlay', 'show')).toBe(true);
  expect(app.text('#onbTitle')).toContain('Bienvenido');
  expect(app.hasClass('authScreen', 'hide')).toBe(true);

  app.click('#onbSkip');

  expect(app.hasClass('onbOverlay', 'show')).toBe(false);
  expect(app.hasClass('authScreen', 'hide')).toBe(false);
});

test('smoke: con sesión la app arranca en Reportar', async () => {
  app = await bootApp({ seed: makeSeed() });

  expect(app.hasClass('appScreen', 'hide')).toBe(false);
  expect(app.hasClass('sec-reportar', 'active')).toBe(true);
  expect(app.text('#hdrName')).toBe('Ana');
  expect(app.text('#pts')).toBe('400');
  expect(app.$$('#actionsGrid .action-card').length).toBeGreaterThan(0);
});
