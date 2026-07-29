import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalogAutoAcceptComment } from '../../scripts/catalog-v2/post-catalog-auto-accept-status.mjs';

test('relatório automático contém somente contagens e estado sanitizado', () => {
  const body = buildCatalogAutoAcceptComment({
    outcome: 'success',
    report: {
      action: 'ACCEPTED',
      catalogVersion: 50,
      accepted: true,
      changed: true,
      traversalComplete: true,
      routeCount: 998,
      themeCount: 486,
      folderCount: 499,
      productCount: 497,
      artworkCount: 4132,
      rejectedCount: 0,
      differenceCount: 0,
      fingerprint: 'a'.repeat(64),
      privateUrl: 'https://drive.google.com/private'
    }
  });
  assert.match(body, /Versão: \*\*50\*\*/);
  assert.match(body, /Aceita no staging: \*\*sim\*\*/);
  assert.match(body, /Diferenças de contrato: 0/);
  assert.doesNotMatch(body, /drive\.google\.com/);
  assert.doesNotMatch(body, /aaaaaaaaaaaaaaaa/);
});
