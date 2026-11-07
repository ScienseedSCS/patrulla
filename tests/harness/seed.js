/**
 * Datos de partida para los tests de la app.
 *
 * Todo es JSON serializable: el harness lo inyecta en el HTML y el
 * Supabase falso lo usa como estado inicial. Cada test pide su propio
 * seed (con `makeSeed`) para no compartir estado.
 */

export const TEST_SUPABASE_URL = 'https://test.supabase.co';

function isoDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function isoNow() {
  return new Date().toISOString();
}

const BASE_PROFILE = {
  id: 'user-1',
  username: 'Ana',
  city: 'Gobernador Virasoro',
  sector: null,
  points: 400,
  level: 4,
  is_reviewer: false,
  is_admin: false,
  onboarded: true,
  push_prompted: true,
  geo_consent: false,
  en_ranking: true,
  tour_stations: null,
  bloqueado: false,
  bloqueado_motivo: null,
  push_prefs: null,
  created_at: '2026-01-10T10:00:00.000Z',
};

export function makeSeed(options = {}) {
  const profile = { ...BASE_PROFILE, ...(options.profile || {}) };
  const session = options.session === false ? null : profile.id;

  const tables = {
    profiles: [
      profile,
      {
        id: 'user-2',
        username: 'Beto',
        city: 'Gobernador Virasoro',
        sector: null,
        points: 10,
        level: 1,
        is_reviewer: false,
        is_admin: false,
        onboarded: true,
        push_prompted: true,
        geo_consent: false,
        en_ranking: true,
        bloqueado: false,
      },
    ],
    cities: [
      {
        id: 'city-1',
        name: 'Gobernador Virasoro',
        province: 'Corrientes',
        active: true,
        codigo: 'GV',
      },
    ],
    action_types: [
      {
        id: 'tapitas',
        title: 'Tapitas y latas',
        icon: '🥤',
        points: 10,
        location: 'exterior',
        sort_order: 1,
        description: 'Juntá y descartá tapitas, latas y botellas que junten agua.',
      },
      {
        id: 'floreros',
        title: 'Floreros y macetas',
        icon: '🪴',
        points: 5,
        location: 'interior',
        sort_order: 2,
        description: 'Cambiá el agua de los floreros y vaciá los platos de las macetas.',
      },
      {
        id: 'house_tour',
        title: 'Recorrido por tu casa',
        icon: '🏠',
        points: 0,
        location: 'ambos',
        sort_order: 99,
        description: 'Revisá los focos de tu casa lugar por lugar.',
      },
    ],
    tips: [
      {
        id: 'tip-1',
        category: 'Patio',
        title: 'Eliminá el agua quieta',
        content:
          'Revisá los recipientes del patio.\n- Tapitas y latas\n- Baldes y palanganas',
        sort_order: 1,
      },
    ],
    learn_questions: [
      {
        id: 'q-1',
        block: 'mosquito',
        type: 'mcq',
        active: true,
        sort_order: 1,
        prompt: '¿Dónde pone los huevos el mosquito del dengue?',
        payload: {
          options: ['En agua quieta', 'En el pasto seco', 'En la arena'],
          correct: 0,
        },
        explanation: 'El mosquito necesita agua quieta para reproducirse.',
      },
    ],
    learn_test_progress: [],
    learn_question_correct: [],
    spot_challenges: [
      {
        id: 'spot-1',
        title: 'Encontrá el criadero',
        image_url: 'caso1.jpg',
        hotspots: [{ x: 0.5, y: 0.5, r: 0.1, label: 'Balde con agua' }],
        points: 10,
        active: true,
        sort_order: 1,
      },
    ],
    spot_answers: [],
    reports: [
      {
        id: 'rep-1',
        user_id: 'user-2',
        action_type: 'tapitas',
        city: 'Gobernador Virasoro',
        note: 'Junté las tapitas del patio',
        photo_url:
          TEST_SUPABASE_URL +
          '/storage/v1/object/public/reports/user-2/reporte.jpg',
        photo_before_url: null,
        tour_photos: null,
        status: 'pendiente',
        review_count: 0,
        points_awarded: 10,
        reject_reasons: null,
        photo_hash: null,
        lat: null,
        lng: null,
        captured_at: '2026-11-01T10:00:00.000Z',
        created_at: '2026-11-01T10:05:00.000Z',
      },
    ],
    report_reviews: [],
    report_flags: [],
    push_subscriptions: [],
    ovi_indices: [
      {
        id: 'ovi-1',
        localidad: 'GV',
        sector: '',
        temporada: '2026',
        semana: 'SE45',
        desde: isoDaysAgo(6),
        hasta: isoDaysAgo(1),
        edi: 12,
        opi: 20,
        nivel: 'alto',
        es_prueba: false,
        generado_at: isoNow(),
        actualizado_at: isoNow(),
      },
    ],
    ovi_sectores: [],
    ovi_calles: [],
    ...(options.tables || {}),
  };

  return {
    seedId: options.seedId || `seed-${crypto.randomUUID()}`,
    tables,
    users: options.users || [
      {
        id: 'user-1',
        email: 'ana@example.com',
        password: 'secreta123',
      },
      {
        id: 'user-2',
        email: 'beto@example.com',
        password: 'secreta123',
      },
    ],
    sessionUserId: session,
    rpc: options.rpc || {},
    confirmEmail: !!options.confirmEmail,
  };
}
