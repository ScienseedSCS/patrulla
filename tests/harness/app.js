/**
 * Harness para ejecutar la app real (index.html) dentro de happy-dom con
 * Bun. No hay navegador ni servidor: el HTML se escribe en un DOM, se
 * reemplaza supabase-js por un fake en memoria y se espera a que la app
 * llegue al estado que pide cada test.
 *
 * Esto permite testear flujos de UI completos con `bun test` en segundos.
 * Cuando la app se parta en módulos, este harness sigue sirviendo: sólo
 * hay que cambiar cómo se cargan los scripts.
 */

import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { TEST_SUPABASE_URL, makeSeed } from './seed.js';

const ROOT = new URL('../..', import.meta.url).pathname;
const FAKE_SUPABASE = readFileSync(
  new URL('./fake-supabase.js', import.meta.url),
  'utf8'
);
const HTML_CACHE = new Map();

function sourceOf(file) {
  if (!HTML_CACHE.has(file)) {
    HTML_CACHE.set(file, readFileSync(ROOT + file, 'utf8'));
  }
  return HTML_CACHE.get(file);
}

let windowCounter = 0;

function prepareHtml(source, seed) {
  let html = source;

  // Fuera el bundle real de Supabase y el config real: los reemplaza el fake.
  html = html.replace(
    /<script\s+src="supabase-js[^"]*"[^>]*><\/script>\s*/i,
    ''
  );
  html = html.replace(/<script\s+src="config\.js"><\/script>\s*/i, '');

  // Si en el futuro la app se sirve como `src/app.js` (o un bundle), lo
  // incrustamos para que happy-dom lo ejecute sin red. El fake de Supabase
  // se inyecta después, antes del script que crea el cliente.
  html = html.replace(
    /<script\s+src="([^"]+\.js)"[^>]*><\/script>\s*/gi,
    (tag, src) => {
      if (/supabase-js/i.test(src)) return '';
      const file = src.replace(/^\.?\//, '');
      try {
        return `<script>\n${sourceOf(file)}\n</script>\n`;
      } catch (e) {
        // Un script remoto o inexistente se deja como está.
        return tag;
      }
    }
  );

  // Las fuentes no aportan a los tests y happy-dom no carga CSS externo.
  html = html.replace(/<link[^>]+href="fuentes\.css"[^>]*>\s*/i, '');

  // El script principal es el que crea el cliente de Supabase. Sirve para
  // index.html y para los paneles de administración.
  const appMarker = 'var db = supabase.createClient';
  const markerIndex = html.indexOf(appMarker);
  if (markerIndex < 0) {
    throw new Error('No se encontró el script principal en el HTML');
  }
  const scriptStart = html.lastIndexOf('<script>', markerIndex);
  if (scriptStart < 0) {
    throw new Error('No se encontró el <script> principal de la app');
  }

  const injected =
    '<script>\n' +
    `window.__TEST_SUPABASE_URL__ = ${JSON.stringify(TEST_SUPABASE_URL)};\n` +
    `window.SUPABASE_URL = ${JSON.stringify(TEST_SUPABASE_URL)};\n` +
    'window.SUPABASE_ANON_KEY = "test-anon-key";\n' +
    `window.__FAKE_SEED__ = ${JSON.stringify(seed)};\n` +
    FAKE_SUPABASE +
    '\n</script>\n';

  return html.slice(0, scriptStart) + injected + html.slice(scriptStart);
}

