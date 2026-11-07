import { describe, expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname;

/**
 * Presupuesto del monolito.
 *
 * La meta es dejar de servir toda la app desde un único index.html. Mientras
 * eso pasa, este test impide que el archivo siga creciendo sin control. Cada
 * vez que se extraiga un módulo, bajá el presupuesto para que el avance quede
 * fijado (ratchet).
 */
describe('presupuesto del monolito', () => {
  test('index.html no supera el tamaño acordado', () => {
    const bytes = statSync(ROOT + 'index.html').size;
    // 2026-11: ~399 KB. Tope para no seguir engordando el HTML.
    expect(bytes).toBeLessThan(420 * 1024);
  });

  test('el script inline de index.html no sigue creciendo', () => {
    const html = readFileSync(ROOT + 'index.html', 'utf8');
    const scripts = Array.from(
      html.matchAll(/<script>([\s\S]*?)<\/script>/g),
      (match) => match[1]
    );
    const lines = scripts.reduce(
      (total, script) => total + script.split('\n').length,
      0
    );
    // 2026-11: ~3.120 líneas. Al extraer módulos, este número debe bajar.
    expect(lines).toBeLessThan(3200);
  });

  test('los paneles de administración tienen su propio presupuesto', () => {
    expect(statSync(ROOT + 'admin.html').size).toBeLessThan(90 * 1024);
    expect(statSync(ROOT + 'admin-reportes.html').size).toBeLessThan(65 * 1024);
  });
});
