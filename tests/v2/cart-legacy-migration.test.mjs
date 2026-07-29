import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMigratedCartEnvelope,
  decodeLegacyCartSharePayload,
  encodeLegacyCartSharePayload,
  migrateLegacyCartSource,
  parseLegacyCartSource,
  restoreLegacyCartBackup
} from '../../src/v2/cart/legacy-migration.mjs';

const QUANTITY_SNAPSHOT = Object.freeze({
  metadata: Object.freeze({ mode: 'migration-test', catalogVersion: 49, configVersion: 7 }),
  products: Object.freeze({
    '50x50': Object.freeze({ quantity: Object.freeze({ minimum: 6, step: 2, scope: 'cart-product-total' }) }),
    sacolinha: Object.freeze({ quantity: Object.freeze({ initial: 10, minimum: 10, step: 5, scope: 'item' }) }),
    'painel-150': Object.freeze({ quantity: Object.freeze({ minimum: 1, step: 1, scope: 'item' }) })
  })
});

const CATALOG_ITEMS = Object.freeze([
  Object.freeze({
    id: 'drive-50',
    driveFileId: 'drive-50',
    code: '656',
    originalName: '656_TEMA_50X50.png',
    theme: 'TEMA',
    productKey: '50x50',
    productName: 'Bolinhas 50x50',
    sizeKey: '50x50'
  }),
  Object.freeze({
    id: 'drive-bag',
    driveFileId: 'drive-bag',
    code: '656',
    originalName: '656_TEMA_SACOLINHA.png',
    theme: 'TEMA',
    productKey: 'sacolinha',
    productName: 'Sacolinha de Festa',
    sizeKey: 'default'
  }),
  Object.freeze({
    id: 'drive-panel',
    driveFileId: 'drive-panel',
    code: '656',
    originalName: '656_TEMA_PAINEL.png',
    theme: 'TEMA',
    productKey: 'painel-150',
    productName: 'Painel 150x150',
    sizeKey: '150x150'
  })
]);

function options(overrides = {}) {
  return {
    catalogItems: CATALOG_ITEMS,
    quantitySnapshot: QUANTITY_SNAPSHOT,
    ...overrides
  };
}

test('migra o envelope atual do localStorage sem perder vendedor detalhes ou linhas', () => {
  const source = {
    cart: [
      {
        id: 'drive-50',
        code: '656',
        product: '50x50',
        qty: 6,
        theme: 'TEMA',
        image: 'https://example.invalid/50.png',
        details: { diameter: 50, observations: 'Preservar 50x50' }
      },
      {
        id: 'drive-bag',
        code: '656',
        product: 'sacolinha',
        qty: 10,
        theme: 'TEMA',
        image: 'https://example.invalid/bag.png',
        details: { size: 'G', observations: 'Preservar sacolinha' }
      }
    ],
    seller: 'ana'
  };
  const raw = JSON.stringify(source);
  const plan = migrateLegacyCartSource(raw, options());

  assert.equal(plan.status, 'ready');
  assert.equal(plan.sourceType, 'storage-json');
  assert.equal(plan.seller, 'ana');
  assert.equal(plan.cart.length, 2);
  assert.deepEqual(plan.cart.map(line => line.lineId), [
    'drive-50:50x50:default:50x50',
    'drive-bag:sacolinha:G:default'
  ]);
  assert.deepEqual(plan.cart.map(line => line.quantity), [6, 10]);
  assert.equal(plan.cart[0].details.observations, 'Preservar 50x50');
  assert.equal(plan.cart[1].details.observations, 'Preservar sacolinha');
  assert.equal(plan.report.sourceLineCount, 2);
  assert.equal(plan.report.migratedLineCount, 2);
  assert.equal(plan.report.reviewLineCount, 0);
  assert.equal(plan.report.writePerformed, false);
  assert.equal(plan.backup.raw, raw);
  assert.deepEqual(plan.backup.parsed, source);
  assert.deepEqual(restoreLegacyCartBackup(plan), source);
  assert.equal(restoreLegacyCartBackup(plan, { format: 'raw' }), raw);
});

