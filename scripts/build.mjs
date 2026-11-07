#!/usr/bin/env node
/**
 * Build estático de Patrulla Antimosquito.
 *
 * Genera `dist/` con SOLO los archivos que deben servirse en producción.
 * No necesita dependencias: usa únicamente módulos nativos de Node.
 *
 * Uso:
 *   node scripts/build.mjs
 *   COPY_CONFIG=1 node scripts/build.mjs   # para previsualizar en local con el config.js del repo
 *
 * `config.js` NO se incluye por defecto: el contenedor lo genera al arrancar
 * a partir de SUPABASE_URL y SUPABASE_ANON_KEY (ver deploy/entrypoint-config.sh).
 */

import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const REQUIRED = [
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
];

const OPTIONAL = [
  'caso2.jpg',
];

const LICENSES = [
  'LICENCIA-dm-serif-display.txt',
  'LICENCIA-jetbrains-mono.txt',
  'LICENCIA-raleway.txt',
];

async function listFonts() {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.woff2'))
    .map((e) => e.name)
    .sort();
}

async function copyInto(relativePath, destination = relativePath) {
  const from = path.join(root, relativePath);
  const to = path.join(dist, destination);
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function totalSize(dir) {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await totalSize(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function main() {
  const missing = REQUIRED.filter((file) => !existsSync(path.join(root, file)));
  if (missing.length) {
    console.error('Faltan archivos obligatorios para el build:');
    for (const file of missing) console.error(`  - ${file}`);
    process.exit(1);
  }

  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const fonts = await listFonts();
  const files = [
    ...REQUIRED,
    ...OPTIONAL.filter((file) => existsSync(path.join(root, file))),
    ...fonts,
  ];

  for (const file of [...new Set(files)]) {
    await copyInto(file);
  }

  for (const license of LICENSES) {
    if (existsSync(path.join(root, license))) {
      await copyInto(license, path.join('licenses', license));
    }
  }

  await writeFile(
    path.join(dist, 'robots.txt'),
    [
      'User-agent: *',
      'Disallow: /admin.html',
      'Disallow: /admin-reportes.html',
      '',
    ].join('\n'),
    'utf8',
  );

  await writeFile(path.join(dist, 'healthz'), 'ok\n', 'utf8');

  const buildInfo = {
    commit: process.env.CI_COMMIT_SHA || process.env.GITHUB_SHA || 'local',
    ref: process.env.CI_COMMIT_REF_NAME || process.env.GITHUB_REF_NAME || '',
    builtAt: new Date().toISOString(),
    builder: 'scripts/build.mjs',
  };
  await writeFile(path.join(dist, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');

  if (process.env.COPY_CONFIG === '1') {
    if (!existsSync(path.join(root, 'config.js'))) {
      console.error('COPY_CONFIG=1 pero no existe config.js en la raíz.');
      process.exit(1);
    }
    await copyInto('config.js');
    console.warn('AVISO: se copió config.js del repo. No usar este build para staging/producción.');
  }

  const size = await totalSize(dist);
  const copied = [...new Set(files)].length + LICENSES.length + 3;
  console.log(`Build listo: dist/ (${copied} archivos, ${formatBytes(size)})`);
  console.log(`  HTML: ${REQUIRED.filter((f) => f.endsWith('.html')).join(', ')}`);
  console.log(`  Fuentes: ${fonts.length}`);
  console.log(`  config.js: ${existsSync(path.join(dist, 'config.js')) ? 'incluido (local)' : 'se genera al arrancar el contenedor'}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