function installBrowserStubs(window) {
  // El contexto JS de happy-dom no siempre expone los globales estándar.
  // Los copiamos desde Node para que el HTML real se ejecute igual que en
  // un navegador (JSON y encodeURIComponent son los que más se usan).
  const standardGlobals = [
    'JSON',
    'Math',
    'Date',
    'Promise',
    'Object',
    'Array',
    'String',
    'Number',
    'Boolean',
    'RegExp',
    'Error',
    'TypeError',
    'RangeError',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Symbol',
    'Proxy',
    'Reflect',
    'Uint8Array',
    'Uint8ClampedArray',
    'Int8Array',
    'Uint16Array',
    'Int16Array',
    'Uint32Array',
    'Int32Array',
    'Float32Array',
    'Float64Array',
    'ArrayBuffer',
    'DataView',
    'parseInt',
    'parseFloat',
    'isNaN',
    'isFinite',
    'encodeURIComponent',
    'decodeURIComponent',
    'encodeURI',
    'decodeURI',
    'Infinity',
    'NaN',
    'queueMicrotask',
    'structuredClone',
    'TextEncoder',
    'TextDecoder',
    'URL',
    'URLSearchParams',
    'atob',
    'btoa',
    'fetch',
    'AbortController',
    'Intl',
  ];
  for (const key of standardGlobals) {
    if (window[key] === undefined && globalThis[key] !== undefined) {
      try {
        window[key] = globalThis[key];
      } catch (e) {
        /* algunos globales son read-only */
      }
    }
  }

  // Canvas: la app re-codifica fotos para quitar EXIF. En el DOM simulado
  // no hay render, así que alcanza con devolver un canvas "de mentira".
  const context = {
    drawImage() {},
    clearRect() {},
    fillRect() {},
    getImageData() {
      return { data: new Uint8ClampedArray(4) };
    },
    putImageData() {},
    save() {},
    restore() {},
    scale() {},
    rotate() {},
    translate() {},
    beginPath() {},
    closePath() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    measureText() {
      return { width: 0 };
    },
    fillText() {},
  };
  if (window.HTMLCanvasElement) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      return context;
    };
    window.HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(
        new window.Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
          type: 'image/jpeg',
        })
      );
    };
  }
  if (window.Blob && !window.Blob.prototype.arrayBuffer) {
    window.Blob.prototype.arrayBuffer = function () {
      return Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer);
    };
  }

  // happy-dom no convierte números a string en `textContent = 0` (lo deja
  // vacío). En un navegador real se ve "0", así que corregimos el setter
  // para que las pruebas reflejen el comportamiento del navegador.
  const textContentDescriptor = Object.getOwnPropertyDescriptor(
    window.Element.prototype,
    'textContent'
  );
  if (textContentDescriptor && textContentDescriptor.set) {
    Object.defineProperty(window.Element.prototype, 'textContent', {
      configurable: true,
      get: textContentDescriptor.get,
      set(value) {
        textContentDescriptor.set.call(this, value == null ? '' : String(value));
      },
    });
  }

  // La app recarga la página al cerrar sesión. En happy-dom no hay
  // navegación real: registramos el pedido para que la prueba pueda
  // simular la recarga con una ventana nueva y el localStorage copiado.
  try {
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value() {
        window.__reloadCount = (window.__reloadCount || 0) + 1;
      },
    });
  } catch (e) {
    /* location es read-only en algunos runtimes */
  }

  // Object URLs de mentira.
  window.URL.createObjectURL = function () {
    return 'blob:patrulla-test';
  };
  window.URL.revokeObjectURL = function () {};

  // Imagen: en cuanto se asigna src, "carga" con un tamaño fijo.
  class FakeImage {
    constructor() {
      this.naturalWidth = 100;
      this.naturalHeight = 100;
      this.width = 100;
      this.height = 100;
      this.onload = null;
      this.onerror = null;
      this._src = '';
    }
    set src(value) {
      this._src = value;
      if (this.onload) Promise.resolve().then(() => this.onload());
    }
    get src() {
      return this._src;
    }
  }
  window.Image = FakeImage;

  // La app sólo pregunta por permiso de notificaciones; en tests no hay push.
  if (!window.Notification) {
    window.Notification = { permission: 'denied' };
  }
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  }

  // Web Crypto: happy-dom puede no exponer subtle. La app tolera null, pero
  // para probar el hash de fotos devolvemos un digest estable.
  try {
    if (!window.crypto || !window.crypto.subtle) {
      Object.defineProperty(window, 'crypto', {
        configurable: true,
        value: {
          randomUUID: () =>
            'test-' + Math.random().toString(16).slice(2) + '-' + Date.now(),
          subtle: {
            digest: () => Promise.resolve(new Uint8Array(32).buffer),
          },
        },
      });
    }
  } catch (e) {
    /* crypto es read-only en algunos runtimes: la app ya se defiende */
  }
}