test('gera envelope canônico apenas quando o plano está pronto', () => {
  const plan = migrateLegacyCartSource({
    cart: [{ id: 'drive-panel', product: 'painel-150', qty: 1 }],
    seller: 'dayane'
  }, options());
  const envelope = createMigratedCartEnvelope(plan);

  assert.deepEqual(envelope, {
    schemaVersion: 2,
    migrationVersion: 1,
    cart: plan.cart,
    seller: 'dayane'
  });
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.cart), true);
});

test('decodifica e migra link compartilhado com texto UTF-8', () => {
  const shared = {
    cart: [{
      id: 'drive-panel',
      product: 'painel-150',
      qty: 1,
      theme: 'Jardim Encantado',
      details: { observations: 'Aniversário da Júlia' }
    }],
    seller: 'ana'
  };
  const payload = encodeLegacyCartSharePayload(shared);

  assert.deepEqual(JSON.parse(decodeLegacyCartSharePayload(payload)), shared);

  const plan = migrateLegacyCartSource(payload, options());
  assert.equal(plan.sourceType, 'share-base64');
  assert.equal(plan.status, 'ready');
  assert.equal(plan.cart[0].details.observations, 'Aniversário da Júlia');
  assert.deepEqual(restoreLegacyCartBackup(plan), shared);
  assert.equal(restoreLegacyCartBackup(plan, { format: 'raw' }), payload);
});

test('preserva códigos visuais iguais em produtos diferentes', () => {
  const source = {
    cart: [
      { id: 'drive-50', code: '656', product: '50x50', qty: 6 },
      { id: 'drive-panel', code: '656', product: 'painel-150', qty: 1 }
    ]
  };
  const plan = migrateLegacyCartSource(source, options());

  assert.equal(plan.status, 'ready');
  assert.equal(plan.cart.length, 2);
  assert.equal(new Set(plan.cart.map(line => line.lineId)).size, 2);
  assert.deepEqual(plan.cart.map(line => line.code), ['656', '656']);
});

test('duplicação real vai para revisão sem desaparecer do backup', () => {
  const duplicate = { id: 'drive-panel', product: 'painel-150', qty: 1, details: { observations: 'segunda' } };
  const source = {
    cart: [
      { id: 'drive-panel', product: 'painel-150', qty: 1, details: { observations: 'primeira' } },
      duplicate
    ],
    seller: 'ana'
  };
  const plan = migrateLegacyCartSource(source, options());

  assert.equal(plan.status, 'needs-review');
  assert.equal(plan.cart.length, 1);
  assert.equal(plan.review.lines.length, 1);
  assert.equal(plan.review.lines[0].reason, 'LEGACY_CART_DUPLICATE_LINE_ID');
  assert.deepEqual(plan.review.lines[0].original, duplicate);
  assert.deepEqual(restoreLegacyCartBackup(plan), source);
  assert.throws(
    () => createMigratedCartEnvelope(plan),
    error => error.code === 'LEGACY_CART_MIGRATION_REVIEW_REQUIRED'
  );
});

test('arte ausente do catálogo fica em revisão com cópia integral', () => {
  const missing = {
    id: 'drive-missing',
    product: '50x50',
    qty: 6,
    code: '999',
    details: { observations: 'Não perder' }
  };
  const plan = migrateLegacyCartSource({ cart: [missing] }, options());

  assert.equal(plan.status, 'needs-review');
  assert.equal(plan.cart.length, 0);
  assert.equal(plan.review.lines[0].reason, 'LEGACY_CART_CATALOG_MATCH_REQUIRED');
  assert.deepEqual(plan.review.lines[0].original, missing);
});

test('produto legado divergente do catálogo não é corrigido silenciosamente', () => {
  const mismatched = { id: 'drive-panel', product: '50x50', qty: 6, code: '656' };
  const plan = migrateLegacyCartSource({ cart: [mismatched] }, options());

  assert.equal(plan.status, 'needs-review');
  assert.equal(plan.cart.length, 0);
  assert.equal(plan.review.lines[0].reason, 'LEGACY_CART_PRODUCT_MISMATCH');
  assert.deepEqual(plan.review.lines[0].original, mismatched);
});

