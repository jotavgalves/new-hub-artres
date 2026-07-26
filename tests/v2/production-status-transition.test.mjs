import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStatusTransition,
  createStatusPolicy,
  validateStatusEvent,
  validateStatusPolicy
} from '../../src/v2/production/status-transition.mjs';

const statuses = ['Novo', 'Em atendimento', 'Em produção', 'Separado', 'Fechado', 'Cancelado'];

function activePolicy() {
  return createStatusPolicy({
    mode: 'active',
    statuses,
    transitions: {
      Novo: ['Em atendimento', 'Em produção', 'Cancelado'],
      'Em atendimento': ['Em produção', 'Cancelado'],
      'Em produção': ['Separado', 'Cancelado'],
      Separado: ['Fechado', 'Em produção'],
      Fechado: [],
      Cancelado: []
    }
  });
}

const order = {
  id: 'PED2600001A',
  status: 'Novo',
  createdAt: '2026-07-26T18:00:00.000Z',
  events: []
};

test('política nasce passiva quando o modo não é confirmado', () => {
  const policy = createStatusPolicy({ statuses });

  assert.equal(policy.mode, 'passive-unconfirmed');
  assert.equal(policy.loadedByProduction, false);
  assert.deepEqual(validateStatusPolicy(policy), { ok: true, errors: [] });
  assert.equal(Object.isFrozen(policy), true);
});

test('política passiva bloqueia mudança real de status', () => {
  const policy = createStatusPolicy({ statuses });

  assert.throws(
    () => applyStatusTransition(order, {
      eventId: 'evt-1',
      to: 'Em produção',
      actor: 'Armazem',
      at: '2026-07-26T18:10:00.000Z'
    }, policy),
    error => error && error.code === 'STATUS_POLICY_NOT_ACTIVE'
  );
});

test('política ativa aplica somente transição explicitamente permitida', () => {
  const result = applyStatusTransition(order, {
    eventId: 'evt-1',
    to: 'Em produção',
    actor: 'Armazem',
    message: 'Pedido enviado para produção.',
    at: '2026-07-26T18:10:00.000Z'
  }, activePolicy());

  assert.equal(result.action, 'STATUS_CHANGED');
  assert.equal(result.changed, true);
  assert.equal(result.order.status, 'Em produção');
  assert.equal(result.order.production.lastEventId, 'evt-1');
  assert.deepEqual(validateStatusEvent(result.event, activePolicy()), { ok: true, errors: [] });
});

test('repetição do mesmo eventId retorna replay e não cria novo evento', () => {
  const first = applyStatusTransition(order, {
    eventId: 'evt-1',
    to: 'Em produção',
    actor: 'Armazem',
    at: '2026-07-26T18:10:00.000Z'
  }, activePolicy());

  const replay = applyStatusTransition(first.order, {
    eventId: 'evt-1',
    to: 'Em produção',
    actor: 'Armazem',
    at: '2026-07-26T18:11:00.000Z'
  }, activePolicy());

  assert.equal(replay.action, 'REPLAY_EVENT');
  assert.equal(replay.replayed, true);
  assert.equal(replay.changed, false);
  assert.equal(replay.order.events.length, 1);
});

test('mesmo eventId com destino diferente é conflito', () => {
  const first = applyStatusTransition(order, {
    eventId: 'evt-1',
    to: 'Em produção',
    actor: 'Armazem',
    at: '2026-07-26T18:10:00.000Z'
  }, activePolicy());

  assert.throws(
    () => applyStatusTransition(first.order, {
      eventId: 'evt-1',
      to: 'Separado',
      actor: 'Armazem',
      at: '2026-07-26T18:11:00.000Z'
    }, activePolicy()),
    error => error && error.code === 'STATUS_EVENT_ID_CONFLICT'
  );
});

test('mesmo status gera evento no-op idempotente', () => {
  const result = applyStatusTransition(order, {
    eventId: 'evt-noop',
    to: 'Novo',
    actor: 'Armazem',
    at: '2026-07-26T18:05:00.000Z'
  }, activePolicy());

  assert.equal(result.action, 'NOOP_SAME_STATUS');
  assert.equal(result.changed, false);
  assert.equal(result.order.status, 'Novo');
  assert.equal(result.event.type, 'production-status-noop');
});

test('transição não declarada é rejeitada', () => {
  assert.throws(
    () => applyStatusTransition(order, {
      eventId: 'evt-2',
      to: 'Fechado',
      actor: 'Armazem',
      at: '2026-07-26T18:10:00.000Z'
    }, activePolicy()),
    error => error && error.code === 'STATUS_TRANSITION_NOT_ALLOWED'
  );
});

test('status é resolvido sem diferença de acento ou caixa', () => {
  const result = applyStatusTransition(order, {
    eventId: 'evt-3',
    to: 'em producao',
    actor: 'Armazem',
    at: '2026-07-26T18:10:00.000Z'
  }, activePolicy());

  assert.equal(result.order.status, 'Em produção');
});

test('evento exige identificador e ator', () => {
  assert.throws(
    () => applyStatusTransition(order, {
      to: 'Em produção',
      actor: 'Armazem'
    }, activePolicy()),
    error => error && error.code === 'STATUS_EVENT_ID_REQUIRED'
  );

  assert.throws(
    () => applyStatusTransition(order, {
      eventId: 'evt-4',
      to: 'Em produção'
    }, activePolicy()),
    error => error && error.code === 'STATUS_ACTOR_REQUIRED'
  );
});

test('histórico é limitado aos cem eventos mais recentes', () => {
  const oldEvents = Array.from({ length: 100 }, (_, index) => ({
    eventId: `old-${index}`,
    at: '2026-07-26T17:00:00.000Z',
    actor: 'Armazem',
    from: 'Novo',
    to: 'Novo',
    type: 'production-status-noop'
  }));

  const result = applyStatusTransition({ ...order, events: oldEvents }, {
    eventId: 'evt-new',
    to: 'Em produção',
    actor: 'Armazem',
    at: '2026-07-26T18:10:00.000Z'
  }, activePolicy());

  assert.equal(result.order.events.length, 100);
  assert.equal(result.order.events.at(-1).eventId, 'evt-new');
  assert.equal(result.order.events.some(event => event.eventId === 'old-0'), false);
});