function waitFor(condition, options = {}) {
  const timeout = options.timeout || 3000;
  const interval = options.interval || 5;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function poll() {
      let value;
      try {
        value = condition();
      } catch (e) {
        reject(e);
        return;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - started > timeout) {
        reject(new Error(options.message || 'Timeout esperando una condición'));
        return;
      }
      setTimeout(poll, interval);
    }
    poll();
  });
}

function waitForClass(window, id, className, expected) {
  return waitFor(
    () => {
      const element = window.document.getElementById(id);
      if (!element) return false;
      const has = element.classList.contains(className);
      return has === expected ? element : false;
    },
    {
      message: `Timeout esperando #${id}${expected ? '.' : ':not(.'}${className}`,
    }
  );
}

export function bootWindow(options = {}) {
  const seed = options.seed || makeSeed();
  const window = new Window({
    url: `https://patrulla-${++windowCounter}.test${options.path || '/'}`,
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });

  installBrowserStubs(window);

  const errors = [];
  window.addEventListener('error', (event) => {
    const message = String(
      (event && (event.message || (event.error && event.error.message))) || ''
    );
    // happy-dom no carga CSS externo; no es un error de la app.
    if (/external stylesheet|CSS file loading/i.test(message)) return;
    errors.push(event.error || event.message || 'error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    errors.push(event.reason || 'unhandledrejection');
  });
  const originalConsoleError = window.console.error.bind(window.console);
  window.console.error = (...args) => {
    errors.push(args);
    originalConsoleError(...args);
  };

  // Un usuario "que ya vio la bienvenida" es el caso normal. La prueba de
  // onboarding pide explícitamente welcomeSeen: false.
  if (options.storage) {
    for (const [key, value] of Object.entries(options.storage)) {
      try {
        window.localStorage.setItem(key, value);
      } catch (e) {
        /* sin localStorage la app también arranca */
      }
    }
  }
  if (options.welcomeSeen !== false) {
    try {
      window.localStorage.setItem('pa_welcome_seen', '1');
    } catch (e) {
      /* sin localStorage la app también arranca */
    }
  }

  const html = prepareHtml(sourceOf(options.file || 'index.html'), seed);
  window.document.write(html);

  const document = window.document;

  const api = {
    window,
    document,
    seed,
    errors,
    $: (id) => document.getElementById(id),
    $$: (selector) => Array.from(document.querySelectorAll(selector)),
    q: (selector) => document.querySelector(selector),
    text: (selector) => {
      const element =
        typeof selector === 'string'
          ? document.querySelector(selector)
          : selector;
      return element ? element.textContent : null;
    },
    hasClass: (id, className) => {
      const element = document.getElementById(id);
      return !!element && element.classList.contains(className);
    },
    click: (target) => {
      const element =
        typeof target === 'string' ? document.querySelector(target) : target;
      if (!element) throw new Error(`No existe el elemento para click: ${target}`);
      element.click();
      return element;
    },
    clickAt: (target, clientX, clientY) => {
      const element =
        typeof target === 'string' ? document.querySelector(target) : target;
      if (!element) throw new Error(`No existe el elemento para click: ${target}`);
      element.dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        })
      );
      return element;
    },
    setValue: (target, value) => {
      const element =
        typeof target === 'string' ? document.querySelector(target) : target;
      if (!element) throw new Error(`No existe el campo: ${target}`);
      element.value = value;
      element.dispatchEvent(new window.Event('input', { bubbles: true }));
      element.dispatchEvent(new window.Event('change', { bubbles: true }));
      return element;
    },
    select: (target, value) => {
      const element =
        typeof target === 'string' ? document.querySelector(target) : target;
      if (!element) throw new Error(`No existe el select: ${target}`);
      element.value = value;
      element.dispatchEvent(new window.Event('change', { bubbles: true }));
      return element;
    },
    upload: (target, file) => {
      const element =
        typeof target === 'string' ? document.querySelector(target) : target;
      if (!element) throw new Error(`No existe el input de archivo: ${target}`);
      const uploadFile =
        file ||
        new window.File([new Uint8Array([137, 80, 78, 71])], 'foto.png', {
          type: 'image/png',
        });
      Object.defineProperty(element, 'files', {
        configurable: true,
        value: [uploadFile],
      });
      element.dispatchEvent(new window.Event('change', { bubbles: true }));
      return uploadFile;
    },
    mockRect: (target, rect) => {
      const element =
        typeof target === 'string' ? document.querySelector(target) : target;
      if (!element) throw new Error(`No existe el elemento: ${target}`);
      element.getBoundingClientRect = () => ({
        x: rect.x || 0,
        y: rect.y || 0,
        left: rect.left || 0,
        top: rect.top || 0,
        right: (rect.left || 0) + (rect.width || 100),
        bottom: (rect.top || 0) + (rect.height || 100),
        width: rect.width || 100,
        height: rect.height || 100,
        toJSON() {
          return rect;
        },
      });
      return element;
    },
    waitFor: (condition, waitOptions) => waitFor(condition, waitOptions),
    waitForClass: (id, className, expected = true) =>
      waitForClass(window, id, className, expected),
    waitForApp: async () => {
      await waitForClass(window, 'boot', 'hide', true);
      await waitFor(
        () =>
          !document.getElementById('appScreen').classList.contains('hide') &&
          document.getElementById('appScreen'),
        { message: 'La app no llegó a la pantalla principal' }
      );
    },
    waitForAuth: async () => {
      await waitFor(
        () =>
          !document.getElementById('authScreen').classList.contains('hide') &&
          document.getElementById('authScreen'),
        { message: 'La app no mostró el login' }
      );
    },
    fakeState: () => window.__PATRULLA_FAKE__.snapshot(),
    dumpStorage: () => {
      const entries = {};
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        entries[key] = window.localStorage.getItem(key);
      }
      return entries;
    },
    reloadCount: () => window.__reloadCount || 0,
    close: () => window.happyDOM.close(),
  };

  return api;
}