test('quantidade comercial inválida é preservada e exige revisão', () => {
  const invalid = { id: 'drive-50', product: '50x50', qty: 7, code: '656' };
  const plan = migrateLegacyCartSource({ cart: [invalid], seller: 'ana' }, options());

  assert.equal(plan.status, 'needs-review');
  assert.equal(plan.cart.length, 1);
  assert.equal(plan.cart[0].quantity, 7);
  assert.ok(plan.review.quantityErrors.some(code => code.startsWith('CART_QUANTITY_STEP_INVALID:50x50')));
  assert.deepEqual(restoreLegacyCartBackup(plan), { cart: [invalid], seller: 'ana' });
});

test('snapshot de quantidade ausente não autoriza gravação silenciosa', () => {
  const plan = migrateLegacyCartSource({
    cart: [{ id: 'drive-panel', product: 'painel-150', qty: 1 }]
  }, {
    catalogItems: CATALOG_ITEMS
  });

  assert.equal(plan.status, 'needs-review');
  assert.equal(plan.report.quantityChecked, false);
  assert.deepEqual(plan.review.quantityErrors, ['LEGACY_CART_QUANTITY_SNAPSHOT_REQUIRED']);
});

test('aceita array legado e aliases de produto', () => {
  const source = [{ id: 'drive-panel', product: 'redondo-indefinido', qty: 1 }];
  const plan = migrateLegacyCartSource(source, options());

  assert.equal(plan.sourceType, 'array-object');
  assert.equal(plan.status, 'ready');
  assert.equal(plan.cart[0].productKey, 'painel-150');
  assert.equal(plan.cart[0].lineId, 'drive-panel:painel-150:default:150x150');
  assert.deepEqual(restoreLegacyCartBackup(plan), source);
});

test('fonte vazia produz plano vazio restaurável', () => {
  const source = { cart: [], seller: 'ana' };
  const plan = migrateLegacyCartSource(source, options());

  assert.equal(plan.status, 'empty');
  assert.equal(plan.cart.length, 0);
  assert.equal(plan.report.backupPreserved, true);
  assert.deepEqual(createMigratedCartEnvelope(plan), {
    schemaVersion: 2,
    migrationVersion: 1,
    cart: [],
    seller: 'ana'
  });
  assert.deepEqual(restoreLegacyCartBackup(plan), source);
});

test('entrada original não é mutada e o plano é profundamente congelado', () => {
  const source = {
    cart: [{ id: 'drive-panel', product: 'painel-150', qty: 1, details: { nested: { value: 1 } } }],
    seller: 'ana'
  };
  const snapshot = structuredClone(source);
  const plan = migrateLegacyCartSource(source, options());

  assert.deepEqual(source, snapshot);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.cart), true);
  assert.equal(Object.isFrozen(plan.cart[0].details.nested), true);
  assert.equal(Object.isFrozen(plan.backup.parsed), true);

  const restored = restoreLegacyCartBackup(plan);
  restored.cart[0].details.nested.value = 99;
  assert.equal(plan.backup.parsed.cart[0].details.nested.value, 1);
});

test('fontes inválidas e excessivas falham fechadas', () => {
  assert.throws(
    () => parseLegacyCartSource('não é json nem base64'),
    error => error.code === 'LEGACY_CART_SOURCE_INVALID'
  );
  assert.throws(
    () => decodeLegacyCartSharePayload('%%%'),
    error => error.code === 'LEGACY_CART_SHARE_PAYLOAD_INVALID'
  );
  assert.throws(
    () => migrateLegacyCartSource({ cart: Array.from({ length: 501 }, (_, index) => ({ id: `x-${index}` })) }),
    error => error.code === 'LEGACY_CART_LINE_LIMIT_EXCEEDED'
  );
});
