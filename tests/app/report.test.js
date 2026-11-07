import { describe, expect, test } from 'bun:test';
import { bootApp } from '../harness/app.js';
import { useApp } from '../harness/use-app.js';

const slot = useApp();

async function openFirstAction(app) {
  app.click('#actionsGrid .action-card');
  await app.waitFor(() => app.$('fN1'));
  app.click('#fN1');
  await app.waitFor(() => app.$('modeSimple'));
}

async function waitForPoints(app, expected) {
  await app.waitFor(() => app.text('#pts') === String(expected));
}

describe('reportar', () => {
  test('un reporte simple sube puntos y queda en Mis reportes', async () => {
    slot.app = await bootApp();
    const app = slot.app;

    await openFirstAction(app);
    app.upload('#photoInput_after');

    await app.waitFor(() => !app.$('fN2').disabled);
    app.click('#fN2');
    await app.waitFor(() => app.$('reportNote'));

    app.setValue('#reportNote', 'Lavé los baldes del patio');
    app.click('#fSubmit');

    await app.waitForClass('celebrateModal', 'show');
    expect(app.text('#celebratePts')).toBe('+10 pts');
    await waitForPoints(app, 410);

    app.click('#celebrateBtn');
    expect(app.hasClass('celebrateModal', 'show')).toBe(false);

    const report = app
      .fakeState()
      .tables.reports.find((candidate) => candidate.user_id === 'user-1');
    expect(report).toBeTruthy();
    expect(report.note).toBe('Lavé los baldes del patio');
    expect(report.status).toBe('pendiente');
    expect(report.points_awarded).toBe(10);
    expect(report.photo_url).toContain('/storage/v1/object/');

    app.click('.navbtn[data-sec="progreso"]');
    app.click('#cardSent');
    await app.waitFor(() => app.text('#myReportsList').includes('Lavé los baldes'));

    expect(app.text('#myReportsList')).toContain('Lavé los baldes del patio');
  });

  test('el modo antes/después sube las dos fotos y paga el bonus', async () => {
    slot.app = await bootApp();
    const app = slot.app;

    await openFirstAction(app);
    app.click('#modeBA');
    await app.waitFor(() => app.$('photoInput_before'));

    app.upload('#photoInput_before');
    app.upload('#photoInput_after');

    await app.waitFor(() => !app.$('fN2').disabled);
    app.click('#fN2');
    await app.waitFor(() => app.$('reportNote'));
    app.click('#fSubmit');

    await waitForPoints(app, 415);

    const report = app
      .fakeState()
      .tables.reports.find((candidate) => candidate.user_id === 'user-1');
    expect(report).toBeTruthy();
    expect(report.points_awarded).toBe(15);
    expect(report.photo_before_url).toContain('/storage/v1/object/');
    expect(report.photo_url).toContain('/storage/v1/object/');
  });
});
