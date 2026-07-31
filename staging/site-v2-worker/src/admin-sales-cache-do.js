import { DurableObject } from 'cloudflare:workers';

import { orderLedgerShardName } from '../../../src/v2/orders/order-number.mjs';
import {
  MAX_ADMIN_SALES_ORDERS,
  buildAdminSalesSnapshot,
  normalizeAdminSalesMeta,
  sliceAdminSalesSnapshot
} from './admin-sales-cache-model.js';

const CACHE_OBJECT_NAME = 'sales-dashboard-current';
const META_KEY = 'admin-sales-meta-v1';
const SNAPSHOT_KEY = 'admin-sales-snapshot-v1';
const RECONCILE_AFTER_MS = 30_000;
const HEARTBEAT_MS = 20_000;

export class AdminSalesCache extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.connections = new Set();
    this.heartbeatTimer = null;
  }

  async getSnapshot(limit = 50) {
    const cached = await this.ctx.storage.get(SNAPSHOT_KEY);
    const meta = normalizeAdminSalesMeta(await this.ctx.storage.get(META_KEY));

    if (isUsableSnapshot(cached, meta)) {
      const age = Date.now() - new Date(cached.verifiedAt || cached.generatedAt || 0).getTime();
      if (Number.isFinite(age) && age >= 0 && age < RECONCILE_AFTER_MS) {
        return sliceAdminSalesSnapshot(cached, limit, 'hit');
      }

      const health = await this.#ledgerHealth();
      if (Number(health.orderCount || 0) === Number(cached.ledgerHealth?.orderCount || 0)) {
        const revalidated = {
          ...cached,
          verifiedAt: new Date().toISOString(),
          ledgerHealth: {
            orderCount: Number(health.orderCount || 0),
            pendingOutbox: Number(health.pendingOutbox || 0)
          }
        };
        await this.ctx.storage.put(SNAPSHOT_KEY, revalidated);
        return sliceAdminSalesSnapshot(revalidated, limit, 'revalidated');
      }

      const nextMeta = {
        revision: Math.max(meta.revision + 1, Number(health.orderCount || 0)),
        updatedAt: new Date().toISOString(),
        orderNumber: meta.orderNumber
      };
      await this.ctx.storage.put(META_KEY, nextMeta);
      const rebuilt = await this.#rebuild(nextMeta, health);
      return sliceAdminSalesSnapshot(rebuilt, limit, 'rebuilt');
    }

    const rebuilt = await this.#rebuild(meta);
    return sliceAdminSalesSnapshot(rebuilt, limit, 'rebuilt');
  }

  async orderCommitted(event = {}) {
    if (String(event.action || 'CREATED').toUpperCase() !== 'CREATED') {
      return { updated: false, reason: 'replay' };
    }

    const current = normalizeAdminSalesMeta(await this.ctx.storage.get(META_KEY));
    const updatedAt = validIsoDate(event.updatedAt || event.createdAt) || new Date().toISOString();
    const next = {
      revision: current.revision + 1,
      updatedAt,
      orderNumber: safeOrderNumber(event.orderNumber)
    };

    await this.ctx.storage.put(META_KEY, next);
    await this.ctx.storage.delete(SNAPSHOT_KEY);
    this.#broadcast('revision', next);
    return { updated: true, ...next };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/events') {
      return new Response('Not found', { status: 404 });
    }

    const encoder = new TextEncoder();
    const connections = this.connections;
    const owner = this;
    let controllerRef;

    const stream = new ReadableStream({
      async start(controller) {
        controllerRef = controller;
        connections.add(controller);
        const meta = normalizeAdminSalesMeta(await owner.ctx.storage.get(META_KEY));
        controller.enqueue(encoder.encode(sseEvent('ready', {
          revision: meta.revision,
          updatedAt: meta.updatedAt
        })));
        owner.#ensureHeartbeat();
      },
      cancel() {
        if (controllerRef) connections.delete(controllerRef);
        owner.#stopHeartbeatIfIdle();
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'Connection': 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no'
      }
    });
  }

  async #rebuild(meta, knownHealth = null) {
    const year = new Date().getUTCFullYear();
    const stub = this.#ledgerStub(`${year}-01-01T00:00:00.000Z`);
    const [orders, health] = await Promise.all([
      stub.listRecentOrders(MAX_ADMIN_SALES_ORDERS),
      knownHealth ? Promise.resolve(knownHealth) : stub.health()
    ]);
    const generatedAt = new Date().toISOString();
    const normalizedMeta = normalizeAdminSalesMeta(meta);
    const effectiveMeta = normalizedMeta.revision > 0
      ? normalizedMeta
      : {
          revision: Number(health.orderCount || 0),
          updatedAt: orders[0]?.updatedAt || orders[0]?.createdAt || generatedAt,
          orderNumber: orders[0]?.orderNumber || ''
        };

    if (
      effectiveMeta.revision !== normalizedMeta.revision ||
      effectiveMeta.updatedAt !== normalizedMeta.updatedAt ||
      effectiveMeta.orderNumber !== normalizedMeta.orderNumber
    ) {
      await this.ctx.storage.put(META_KEY, effectiveMeta);
    }

    const snapshot = buildAdminSalesSnapshot({
      orders,
      ledgerHealth: health,
      meta: effectiveMeta,
      generatedAt,
      verifiedAt: generatedAt,
      year
    });
    await this.ctx.storage.put(SNAPSHOT_KEY, snapshot);
    return snapshot;
  }

  async #ledgerHealth() {
    const year = new Date().getUTCFullYear();
    return this.#ledgerStub(`${year}-01-01T00:00:00.000Z`).health();
  }

  #ledgerStub(createdAt) {
    if (!this.env?.ORDER_LEDGER || typeof this.env.ORDER_LEDGER.getByName !== 'function') {
      throw cacheError('ORDER_LEDGER_NOT_CONFIGURED');
    }
    return this.env.ORDER_LEDGER.getByName(orderLedgerShardName(createdAt));
  }

  #broadcast(eventName, payload) {
    const bytes = new TextEncoder().encode(sseEvent(eventName, payload));
    for (const controller of [...this.connections]) {
      try {
        controller.enqueue(bytes);
      } catch (_) {
        this.connections.delete(controller);
      }
    }
    this.#stopHeartbeatIfIdle();
  }

  #ensureHeartbeat() {
    if (this.heartbeatTimer || this.connections.size === 0) return;
    this.heartbeatTimer = setInterval(() => {
      const bytes = new TextEncoder().encode(`: heartbeat ${Date.now()}\n\n`);
      for (const controller of [...this.connections]) {
        try {
          controller.enqueue(bytes);
        } catch (_) {
          this.connections.delete(controller);
        }
      }
      this.#stopHeartbeatIfIdle();
    }, HEARTBEAT_MS);
  }

  #stopHeartbeatIfIdle() {
    if (this.connections.size > 0 || !this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

export function adminSalesCacheStub(env = {}) {
  if (!env?.ADMIN_SALES_CACHE || typeof env.ADMIN_SALES_CACHE.getByName !== 'function') return null;
  return env.ADMIN_SALES_CACHE.getByName(CACHE_OBJECT_NAME);
}

export function adminSalesCacheStatus(env = {}) {
  return Object.freeze({
    enabled: Boolean(adminSalesCacheStub(env)),
    mode: 'versioned-snapshot-live-events',
    reconcileAfterMs: RECONCILE_AFTER_MS
  });
}

export function scheduleAdminSalesCacheRefresh({ ctx, env = {}, result = {}, logger = console } = {}) {
  if (String(result.action || '').toUpperCase() !== 'CREATED' || result.replayed === true) {
    return { scheduled: false, state: 'replay' };
  }

  const stub = adminSalesCacheStub(env);
  if (!stub) return { scheduled: false, state: 'not-configured' };

  const task = stub.orderCommitted({
    action: result.action,
    orderNumber: result.orderNumber || result.order?.orderNumber,
    createdAt: result.order?.createdAt,
    updatedAt: result.order?.updatedAt
  }).catch(error => {
    emitLog(logger, 'error', {
      event: 'admin-sales-cache-refresh-failed',
      code: publicCacheErrorCode(error),
      orderNumber: safeOrderNumber(result.orderNumber || result.order?.orderNumber)
    });
    return { updated: false, code: publicCacheErrorCode(error) };
  });

  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
  else void task;
  return { scheduled: true, state: 'scheduled' };
}

function isUsableSnapshot(snapshot, meta) {
  return Boolean(
    snapshot &&
    snapshot.schemaVersion === 1 &&
    Array.isArray(snapshot.orders) &&
    Number(snapshot.revision || 0) === Number(meta.revision || 0)
  );
}

function sseEvent(name, payload) {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function validIsoDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function safeOrderNumber(value) {
  const text = String(value || '').trim().toUpperCase();
  return /^PED\d{7}[A-Z]$/.test(text) ? text : '';
}

function emitLog(logger, method, payload) {
  const target = logger && typeof logger[method] === 'function' ? logger[method].bind(logger) : null;
  if (target) target(JSON.stringify(payload));
}

function publicCacheErrorCode(error) {
  const code = String(error?.code || error?.message || '').trim().toUpperCase();
  return /^ADMIN_SALES_CACHE_[A-Z0-9_]{1,80}$/.test(code) || code === 'ORDER_LEDGER_NOT_CONFIGURED'
    ? code
    : 'ADMIN_SALES_CACHE_REFRESH_FAILED';
}

function cacheError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