export async function bootApp(options = {}) {
  const app = bootWindow(options);
  try {
    await waitForClass(app.window, 'boot', 'hide', true);
    await waitFor(
      () => !app.$('appScreen').classList.contains('hide') && app.$('appScreen'),
      { message: 'La app no llegó a la pantalla principal' }
    );
  } catch (error) {
    await app.close().catch(() => {});
    throw error;
  }
  return app;
}

export async function bootAdmin(options = {}) {
  const app = bootWindow({ ...options, file: options.file || 'admin.html' });
  try {
    await waitFor(
      () => {
        const gate = app.$('gate');
        if (!gate) return false;
        if (gate.classList.contains('hide')) return 'dashboard';
        if (app.$('gateMsg') && app.$('gateMsg').textContent.trim()) return 'gate';
        return false;
      },
      { message: 'admin.html no resolvió el acceso' }
    );
  } catch (error) {
    await app.close().catch(() => {});
    throw error;
  }
  return app;
}

export async function bootGuest(options = {}) {
  const app = bootWindow(options);
  try {
    await waitFor(
      () => {
        const onboarding = app.$('onbOverlay');
        const auth = app.$('authScreen');
        if (onboarding && onboarding.classList.contains('show')) return 'onboarding';
        if (auth && !auth.classList.contains('hide')) return 'auth';
        return false;
      },
      { message: 'La app no mostró onboarding ni login' }
    );
  } catch (error) {
    await app.close().catch(() => {});
    throw error;
  }
  return app;
}

export { makeSeed, waitFor };
