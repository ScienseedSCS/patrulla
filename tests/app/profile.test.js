import { describe, expect, test } from 'bun:test';
import { bootApp, bootGuest, makeSeed } from '../harness/app.js';
import { useApp } from '../harness/use-app.js';

const slot = useApp();

describe('perfil', () => {
  test('guardar el perfil actualiza la cabecera y la fila del usuario', async () => {
    slot.app = await bootApp();
    const app = slot.app;

    app.click('#userChip');
    await app.waitFor(() => app.hasClass('sec-profile', 'active'));

    app.setValue('#pfName', 'Ana María');
    app.click('#savePerfil');

    await app.waitFor(() => app.text('#msgPerfil').includes('¡Perfil actualizado!'));
    expect(app.text('#hdrName')).toBe('Ana María');

    const profile = app
      .fakeState()
      .tables.profiles.find((candidate) => candidate.id === 'user-1');
    expect(profile.username).toBe('Ana María');
  });

  test('cerrar sesión limpia la sesión y la próxima carga pide login', async () => {
    const seed = makeSeed();
    slot.app = await bootApp({ seed });
    const app = slot.app;

    app.click('#userChip');
    app.click('#profLogout');
    await app.waitFor(() => app.fakeState().sessionUserId === null);

    expect(app.reloadCount()).toBe(1);

    // happy-dom no navega: simulamos la recarga con una ventana nueva y el
    // localStorage que dejó la sesión anterior (incluido el fake store).
    const storage = app.dumpStorage();
    await app.close();
    slot.app = await bootGuest({ seed, storage });

    expect(slot.app.hasClass('authScreen', 'hide')).toBe(false);
    expect(slot.app.fakeState().sessionUserId).toBeNull();
  });
});
