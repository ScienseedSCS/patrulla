import { describe, expect, test } from 'bun:test';
import { bootApp, makeSeed } from '../harness/app.js';
import { useApp } from '../harness/use-app.js';

const slot = useApp();

describe('revisar', () => {
  test('un revisor autorizado ve el reporte y puede validarlo', async () => {
    slot.app = await bootApp({
      seed: makeSeed({ profile: { is_reviewer: true } }),
    });
    const app = slot.app;

    await app.waitFor(() => app.q('.review-item'));
    app.click('.navbtn[data-sec="revisar"]');
    await app.waitFor(() => app.q('.review-open'));

    app.click('.review-open');
    await app.waitForClass('reviewModal', 'show');

    expect(app.text('#modalAuthor')).toBe('Beto');
    expect(app.text('#modalNote')).toContain('Junté las tapitas del patio');

    app.click('.vote-btn[data-vote="correcto"]');

    await app.waitFor(() => app.text('#toast').includes('Validado'));
    expect(app.hasClass('reviewModal', 'show')).toBe(false);
    expect(app.text('#statReviews')).toBe('1');
    await app.waitFor(() =>
      app.text('#reviewList').includes('No hay reportes pendientes')
    );

    const state = app.fakeState();
    expect(state.tables.report_reviews.length).toBe(1);
    expect(state.tables.report_reviews[0]).toMatchObject({
      report_id: 'rep-1',
      reviewer_id: 'user-1',
      vote: 'correcto',
    });
  });

  test('sin permiso de revisor la pestaña queda oculta y muestra el aviso', async () => {
    slot.app = await bootApp();
    const app = slot.app;

    const nav = app.q('.navbtn[data-sec="revisar"]');
    expect(nav.classList.contains('hide')).toBe(true);

    app.click(nav);
    await app.waitFor(() => app.q('.lock-card'));

    expect(app.text('.lock-card')).toContain('Revisión a cargo del equipo');
    expect(app.$$('.review-item').length).toBe(0);
  });
});
