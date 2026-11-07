import { afterEach, expect } from 'bun:test';

/**
 * Registra un afterEach que cierra la ventana de happy-dom y falla si la
 * app emitió un error de JavaScript no controlado durante la prueba.
 *
 *   const slot = useApp();
 *   test('...', async () => { slot.app = await bootApp(); ... });
 */
export function useApp() {
  const slot = { app: null, ignoreErrors: [] };

  afterEach(async () => {
    if (!slot.app) return;
    const errors = slot.app.errors.filter((error) => {
      const text = String(
        (error && (error.stack || error.message || error)) || ''
      );
      return !slot.ignoreErrors.some((pattern) => pattern.test(text));
    });
    if (slot.app) await slot.app.close();
    slot.app = null;
    expect(errors).toEqual([]);
  });

  return slot;
}
