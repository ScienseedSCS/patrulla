import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname;

function read(relative) {
  return readFileSync(ROOT + relative, 'utf8');
}

// Cuando el JS salga de index.html, estos tests siguen cubriendo el código
// que viva en src/. Hoy src/ no existe; la lista queda preparada.
function sourceFiles() {
  const files = ['index.html'];
  if (existsSync(ROOT + 'src')) {
    for (const file of readdirSync(ROOT + 'src', { recursive: true })) {
      if (String(file).endsWith('.js')) files.push('src/' + file);
    }
  }
  return files;
}

const html = read('index.html');
const allSource = sourceFiles()
  .map((file) => read(file))
  .join('\n');
const markup = html.replace(/<script[\s\S]*?<\/script>/gi, '');

function attrValues(source, attribute) {
  return Array.from(
    source.matchAll(new RegExp(`\\b${attribute}="([^"]+)"`, 'g')),
    (match) => match[1]
  );
}

function idsIn(source) {
  return Array.from(
    source.matchAll(/\bid="([^"]+)"/g),
    (match) => match[1]
  );
}

describe('estructura de index.html', () => {
  test('no hay IDs duplicados en el marcado', () => {
    const ids = idsIn(markup);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect([...new Set(duplicates)]).toEqual([]);
  });

  test('cada pestaña de la barra inferior tiene su sección', () => {
    const sections = new Set(attrValues(markup, 'data-sec'));
    expect(sections.size).toBeGreaterThan(0);
    for (const section of sections) {
      if (section.includes('+')) continue; // selectores armados en JS
      expect(markup).toContain(`id="sec-${section}"`);
    }
  });

  test('los IDs que busca el JS existen en algún lado del archivo', () => {
    const declared = new Set(idsIn(allSource));
    const referenced = new Set([
      ...Array.from(allSource.matchAll(/\$\(\s*'([^']+)'\s*\)/g), (m) => m[1]),
      ...Array.from(
        allSource.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g),
        (m) => m[1]
      ),
    ]);

    const missing = [...referenced].filter((id) => !declared.has(id));
    expect(missing).toEqual([]);
  });

  test('la CSP permite hablar con el Supabase configurado', () => {
    const csp = html.match(
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/
    );
    expect(csp).not.toBeNull();

    const config = read('config.js');
    const supabaseUrl = config.match(/SUPABASE_URL\s*=\s*'([^']+)'/)[1];
    const origin = new URL(supabaseUrl).origin;

    expect(csp[1]).toContain(`connect-src`);
    expect(csp[1]).toContain(origin);
    expect(csp[1]).toContain("object-src 'none'");
    expect(csp[1]).toContain("base-uri 'self'");
  });

  test('no hay claves secretas en archivos que se publican', () => {
    const published = [
      'index.html',
      'admin.html',
      'admin-reportes.html',
      'config.js',
      'sw.js',
      'manifest.webmanifest',
      'scripts/build.mjs',
    ];
    for (const file of published) {
      const content = read(file);
      expect(content).not.toMatch(/service_role\s*:/i);
      expect(content).not.toMatch(/sb_secret_/i);
      expect(content).not.toMatch(/SUPABASE_SERVICE_ROLE/i);
    }
  });
});
