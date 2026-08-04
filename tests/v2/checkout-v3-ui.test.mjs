import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');

test('checkout usa CTA de envio para a vendedora', async () => {
  const source = await read('assets/checkout-v3-ui.js');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /Enviar para a vendedora/);
  assert.match(source, /Enviar pedido para a vendedora/);
  assert.doesNotMatch(source, />Abrir WhatsApp</);
});

test('artes da conferência são clicáveis e acessíveis por teclado', async () => {
  const source = await read('assets/checkout-v3-ui.js');
  assert.match(source, /checkoutV3Item\[data-checkout-v3-clickable/);
  assert.match(source, /setAttribute\('role','button'\)/);
  assert.match(source, /setAttribute\('tabindex','0'\)/);
  assert.match(source, /event\.key!==['"]Enter['"]/);
  assert.match(source, /event\.key!==['"] ['"]/);
  assert.match(source, /openPreview\(item\)/);
  assert.match(source, /checkoutV3ArtPreviewImage/);
  assert.match(source, /object-fit:contain/);
});

test('ajuste visual carrega somente depois do checkout e da recuperação', async () => {
  const loader = await read('assets/catalog-cache-bust.js');
  assert.doesNotThrow(() => new Function(loader));
  assert.match(loader, /checkoutV3UiScript/);
  assert.match(loader, /checkout-v3-ui\.js\?v=20260804-1/);
  assert.match(loader, /script\.addEventListener\('load',loadCheckoutUi/);
  assert.match(loader, /script\.addEventListener\('load',loadCheckoutRecovery/);
});
