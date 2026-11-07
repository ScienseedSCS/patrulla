import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname;

function read(relative) {
  return readFileSync(ROOT + relative, 'utf8');
}

function localReferences(html) {
  return [
    ...Array.from(html.matchAll(/\bsrc="([^"]+)"/g), (match) => match[1]),
    ...Array.from(html.matchAll(/\bhref="([^"]+)"/g), (match) => match[1]),
  ].filter(
    (reference) =>
      !reference.startsWith('http') &&
      !reference.startsWith('data:') &&
      !reference.startsWith('#') &&
      !reference.startsWith('mailto:') &&
      // Ignorar URLs armadas en JS: src="'+variable+'".
      !/['+$\{]/.test(reference)
  );
}

describe('assets y PWA', () => {
  test('index.html y los paneles apuntan a archivos que existen', () => {
    for (const file of ['index.html', 'admin.html', 'admin-reportes.html']) {
      for (const reference of new Set(localReferences(read(file)))) {
        const path = reference.replace(/^\.\//, '').split('?')[0];
        // config.js lo genera el contenedor al arrancar.
        if (path === 'config.js') continue;
        expect(existsSync(ROOT + path)).toBe(true);
      }
    }
  });

  test('el service worker sólo precachea archivos que existen', () => {
    const sw = read('sw.js');
    const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/);
    expect(shell).not.toBeNull();

    const entries = Array.from(shell[1].matchAll(/'([^']+)'/g), (m) => m[1]);
    expect(entries.length).toBeGreaterThan(5);

    for (const entry of entries) {
      if (entry === './' || entry === './config.js') continue;
      const path = entry.replace(/^\.\//, '');
      expect(existsSync(ROOT + path)).toBe(true);
    }
  });

  test('el manifest declara íconos existentes y un start_url válido', () => {
    const manifest = JSON.parse(read('manifest.webmanifest'));
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.icons.length).toBeGreaterThan(0);

    for (const icon of manifest.icons) {
      const path = icon.src.replace(/^\.\//, '');
      expect(existsSync(ROOT + path)).toBe(true);
    }
  });
});
