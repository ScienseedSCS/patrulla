import { describe, expect, test } from 'bun:test';
import { bootApp } from '../harness/app.js';
import { useApp } from '../harness/use-app.js';

const slot = useApp();

describe('aprender', () => {
  test('los tips se listan y se despliegan al tocarlos', async () => {
    slot.app = await bootApp();
    const app = slot.app;

    app.click('.navbtn[data-sec="aprender"]');
    app.click('.learn-card[data-learn="resources"]');

    await app.waitFor(() => app.q('.tip-item'));

    const tip = app.q('.tip-item');
    expect(tip.textContent).toContain('Eliminá el agua quieta');
    expect(tip.classList.contains('open')).toBe(false);

    tip.click();

    expect(tip.classList.contains('open')).toBe(true);
    expect(tip.getAttribute('aria-expanded')).toBe('true');
  });

  test('un quiz correcto suma los puntos de la pregunta y el bonus', async () => {
    slot.app = await bootApp();
    const app = slot.app;

    app.click('.navbtn[data-sec="aprender"]');
    app.click('.learn-card[data-learn="tests"]');

    await app.waitFor(() => app.q('.test-card'));
    app.click('.test-card');

    await app.waitFor(() => app.q('.tq-opt'));
    expect(app.text('.tq-prompt')).toContain('¿Dónde pone los huevos');

    app.q('.tq-opt').click();

    await app.waitFor(() => app.text('#tqFeedback').includes('¡Correcto!'));
    expect(app.text('#tqFeedback')).toContain('+2 pts');

    app.click('#tqNextBtn');

    await app.waitFor(() => app.q('.tq-summary'));
    expect(app.text('.tq-summary')).toContain('1 / 1');
    expect(app.text('.tq-summary')).toContain('+17 pts');
    await app.waitFor(() => app.text('#pts') === '417');

    const state = app.fakeState();
    expect(
      state.tables.learn_question_correct.some((row) => row.question_id === 'q-1')
    ).toBe(true);
    expect(
      state.tables.learn_test_progress.some(
        (row) => row.block === 'mosquito' && row.completed && row.bonus_awarded
      )
    ).toBe(true);
  });

  test('detectar criaderos acredita el desafío al tocar el foco', async () => {
    slot.app = await bootApp();
    const app = slot.app;

    app.click('.navbtn[data-sec="aprender"]');
    app.click('.learn-card[data-learn="spot"]');

    await app.waitFor(() => app.q('.spot-card'));
    app.click('.spot-card');

    await app.waitFor(() => app.$('spotImg'));
    app.mockRect('#spotImg', { width: 100, height: 100 });
    app.clickAt('#spotImg', 50, 50);

    await app.waitFor(() =>
      app.text('#spotResult').includes('¡Encontraste todos los criaderos!')
    );
    await app.waitFor(() => app.text('#pts') === '410');

    expect(app.text('#spotFound')).toBe('1');
    expect(
      app.fakeState().tables.spot_answers.some((row) => row.challenge_id === 'spot-1')
    ).toBe(true);
  });
});
