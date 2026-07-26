import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createCurrentSafetySnapshot,
  validateCurrentSafetySnapshot
} from '../../src/v2/products/current-config-adapter.mjs';

const fixtureUrl = new URL('../fixtures/v2/current-public-config.sanitized.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));

test('converte a configuração efetiva sem carregar produtos estáticos extras', () => {
  const snapshot = createCurrentSafetySnapshot(fixture);

  assert.deepEqual(Object.keys(snapshot.products), ['50x50']);
  assert.equal(snapshot.products['50x50'].label, 'Bolinhas');
  assert.equal(snapshot.products['50x50'].pricing.unitPrice, 9.75);
  assert.equal(snapshot.products['50x50'].quantity.minimum, 6);
  assert.equal(snapshot.products['50x50'].quantity.step, 2);
  assert.equal(snapshot.products['50x50'].quantity.scope, 'cart-product-total');
  assert.equal(snapshot.commercialState.effectiveDiscountPercent, 0);
  assert.equal(snapshot.commercialState.campaignActive, false);
  assert.equal(snapshot.metadata.catalogVersion, 49);
});

test('mantém todo produto passivo e bloqueado para staging', () => {
  const snapshot = createCurrentSafetySnapshot(fixture);
  const bolinhas = snapshot.products['50x50'];

  assert.deepEqual(bolinhas.activation, {
    catalogEnabled: false,
    checkoutEnabled: false,
    productionEnabled: false
  });
  assert.equal(bolinhas.validationStatus, 'staging-required');
  assert.ok(bolinhas.blockedReasons.includes('PASSIVE_SNAPSHOT'));
  assert.ok(bolinhas.blockedReasons.includes('STAGING_NOT_CONFIGURED'));
  assert.equal(snapshot.metadata.loadedByProduction, false);
  assert.equal(Object.isFrozen(snapshot), true);
});

test('preserva apenas metadados sanitizados do Drive', () => {
  const snapshot = createCurrentSafetySnapshot(fixture);
  const drive = snapshot.products['50x50'].drives[0];

  assert.equal(drive.id, 'bolinhas');
  assert.equal(drive.folderIdConfigured, true);
  assert.equal(drive.folderIdLength, 33);
  assert.equal(Object.hasOwn(drive, 'folderId'), false);
});

test('não transforma produto desconhecido em bolinhas ou painel', () => {
  const invalid = structuredClone(fixture);
  invalid.productCatalog.push({
    id: 'produto-novo',
    label: 'Produto Novo',
    productKey: 'produto-novo',
    active: true
  });
  invalid.products['produto-novo'] = {
    label: 'Produto Novo',
    productKey: 'produto-novo',
    unitPrice: 10,
    minQty: 1,
    step: 1
  };

  const snapshot = createCurrentSafetySnapshot(invalid);

  assert.deepEqual(Object.keys(snapshot.products), ['50x50']);
  assert.ok(snapshot.errors.includes('PRODUCT_NOT_REGISTERED:produto-novo'));
  assert.equal(validateCurrentSafetySnapshot(snapshot).ok, false);
});

test('rejeita produto sem preço, mínimo ou incremento válidos', () => {
  const invalid = structuredClone(fixture);
  invalid.products.bolinhas.unitPrice = 0;
  invalid.products.bolinhas.minQty = 0;
  invalid.products.bolinhas.step = 0;

  const snapshot = createCurrentSafetySnapshot(invalid);

  assert.deepEqual(snapshot.products, {});
  assert.ok(snapshot.errors.includes('UNIT_PRICE_INVALID:50x50'));
  assert.ok(snapshot.errors.includes('MINIMUM_QUANTITY_INVALID:50x50'));
  assert.ok(snapshot.errors.includes('QUANTITY_STEP_INVALID:50x50'));
});

test('rejeita configuração sem Drive ativo relacionado', () => {
  const invalid = structuredClone(fixture);
  invalid.drives = [];

  const snapshot = createCurrentSafetySnapshot(invalid);

  assert.ok(snapshot.errors.includes('ACTIVE_DRIVE_MISSING:50x50'));
  assert.equal(validateCurrentSafetySnapshot(snapshot).ok, false);
});

test('a fotografia sanitizada atual é internamente válida', () => {
  const snapshot = createCurrentSafetySnapshot(fixture);

  assert.deepEqual(validateCurrentSafetySnapshot(snapshot), {
    ok: true,
    errors: [],
    warnings: []
  });
});
