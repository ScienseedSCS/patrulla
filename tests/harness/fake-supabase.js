/*
 * Supabase falso en memoria para los tests de la app.
 *
 * No usa red: implementa el subconjunto del cliente que usa Patrulla
 * (auth, from().select/insert/update/upsert/delete, rpc y storage).
 *
 * El harness lo inyecta inline antes del script de la app y le pasa el
 * estado inicial en `window.__FAKE_SEED__`:
 *
 *   {
 *     seedId: 'un-id-estable-para-esta-prueba',
 *     tables: { profiles: [...], reports: [...], ... },
 *     users: [{ id, email, password }],
 *     sessionUserId: 'user-1' | null,
 *     rpc: { nombre: { data, error } },
 *     confirmEmail: false
 *   }
 *
 * El estado vive en localStorage con la clave `__patrulla_fake_supabase__`
 * y sólo se reinicia cuando cambia `seedId`. Eso permite simular recargas
 * (logout, volver a entrar) sin perder los datos creados por la prueba.
 */
(function () {
  'use strict';

  var SEED = window.__FAKE_SEED__ || {};
  var STORE_KEY = '__patrulla_fake_supabase__';
  var SUPABASE_URL = window.__TEST_SUPABASE_URL__ || 'https://test.supabase.co';
  var PIXEL =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  var store = null;
  try {
    store = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null');
  } catch (e) {
    store = null;
  }
  if (!store || store.seedId !== SEED.seedId) {
    store = {
      seedId: SEED.seedId || 'default',
      tables: clone(SEED.tables || {}),
      users: clone(SEED.users || []),
      sessionUserId:
        SEED.sessionUserId === undefined ? null : SEED.sessionUserId,
      rpc: clone(SEED.rpc || {}),
      storage: {},
      confirmEmail: !!SEED.confirmEmail,
      seq: 1,
    };
    persist();
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function persist() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {
      /* localStorage lleno o bloqueado: el test sigue en memoria */
    }
  }

  function table(name) {
    if (!Array.isArray(store.tables[name])) store.tables[name] = [];
    return store.tables[name];
  }

  function nextId() {
    return 'fake-' + store.seq++;
  }

  function levelFor(points) {
    if (points >= 1200) return 6;
    if (points >= 700) return 5;
    if (points >= 350) return 4;
    if (points >= 150) return 3;
    if (points >= 50) return 2;
    return 1;
  }

  function profileOf(userId) {
    return table('profiles').find(function (p) {
      return p.id === userId;
    });
  }

  function addPoints(userId, delta) {
    if (!delta) return;
    var profile = profileOf(userId);
    if (!profile) return;
    profile.points = (profile.points || 0) + delta;
    profile.level = levelFor(profile.points);
    persist();
  }

  function publicUser(user) {
    return user ? { id: user.id, email: user.email } : null;
  }

  function currentUser() {
    if (!store.sessionUserId) return null;
    return (
      store.users.find(function (u) {
        return u.id === store.sessionUserId;
      }) || null
    );
  }

  function currentSession() {
    var user = currentUser();
    if (!user) return null;
    return {
      access_token: 'fake-access-token',
      token_type: 'bearer',
      user: publicUser(user),
    };
  }

  var authListeners = [];
  function emitAuth(event) {
    var session = currentSession();
    authListeners.slice().forEach(function (cb) {
      try {
        cb(event, session);
      } catch (e) {
        /* un listener roto no debe romper la app */
      }
    });
  }

  function fail(message, code, status) {
    return {
      data: null,
      error: { message: message, code: code || null, status: status || 400 },
      count: null,
      status: status || 400,
    };
  }

  function ok(data, count) {
    return { data: data === undefined ? null : data, error: null, count: count || null, status: 200 };
  }

  // ---- Triggers mínimos del servidor -------------------------------------
  // La app no escribe puntos: los suma el backend. El fake replica lo justo
  // para que los totales visibles en la UI sean coherentes.
  function applyLearnTestBonus(previous, row) {
    var total = table('learn_questions').filter(function (q) {
      return q.active !== false && (row.block === 'repaso' || q.block === row.block);
    }).length;
    if (row.bonus_awarded && !(previous && previous.bonus_awarded)) {
      var bonus =
        row.best_score >= total
          ? 15
          : row.best_score >= Math.ceil(total * 0.8)
            ? 8
            : 0;
      addPoints(row.user_id, bonus);
    }
    persist();
  }

  function afterInsert(name, row) {
    if (name === 'profiles') {
      row.points = row.points || 0;
      row.level = row.level || levelFor(row.points);
    }
    if (name === 'learn_test_progress') {
      applyLearnTestBonus(null, row);
    }
    if (name === 'reports' && row.points_awarded) {
      addPoints(row.user_id, row.points_awarded);
    }
    if (name === 'spot_answers') {
      var challenge = table('spot_challenges').find(function (c) {
        return c.id === row.challenge_id;
      });
      if (challenge && challenge.points) addPoints(row.user_id, challenge.points);
    }
    if (name === 'learn_question_correct') {
      addPoints(row.user_id, 2);
    }
    if (name === 'report_reviews') {
      var report = table('reports').find(function (r) {
        return r.id === row.report_id;
      });
      if (report) report.review_count = (report.review_count || 0) + 1;
    }
    persist();
  }

  function afterUpdate(name, previous, row) {
    if (name === 'learn_test_progress') {
      applyLearnTestBonus(previous, row);
    }
  }

  // ---- Query builder -----------------------------------------------------
  function matches(row, filters) {
    return filters.every(function (filter) {
      var value = row[filter.column];
      switch (filter.op) {
        case 'eq':
          return value === filter.value;
        case 'neq':
          return value !== filter.value;
        case 'in':
          return (filter.value || []).indexOf(value) >= 0;
        case 'gte':
          return value != null && String(value) >= String(filter.value);
        case 'lte':
          return value != null && String(value) <= String(filter.value);
        default:
          return true;
      }
    });
  }

  function from(name) {
    var state = {
      table: name,
      op: 'select',
      columns: '*',
      filters: [],
      orders: [],
      limit: null,
      single: false,
      maybeSingle: false,
      head: false,
      count: null,
      payload: null,
      onConflict: null,
    };

    var api = {};

    api.select = function (columns, options) {
      state.columns = columns || '*';
      if (options) {
        if (options.count) state.count = options.count;
        if (options.head) state.head = true;
      }
      return api;
    };
    api.insert = function (payload) {
      state.op = 'insert';
      state.payload = payload;
      return api;
    };
    api.update = function (payload) {
      state.op = 'update';
      state.payload = payload;
      return api;
    };
    api.upsert = function (payload, options) {
      state.op = 'upsert';
      state.payload = payload;
      state.onConflict = (options && options.onConflict) || 'id';
      return api;
    };
    api.delete = function () {
      state.op = 'delete';
      return api;
    };
    api.eq = function (column, value) {
      state.filters.push({ op: 'eq', column: column, value: value });
      return api;
    };
    api.neq = function (column, value) {
      state.filters.push({ op: 'neq', column: column, value: value });
      return api;
    };
    api.in = function (column, value) {
      state.filters.push({ op: 'in', column: column, value: value });
      return api;
    };
    api.gte = function (column, value) {
      state.filters.push({ op: 'gte', column: column, value: value });
      return api;
    };
    api.lte = function (column, value) {
      state.filters.push({ op: 'lte', column: column, value: value });
      return api;
    };
    api.order = function (column, options) {
      state.orders.push({
        column: column,
        ascending: !options || options.ascending !== false,
      });
      return api;
    };
    api.limit = function (n) {
      state.limit = n;
      return api;
    };
    api.single = function () {
      state.single = true;
      return api;
    };
    api.maybeSingle = function () {
      state.maybeSingle = true;
      return api;
    };

    function runSelect() {
      var rows = table(state.table).filter(function (row) {
        return matches(row, state.filters);
      });
      var total = rows.length;
      rows = rows.slice();
      state.orders.forEach(function (order) {
        rows.sort(function (a, b) {
          var av = a[order.column];
          var bv = b[order.column];
          if (av === bv) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          var result = av < bv ? -1 : 1;
          return order.ascending ? result : -result;
        });
      });
      if (state.limit != null) rows = rows.slice(0, state.limit);
      var data = rows.map(clone);
      var count = state.count === 'exact' ? total : null;
      if (state.head) return { data: null, error: null, count: count, status: 200 };
      if (state.single) {
        if (data.length !== 1) {
          return {
            data: null,
            error: {
              code: 'PGRST116',
              message: 'JSON object requested, multiple (or no) rows returned',
              status: 406,
            },
            count: count,
            status: 406,
          };
        }
        return { data: data[0], error: null, count: count, status: 200 };
      }
      if (state.maybeSingle) {
        return { data: data[0] || null, error: null, count: count, status: 200 };
      }
      return { data: data, error: null, count: count, status: 200 };
    }

    function runInsert() {
      var input = Array.isArray(state.payload) ? state.payload : [state.payload];
      var inserted = input.map(function (item) {
        var row = clone(item);
        if (row.id == null && state.table !== 'profiles') row.id = nextId();
        if (state.table === 'reports') {
          row.created_at = row.created_at || new Date().toISOString();
          row.status = row.status || 'pendiente';
          row.review_count = row.review_count || 0;
        }
        if (state.table === 'report_reviews') {
          var duplicate = table('report_reviews').some(function (existing) {
            return (
              existing.report_id === row.report_id &&
              existing.reviewer_id === row.reviewer_id
            );
          });
          if (duplicate) {
            return { error: { code: '23505', message: 'duplicate key value', status: 409 } };
          }
        }
        table(state.table).push(row);
        afterInsert(state.table, row);
        return row;
      });
      var duplicate = inserted.find(function (item) {
        return item && item.error;
      });
      if (duplicate) return { data: null, error: duplicate.error, count: null, status: 409 };
      return { data: inserted.map(clone), error: null, count: null, status: 201 };
    }

    function runUpdate() {
      var updated = [];
      table(state.table).forEach(function (row) {
        if (!matches(row, state.filters)) return;
        var previous = clone(row);
        Object.assign(row, clone(state.payload));
        afterUpdate(state.table, previous, row);
        updated.push(row);
      });
      persist();
      return { data: updated.map(clone), error: null, count: null, status: 200 };
    }

    function runUpsert() {
      var input = Array.isArray(state.payload) ? state.payload : [state.payload];
      var keys = String(state.onConflict || 'id')
        .split(',')
        .map(function (key) {
          return key.trim();
        });
      var result = input.map(function (item) {
        var row = clone(item);
        var existing = table(state.table).find(function (candidate) {
          return keys.every(function (key) {
            return candidate[key] === row[key];
          });
        });
        if (existing) {
          var previous = clone(existing);
          Object.assign(existing, row);
          afterUpdate(state.table, previous, existing);
          return existing;
        }
        table(state.table).push(row);
        afterInsert(state.table, row);
        return row;
      });
      persist();
      return { data: result.map(clone), error: null, count: null, status: 200 };
    }

    function runDelete() {
      var rows = table(state.table);
      var removed = [];
      for (var i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(rows[i], state.filters)) {
          removed.push(rows[i]);
          rows.splice(i, 1);
        }
      }
      persist();
      return { data: removed.map(clone), error: null, count: null, status: 200 };
    }

    function run() {
      if (state.op === 'insert') return runInsert();
      if (state.op === 'update') return runUpdate();
      if (state.op === 'upsert') return runUpsert();
      if (state.op === 'delete') return runDelete();
      return runSelect();
    }

    api.then = function (resolve, reject) {
      return Promise.resolve()
        .then(run)
        .then(resolve, reject);
    };

    return api;
  }

  // ---- RPC ---------------------------------------------------------------
  function rpc(name, args) {
    if (Object.prototype.hasOwnProperty.call(store.rpc, name)) {
      var custom = store.rpc[name];
      return Promise.resolve(clone(custom));
    }
    var data = null;
    if (name === 'nombres_autores') {
      data = ((args && args.p_ids) || []).map(function (id) {
        var profile = profileOf(id);
        return { id: id, username: profile ? profile.username : 'Vecino/a' };
      });
    } else if (name === 'foto_repetida') {
      data = false;
    } else if (name === 'city_totals') {
      data = [
        { reportes: 0, tips: 0, quizzes: 0, revisiones: 0, miembros: 1 },
      ];
    } else if (name === 'region_totals') {
      data = [
        {
          reportes: 0,
          tips: 0,
          quizzes: 0,
          revisiones: 0,
          miembros: 1,
          municipios: 1,
        },
      ];
    } else if (name === 'municipality_ranking') {
      data = [];
    } else if (name === 'ranking_vecinos') {
      data = [];
    } else if (name === 'cobrar_bonus_repaso') {
      data = { ok: false };
    } else if (name === 'admin_pendientes_moderacion') {
      data = 0;
    }
    return Promise.resolve({ data: data, error: null, status: 200 });
  }

  // ---- Storage -----------------------------------------------------------
  function storageFrom(bucket) {
    var prefix = bucket + '/';
    return {
      upload: function (path) {
        store.storage[prefix + path] = true;
        persist();
        return Promise.resolve({
          data: { path: path, fullPath: prefix + path },
          error: null,
        });
      },
      remove: function (paths) {
        (paths || []).forEach(function (path) {
          delete store.storage[prefix + path];
        });
        persist();
        return Promise.resolve({ data: [], error: null });
      },
      createSignedUrls: function (paths) {
        return Promise.resolve({
          data: (paths || []).map(function (path) {
            return { path: path, signedUrl: PIXEL, error: null };
          }),
          error: null,
        });
      },
      getPublicUrl: function (path) {
        return {
          data: {
            publicUrl:
              SUPABASE_URL + '/storage/v1/object/public/' + bucket + '/' + path,
          },
        };
      },
    };
  }

  // ---- Auth --------------------------------------------------------------
  var auth = {
    getSession: function () {
      return Promise.resolve({ data: { session: currentSession() }, error: null });
    },
    getUser: function () {
      return Promise.resolve({
        data: { user: publicUser(currentUser()) },
        error: null,
      });
    },
    onAuthStateChange: function (callback) {
      authListeners.push(callback);
      return {
        data: {
          subscription: {
            unsubscribe: function () {
              var index = authListeners.indexOf(callback);
              if (index >= 0) authListeners.splice(index, 1);
            },
          },
        },
      };
    },
    signInWithPassword: function (credentials) {
      var email = String((credentials && credentials.email) || '').toLowerCase();
      var password = (credentials && credentials.password) || '';
      var user = store.users.find(function (candidate) {
        return String(candidate.email).toLowerCase() === email;
      });
      if (!user || user.password !== password) {
        return Promise.resolve(
          fail('Invalid login credentials', 'invalid_credentials', 400)
        );
      }
      store.sessionUserId = user.id;
      persist();
      emitAuth('SIGNED_IN');
      return Promise.resolve({
        data: { user: publicUser(user), session: currentSession() },
        error: null,
      });
    },
    signUp: function (credentials) {
      var email = String((credentials && credentials.email) || '').toLowerCase();
      var password = (credentials && credentials.password) || '';
      var exists = store.users.some(function (candidate) {
        return String(candidate.email).toLowerCase() === email;
      });
      if (exists) {
        return Promise.resolve(
          fail('User already registered', 'user_already_exists', 422)
        );
      }
      var user = { id: nextId(), email: email, password: password };
      store.users.push(user);
      if (!store.confirmEmail) {
        store.sessionUserId = user.id;
        emitAuth('SIGNED_IN');
      }
      persist();
      return Promise.resolve({
        data: {
          user: publicUser(user),
          session: store.confirmEmail ? null : currentSession(),
        },
        error: null,
      });
    },
    signOut: function () {
      store.sessionUserId = null;
      persist();
      emitAuth('SIGNED_OUT');
      return Promise.resolve({ error: null });
    },
    resetPasswordForEmail: function (email) {
      return Promise.resolve({ data: {}, error: null });
    },
    updateUser: function (patch) {
      var user = currentUser();
      if (!user) return Promise.resolve(fail('Not authenticated', 'no_session', 401));
      if (patch && patch.password) user.password = patch.password;
      if (patch && patch.email) user.email = String(patch.email).toLowerCase();
      persist();
      return Promise.resolve({ data: { user: publicUser(user) }, error: null });
    },
  };

  window.supabase = {
    createClient: function () {
      return {
        auth: auth,
        from: from,
        rpc: rpc,
        storage: { from: storageFrom },
      };
    },
  };

  // Útil para depurar una prueba desde la consola del runner.
  window.__PATRULLA_FAKE__ = {
    snapshot: function () {
      return clone(store);
    },
    url: SUPABASE_URL,
    storeKey: STORE_KEY,
  };
})();
