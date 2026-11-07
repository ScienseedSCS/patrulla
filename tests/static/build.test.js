import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname;
const DIST = ROOT + 'dist/';

function read(relative) {
  return readFileSync(ROOT + relative, 'utf8');
}

describe('build estático', () => {
  test('genera sólo los archivos de runtime y deja afuera lo interno', () => {
    execFileSync(process.env.NODE_BIN || 'node', ['scripts/build.mjs'], {
      cwd: ROOT,
      stdio: 'pipe',
    });

    for (const file of [
      'index.html',
      'admin.html',
      'admin-reportes.html',
      'supabase-js-2.117.3.js',
      'fuentes.css',
      'manifest.webmanifest',
      'sw.js',
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-512.png',
      'caso1.jpg',
      'robots.txt',
      'healthz',
      'build-info.json',
    ]) {
      expect(existsSync(DIST + file)).toBe(true);
    }

    for (const file of [
      'README.md',
      'ADMIN.md',
      'TESTING.md',
      'tests',
      '.github',
      'caso1.png',
      'logo.png',
      '.gitignore',
      // config.js se genera al arrancar el contenedor, no se hornea.
      'config.js',
    ]) {
      expect(existsSync(DIST + file)).toBe(false);
    }

    expect(readFileSync(DIST + 'healthz', 'utf8')).toBe('ok\n');
    expect(readFileSync(DIST + 'robots.txt', 'utf8')).toContain(
      'Disallow: /admin.html'
    );
  });

  test('el dist no referencia archivos locales que no existan', () => {
    const html = readFileSync(DIST + 'index.html', 'utf8');
    const references = [
      ...Array.from(html.matchAll(/\bsrc="([^"]+)"/g), (match) => match[1]),
      ...Array.from(html.matchAll(/\bhref="([^"]+)"/g), (match) => match[1]),
    ].filter((reference) => {
      return (
        !reference.startsWith('http') &&
        !reference.startsWith('data:') &&
        !reference.startsWith('#') &&
        // Ignorar URLs armadas en JS: src="'+variable+'".
        !/['+$\{]/.test(reference) &&
        reference !== 'config.js' // se genera en el contenedor
      );
    });

    for (const reference of new Set(references)) {
      expect(existsSync(DIST + reference.replace(/^\.\//, ''))).toBe(true);
    }
  });

  test('los archivos del build no son enormes por accidente', () => {
    // El HTML es grande por ahora, pero el build no debe publicar imágenes
    // fuente ni documentación. Este límite es una red de seguridad.
    const index = statSync(DIST + 'index.html');
    expect(index.size).toBeLessThan(600 * 1024);

    const files = readdirSync(DIST);
    expect(files).not.toContain('caso1.png');
  });
});
