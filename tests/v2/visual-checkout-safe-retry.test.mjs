import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const whatsapp = require('../../staging/site-v2-worker/public/v2-checkout-whatsapp.js');
const VALID_URL = 'https://wa.me/5581999999999?text=Pedido%3A%20PED2600123A';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }
  };
}

test('cria e restaura somente recuperação válida e recente do WhatsApp', () => {
  const now = Date.UTC(2026, 6, 30, 12, 0, 0);
  const recovery = whatsapp.createVisualWhatsAppRecovery({
    orderNumber: 'PED2600123A',
    whatsappUrl: VALID_URL,
    createdAtMs: now
  }, now);

  assert.equal(Object.isFrozen(recovery), true);
  assert.equal(recovery.version, 1);
  assert.equal(recovery.orderNumber, 'PED2600123A');
  assert.equal(recovery.whatsappUrl, VALID_URL);
  assert.deepEqual(whatsapp.parseVisualWhatsAppRecovery(JSON.stringify(recovery), now), recovery);
});

test('descarta recuperação expirada, adulterada ou com redirecionamento inseguro', () => {
  const now = Date.UTC(2026, 6, 30, 12, 0, 0);
  const expired = {
    version: 1,
    orderNumber: 'PED2600123A',
    whatsappUrl: VALID_URL,
    createdAtMs: now - whatsapp.RECOVERY_MAX_AGE_MS - 1
  };

  assert.equal(whatsapp.parseVisualWhatsAppRecovery(expired, now), null);
  assert.equal(whatsapp.parseVisualWhatsAppRecovery('{invalido', now), null);
  assert.equal(whatsapp.isSafeVisualWhatsAppUrl('http://wa.me/5581999999999?text=Pedido'), false);
  assert.equal(whatsapp.isSafeVisualWhatsAppUrl('https://example.com/5581999999999?text=Pedido'), false);
  assert.equal(whatsapp.isSafeVisualWhatsAppUrl('https://wa.me/5581999999999?text=Pedido&next=https://example.com'), false);
  assert.throws(
    () => whatsapp.createVisualWhatsAppRecovery({
      orderNumber: 'PED2600123A',
      whatsappUrl: 'https://example.com/falso',
      createdAtMs: now
    }, now),
    error => error.code === 'WHATSAPP_RECOVERY_URL_INVALID'
  );
});

test('URL gerada após pedido confirmado fica disponível para reabertura na mesma sessão', t => {
  const previousStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = memoryStorage();
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousStorage;
  });

  const message = [
    'Oi, Ana! Meu pedido foi registrado no site.',
    '',
    'Pedido: PED2600123A',
    '',
    'Minha seleção:',
    '1. Arte #2657 | Bolinhas 50x50'
  ].join('\n');
  const url = whatsapp.createVisualWhatsAppUrl({
    phone: '+55 (81) 99999-9999',
    message
  });
  const stored = whatsapp.readVisualWhatsAppRecovery();

  assert.equal(url.startsWith('https://wa.me/5581999999999?text='), true);
  assert.equal(stored.orderNumber, 'PED2600123A');
  assert.equal(stored.whatsappUrl, url);
  assert.equal(whatsapp.isSafeVisualWhatsAppUrl(stored.whatsappUrl), true);
});

test('reabrir recuperação não envia novo pedido e possui fallback para popup bloqueado', t => {
  const previousWindow = globalThis.window;
  const opened = [];
  const assigned = [];
  globalThis.window = {
    open(url, target) {
      opened.push([url, target]);
      return null;
    },
    location: {
      assign(url) { assigned.push(url); }
    }
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  assert.equal(whatsapp.openRecoveredWhatsApp(VALID_URL), true);
  assert.deepEqual(opened, [[VALID_URL, '_blank']]);
  assert.deepEqual(assigned, [VALID_URL]);
});

test('bridge mantém chave determinística e aceita REPLAY quando a resposta anterior se perde', async () => {
  const bridge = await readFile('staging/site-v2-worker/public/v2-checkout-bridge.js', 'utf8');
  const recoverySource = await readFile('staging/site-v2-worker/public/v2-checkout-whatsapp.js', 'utf8');

  assert.match(bridge, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(bridge, /response\.status === 200 && payload\.action === 'REPLAY'/);
  assert.match(bridge, /Idempotency-Key': idempotencyKey/);
  assert.match(recoverySource, /Abrir WhatsApp novamente/);
  assert.match(recoverySource, /openRecoveredWhatsApp\(recovery\.whatsappUrl\)/);
  assert.doesNotMatch(recoverySource, /fetch\(|\/api\/orders\/v2/);
});