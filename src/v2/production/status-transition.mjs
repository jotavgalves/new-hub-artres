export const STATUS_TRANSITION_SCHEMA_VERSION = 1;

export function createStatusPolicy(input = {}) {
  const statuses = unique((input.statuses || []).map(clean).filter(Boolean));
  if (!statuses.length) throw statusError('STATUS_POLICY_EMPTY');

  const transitions = {};
  for (const status of statuses) transitions[status] = [];

  for (const [from, targets] of Object.entries(input.transitions || {})) {
    const normalizedFrom = findStatus(statuses, from);
    if (!normalizedFrom) throw statusError('STATUS_POLICY_FROM_INVALID', from);

    transitions[normalizedFrom] = unique((Array.isArray(targets) ? targets : [targets]).map(target => {
      const normalizedTarget = findStatus(statuses, target);
      if (!normalizedTarget) throw statusError('STATUS_POLICY_TARGET_INVALID', `${from}:${target}`);
      return normalizedTarget;
    }));
  }

  return deepFreeze({
    schemaVersion: STATUS_TRANSITION_SCHEMA_VERSION,
    mode: input.mode === 'active' ? 'active' : 'passive-unconfirmed',
    statuses,
    transitions,
    allowSameStatus: input.allowSameStatus !== false,
    loadedByProduction: false
  });
}

export function applyStatusTransition(order = {}, input = {}, policy) {
  validatePolicyOrThrow(policy);

  const currentStatus = findStatus(policy.statuses, order.status || policy.statuses[0]);
  const targetStatus = findStatus(policy.statuses, input.to || input.status);
  const eventId = normalizeEventId(input.eventId);
  const actor = clean(input.actor || input.actorName);
  const at = validIsoDate(input.at) || new Date().toISOString();

  if (!currentStatus) throw statusError('CURRENT_STATUS_INVALID', order.status);
  if (!targetStatus) throw statusError('TARGET_STATUS_INVALID', input.to || input.status);
  if (!eventId) throw statusError('STATUS_EVENT_ID_REQUIRED');
  if (!actor) throw statusError('STATUS_ACTOR_REQUIRED');

  const events = normalizeEvents(order.events);
  const existingEvent = events.find(event => event.eventId === eventId);

  if (existingEvent) {
    if (
      existingEvent.from === currentStatus &&
      existingEvent.to === targetStatus &&
      existingEvent.actor === actor
    ) {
      return deepFreeze({
        action: 'REPLAY_EVENT',
        changed: false,
        replayed: true,
        order: deepFreeze({ ...order, events })
      });
    }
    throw statusError('STATUS_EVENT_ID_CONFLICT', eventId);
  }

  if (currentStatus === targetStatus) {
    if (!policy.allowSameStatus) throw statusError('SAME_STATUS_NOT_ALLOWED', currentStatus);

    const event = createEvent({
      eventId,
      at,
      actor,
      from: currentStatus,
      to: targetStatus,
      message: input.message,
      type: 'production-status-noop'
    });

    return deepFreeze({
      action: 'NOOP_SAME_STATUS',
      changed: false,
      replayed: false,
      event,
      order: deepFreeze({
        ...order,
        status: currentStatus,
        updatedAt: at,
        events: [...events, event].slice(-100)
      })
    });
  }

  if (policy.mode !== 'active') {
    throw statusError('STATUS_POLICY_NOT_ACTIVE');
  }

  const allowedTargets = policy.transitions[currentStatus] || [];
  if (!allowedTargets.includes(targetStatus)) {
    throw statusError('STATUS_TRANSITION_NOT_ALLOWED', `${currentStatus}:${targetStatus}`);
  }

  const event = createEvent({
    eventId,
    at,
    actor,
    from: currentStatus,
    to: targetStatus,
    message: input.message,
    type: 'production-status'
  });

  return deepFreeze({
    action: 'STATUS_CHANGED',
    changed: true,
    replayed: false,
    event,
    order: deepFreeze({
      ...order,
      status: targetStatus,
      updatedAt: at,
      production: deepFreeze({
        ...(order.production || {}),
        lastAppUpdateAt: at,
        lastAppActor: actor,
        lastAppStatus: targetStatus,
        lastEventId: eventId
      }),
      events: [...events, event].slice(-100)
    })
  });
}

export function validateStatusPolicy(policy) {
  const errors = [];

  if (!policy || policy.schemaVersion !== STATUS_TRANSITION_SCHEMA_VERSION) errors.push('STATUS_POLICY_SCHEMA_INVALID');
  if (!['active', 'passive-unconfirmed'].includes(policy?.mode)) errors.push('STATUS_POLICY_MODE_INVALID');
  if (!Array.isArray(policy?.statuses) || !policy.statuses.length) errors.push('STATUS_POLICY_EMPTY');
  if (policy?.loadedByProduction !== false) errors.push('STATUS_POLICY_MUST_BE_PASSIVE');

  for (const status of policy?.statuses || []) {
    if (!Array.isArray(policy.transitions?.[status])) errors.push(`STATUS_TRANSITIONS_MISSING:${status}`);
    for (const target of policy.transitions?.[status] || []) {
      if (!policy.statuses.includes(target)) errors.push(`STATUS_TRANSITION_TARGET_UNKNOWN:${status}:${target}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors: unique(errors)
  };
}

export function validateStatusEvent(event, policy) {
  const errors = [];
  const statuses = policy?.statuses || [];

  if (!normalizeEventId(event?.eventId)) errors.push('STATUS_EVENT_ID_REQUIRED');
  if (!validIsoDate(event?.at)) errors.push('STATUS_EVENT_AT_INVALID');
  if (!clean(event?.actor)) errors.push('STATUS_EVENT_ACTOR_REQUIRED');
  if (!findStatus(statuses, event?.from)) errors.push('STATUS_EVENT_FROM_INVALID');
  if (!findStatus(statuses, event?.to)) errors.push('STATUS_EVENT_TO_INVALID');

  return {
    ok: errors.length === 0,
    errors: unique(errors)
  };
}

function createEvent(input) {
  return deepFreeze({
    schemaVersion: STATUS_TRANSITION_SCHEMA_VERSION,
    eventId: input.eventId,
    at: input.at,
    actor: input.actor,
    type: input.type,
    from: input.from,
    to: input.to,
    message: clean(input.message).slice(0, 300)
  });
}

function normalizeEvents(events) {
  return (Array.isArray(events) ? events : [])
    .filter(event => event && typeof event === 'object')
    .map(event => deepFreeze({
      schemaVersion: Number(event.schemaVersion) || STATUS_TRANSITION_SCHEMA_VERSION,
      eventId: normalizeEventId(event.eventId || event.id),
      at: validIsoDate(event.at) || '',
      actor: clean(event.actor || event.by),
      type: clean(event.type || 'production-status'),
      from: clean(event.from),
      to: clean(event.to || event.status),
      message: clean(event.message).slice(0, 300)
    }))
    .filter(event => event.eventId)
    .slice(-100);
}

function validatePolicyOrThrow(policy) {
  const validation = validateStatusPolicy(policy);
  if (!validation.ok) {
    const error = statusError('STATUS_POLICY_INVALID');
    error.details = validation.errors;
    throw error;
  }
}

function findStatus(statuses, value) {
  const wanted = normalize(value);
  return (statuses || []).find(status => normalize(status) === wanted) || '';
}

function normalize(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeEventId(value) {
  const id = clean(value);
  if (!id || id.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(id)) return '';
  return id;
}

function validIsoDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function statusError(code, detail = '') {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
