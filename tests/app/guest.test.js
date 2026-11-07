import { describe, expect, test } from 'bun:test';
import { bootGuest, makeSeed } from '../harness/app.js';
import { useApp } from '../harness/use-app.js';

const slot = useApp();

describe('acceso', () => {
  test('la primera visita muestra la bienvenida y luego el login', async () => {
    slot.app = await bootGuest({
      seed: makeSeed({ session: false }),
      welcomeSeen: false,
    });

    expect(slot.app.hasClass('onbOverlay', 'show')).toBe(true);
    expect(slot.app.text('#onbTitle')).toContain('Bienvenido');
    expect(slot.app.hasClass('authScreen', 'hide')).toBe(true);

    slot.app.click('#onbSkip');

    expect(slot.app.hasClass('onbOverlay', 'show')).toBe(false);
    expect(slot.app.hasClass('authScreen', 'hide')).toBe(false);
  });

  test('un login inválido muestra un mensaje claro', async () => {
    slot.app = await bootGuest({
      seed: makeSeed({ session: false }),
    });

    slot.app.setValue('#inEmail', 'ana@example.com');
    slot.app.setValue('#inPass', 'no-es-la-clave');
    slot.app.click('#authSubmit');

    await slot.app.waitFor(() => slot.app.hasClass('authError', 'show'));

    expect(slot.app.text('#authError')).toBe(
      'Email o contraseña incorrectos.'
    );
    expect(slot.app.hasClass('appScreen', 'hide')).toBe(true);
  });

  test('un login válido entra a la app con el perfil cargado', async () => {
    slot.app = await bootGuest({
      seed: makeSeed({ session: false }),
    });

    slot.app.setValue('#inEmail', 'ana@example.com');
    slot.app.setValue('#inPass', 'secreta123');
    slot.app.click('#authSubmit');

    await slot.app.waitForApp();

    expect(slot.app.hasClass('appScreen', 'hide')).toBe(false);
    expect(slot.app.text('#hdrName')).toBe('Ana');
    expect(slot.app.text('#pts')).toBe('400');
  });

  test('el registro valida la contraseña antes de crear la cuenta', async () => {
    slot.app = await bootGuest({
      seed: makeSeed({ session: false }),
    });

    slot.app.click('#switchBtn');
    slot.app.setValue('#inName', 'Carla');
    slot.app.select('#inCity', 'Gobernador Virasoro');
    slot.app.setValue('#inEmail', 'carla@example.com');
    slot.app.setValue('#inPass', 'corta');
    slot.app.click('#authSubmit');

    await slot.app.waitFor(() => slot.app.hasClass('authError', 'show'));

    expect(slot.app.text('#authError')).toContain('al menos 8 caracteres');
    expect(slot.app.hasClass('appScreen', 'hide')).toBe(true);
  });

  test('el registro crea el perfil y entra directo a la app', async () => {
    slot.app = await bootGuest({
      seed: makeSeed({ session: false }),
    });

    slot.app.click('#switchBtn');
    await slot.app.waitFor(() => slot.app.$('inCity').options.length > 1);

    slot.app.setValue('#inName', 'Carla');
    slot.app.select('#inCity', 'Gobernador Virasoro');
    slot.app.setValue('#inEmail', 'carla@example.com');
    slot.app.setValue('#inPass', 'secreta123');
    slot.app.click('#authSubmit');

    await slot.app.waitForApp();

    expect(slot.app.text('#hdrName')).toBe('Carla');
    expect(slot.app.text('#pts')).toBe('0');
    const profiles = slot.app.fakeState().tables.profiles;
    expect(
      profiles.some((profile) => profile.username === 'Carla')
    ).toBe(true);
  });

  test('la recuperación de contraseña sólo pide el email y confirma el envío', async () => {
    slot.app = await bootGuest({
      seed: makeSeed({ session: false }),
    });

    slot.app.click('#forgotBtn');

    expect(slot.app.hasClass('fieldPass', 'hide')).toBe(true);
    expect(slot.app.hasClass('fieldName', 'hide')).toBe(true);

    slot.app.setValue('#inEmail', 'ana@example.com');
    slot.app.click('#authSubmit');

    await slot.app.waitFor(() => slot.app.hasClass('authNote', 'show'));
    expect(slot.app.text('#authNote')).toContain('Revisá tu email');
  });
});
