import { describe, expect, test } from 'bun:test';
import { bootAdmin, makeSeed } from '../harness/app.js';
import { useApp } from '../harness/use-app.js';

const slot = useApp();

describe('panel de administración', () => {
  test('una cuenta sin permisos no puede entrar', async () => {
    slot.app = await bootAdmin({
      seed: makeSeed({ profile: { is_admin: false } }),
    });
    const app = slot.app;

    expect(app.document.body.classList.contains('locked')).toBe(true);
    expect(app.hasClass('gate', 'hide')).toBe(false);
    expect(app.text('#gateMsg')).toContain('no tiene permisos de administrador');
    // Ya hay una sesión: se ofrece cerrarla para entrar con otra cuenta.
    expect(app.hasClass('gateForm', 'hide')).toBe(true);
    expect(app.hasClass('gateLogout', 'hide')).toBe(false);
  });

  test('una cuenta administradora desbloquea el centro de monitoreo', async () => {
    slot.app = await bootAdmin({
      seed: makeSeed({ profile: { is_admin: true } }),
    });
    const app = slot.app;

    await app.waitFor(() => app.hasClass('gate', 'hide'));
    expect(app.document.body.classList.contains('locked')).toBe(false);
    expect(app.text('#sessionWho')).toContain('Ana');
    expect(app.text('#sessionWho')).toContain('ana@example.com');
  });
});

describe('cola de moderación', () => {
  test('una cuenta común no puede entrar a revisar reportes', async () => {
    slot.app = await bootAdmin({
      file: 'admin-reportes.html',
      seed: makeSeed({ profile: { is_admin: false, is_reviewer: false } }),
    });
    const app = slot.app;

    expect(app.text('#gateMsg')).toContain('no está autorizada para revisar');
    expect(app.hasClass('gate', 'hide')).toBe(false);
  });

  test('un revisor autorizado entra a la cola sin permisos de admin', async () => {
    slot.app = await bootAdmin({
      file: 'admin-reportes.html',
      seed: makeSeed({ profile: { is_admin: false, is_reviewer: true } }),
    });
    const app = slot.app;

    expect(app.hasClass('gate', 'hide')).toBe(true);
    expect(app.text('#sessionWho')).toContain('revisor/a');
    expect(app.text('#sessionWho')).toContain('Ana');
  });
});
