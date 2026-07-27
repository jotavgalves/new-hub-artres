import { DurableObject } from 'cloudflare:workers';

import { formatOrderNumberV2, orderYearCode } from '../../../src/v2/orders/order-number.mjs';
import { validateLedgerSubmissionCommand } from '../../../src/v2/persistence/order-ledger-port.mjs';

const DATABASE_SCHEMA_VERSION = 1;
const MAX_OUTBOX_BATCH = 200;

export class OrderLedger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = this.ctx.storage.sql;

    this.ctx.blockConcurrencyWhile(async () => {
      this.#initializeSchema();
    });
  }

  async submit(input = {}) {
    const validation = validateLedgerSubmissionCommand(input);
    if (!validation.ok) {
      const error = ledgerError('LEDGER_COMMAND_INVALID');
      error.details = validation.errors;
      throw error;
    }

    const command = validation.command;
    return this.ctx.storage.transactionSync(() => this.#submitTransaction(command));
  }

  async getOrder(orderNumber) {
    const normalized = normalizeOrderNumber(orderNumber);
    if (!normalized) return null;

    const row = this.sql.exec(
      'SELECT payload_json FROM orders WHERE order_number = ? LIMIT 1',
      normalized
    ).toArray()[0];

    return row ? parseJson(row.payload_json, 'ORDER_PAYLOAD_INVALID') : null;
  }

  async listPendingOutbox(limit = 50) {
    const capped = Math.min(Math.max(positiveInteger(limit) || 50, 1), MAX_OUTBOX_BATCH);
    const rows = this.sql.exec(
      `SELECT id, event_type, aggregate_id, payload_json, status, created_at, delivered_at
         FROM outbox
        WHERE status = 'pending'
        ORDER BY id ASC
        LIMIT ?`,
      capped
    ).toArray();

    return rows.map(row => ({
      id: Number(row.id),
      eventType: row.event_type,
      aggregateId: row.aggregate_id,
      payload: parseJson(row.payload_json, 'OUTBOX_PAYLOAD_INVALID'),
      status: row.status,
      createdAt: row.created_at,
      deliveredAt: row.delivered_at || ''
    }));
  }

  async markOutboxDelivered(ids = [], deliveredAt = new Date().toISOString()) {
    const normalizedIds = [...new Set((Array.isArray(ids) ? ids : []).map(positiveInteger).filter(Boolean))]
      .slice(0, MAX_OUTBOX_BATCH);

    if (!normalizedIds.length) return { updated: 0 };
    const at = validIsoDate(deliveredAt) || new Date().toISOString();

    return this.ctx.storage.transactionSync(() => {
      let updated = 0;
      for (const id of normalizedIds) {
        const result = this.sql.exec(
          `UPDATE outbox
              SET status = 'delivered', delivered_at = ?
            WHERE id = ? AND status = 'pending'`,
          at,
          id
        );
        updated += Number(result.rowsWritten || 0);
      }
      return { updated };
    });
  }

  async health() {
    const meta = Object.fromEntries(
      this.sql.exec('SELECT key, value FROM meta ORDER BY key').toArray().map(row => [row.key, row.value])
    );
    const orderCount = Number(this.sql.exec('SELECT COUNT(*) AS count FROM orders').toArray()[0]?.count || 0);
    const pendingOutbox = Number(
      this.sql.exec("SELECT COUNT(*) AS count FROM outbox WHERE status = 'pending'").toArray()[0]?.count || 0
    );

    return {
      ok: true,
      schemaVersion: Number(meta.schema_version || DATABASE_SCHEMA_VERSION),
      yearCode: meta.year_code || '',
      orderCount,
      pendingOutbox
    };
  }

  #submitTransaction(command) {
    const commandYear = orderYearCode(command.submissionCreatedAt);
    this.#ensureYear(commandYear);

    const existing = this.sql.exec(
      `SELECT fingerprint, order_number, response_json
         FROM idempotency
        WHERE idempotency_key = ?
        LIMIT 1`,
      command.idempotencyKey
    ).toArray()[0];

    if (existing) {
      if (existing.fingerprint !== command.fingerprint) {
        throw ledgerError('IDEMPOTENCY_KEY_CONFLICT', command.idempotencyKey);
      }

      const orderRow = this.sql.exec(
        'SELECT payload_json FROM orders WHERE order_number = ? LIMIT 1',
        existing.order_number
      ).toArray()[0];

      if (!orderRow) throw ledgerError('IDEMPOTENCY_ORDER_MISSING', existing.order_number);
      const response = parseJson(existing.response_json, 'IDEMPOTENCY_RESPONSE_INVALID');

      return {
        ...response,
        action: 'REPLAY',
        replayed: true,
        order: parseJson(orderRow.payload_json, 'ORDER_PAYLOAD_INVALID')
      };
    }

    const sequence = this.#nextSequence(commandYear);
    const orderNumber = formatOrderNumberV2(command.submissionCreatedAt, sequence);
    const createdAt = command.preparedOrder.createdAt || command.submissionCreatedAt;
    const updatedAt = command.preparedOrder.updatedAt || createdAt;
    const order = {
      ...command.preparedOrder,
      orderNumber,
      orderCode: orderNumber,
      displayId: orderNumber,
      createdAt,
      updatedAt,
      status: command.preparedOrder.status || 'Novo',
      source: command.preparedOrder.source || 'catalog-v2'
    };
    const response = {
      ok: true,
      action: 'CREATED',
      replayed: false,
      orderNumber
    };

    this.sql.exec(
      `INSERT INTO orders (
         order_number, schema_version, status, payload_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      orderNumber,
      Number(order.schemaVersion || 2),
      order.status,
      JSON.stringify(order),
      createdAt,
      updatedAt
    );

    this.sql.exec(
      `INSERT INTO idempotency (
         idempotency_key, fingerprint, order_number, response_json, request_id, actor, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      command.idempotencyKey,
      command.fingerprint,
      orderNumber,
      JSON.stringify(response),
      command.requestId,
      command.actor,
      command.submissionCreatedAt,
      command.submissionCreatedAt
    );

    this.sql.exec(
      `INSERT INTO outbox (
         event_type, aggregate_id, payload_json, status, created_at
       ) VALUES (?, ?, ?, 'pending', ?)`,
      'order.created.v2',
      orderNumber,
      JSON.stringify({ schemaVersion: 1, orderNumber, order }),
      command.submissionCreatedAt
    );

    return { ...response, order };
  }

  #ensureYear(yearCode) {
    const current = this.sql.exec("SELECT value FROM meta WHERE key = 'year_code' LIMIT 1").toArray()[0]?.value;
    if (current && current !== yearCode) throw ledgerError('LEDGER_YEAR_MISMATCH', `${yearCode}:${current}`);
    if (!current) {
      this.sql.exec("INSERT INTO meta (key, value) VALUES ('year_code', ?)", yearCode);
    }
  }

  #nextSequence(yearCode) {
    const current = this.sql.exec(
      'SELECT next_sequence FROM counters WHERE year_code = ? LIMIT 1',
      yearCode
    ).toArray()[0];

    if (!current) {
      this.sql.exec('INSERT INTO counters (year_code, next_sequence) VALUES (?, ?)', yearCode, 2);
      return 1;
    }

    const sequence = positiveInteger(current.next_sequence);
    if (!sequence) throw ledgerError('ORDER_COUNTER_INVALID', yearCode);
    this.sql.exec('UPDATE counters SET next_sequence = ? WHERE year_code = ?', sequence + 1, yearCode);
    return sequence;
  }

  #initializeSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS counters (
        year_code TEXT PRIMARY KEY,
        next_sequence INTEGER NOT NULL CHECK (next_sequence > 0)
      );

      CREATE TABLE IF NOT EXISTS orders (
        order_number TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS idempotency (
        idempotency_key TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        order_number TEXT NOT NULL UNIQUE,
        response_json TEXT NOT NULL,
        request_id TEXT NOT NULL DEFAULT '',
        actor TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (order_number) REFERENCES orders(order_number)
      );

      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
        created_at TEXT NOT NULL,
        delivered_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(status, id);
      CREATE INDEX IF NOT EXISTS idx_idempotency_order ON idempotency(order_number);
    `);

    this.sql.exec(
      `INSERT INTO meta (key, value)
       VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      String(DATABASE_SCHEMA_VERSION)
    );
    this.sql.exec('PRAGMA optimize');
  }
}

function parseJson(value, code) {
  try {
    return JSON.parse(String(value || ''));
  } catch (_) {
    throw ledgerError(code);
  }
}

function normalizeOrderNumber(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return /^PED\d{2}\d{5}[A-Z]$/.test(normalized) ? normalized : '';
}

function validIsoDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function ledgerError(code, detail = '') {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}
