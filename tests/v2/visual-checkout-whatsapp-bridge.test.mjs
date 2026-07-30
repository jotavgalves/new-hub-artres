import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('bridge gera WhatsApp somente após CREATED ou REPLAY com o número confirmado', async () => {
  const source = await readFile('staging/site-v2-worker/public/v2-checkout-bridge.js', 'utf8');
  const accepted = source.indexOf("const accepted = (response.status === 201 && payload.action === 'CREATED')");
  const guard = source.indexOf('if (!accepted || payload.ok !== true || !payload.orderNumber)');
  const message = source.indexOf('formatter.createVisualWhatsAppMessage({');
  const url = source.indexOf('formatter.createVisualWhatsAppUrl({');
  const open = source.indexOf('popup.location.replace(whatsappUrl)');

  assert.ok(accepted >= 0);
  assert.ok(guard > accepted);
  assert.ok(message > guard);
  assert.ok(url > message);
  assert.ok(open > url);
  assert.match(source, /orderNumber: payload\.orderNumber/);
  assert.match(source, /items: snapshot\.whatsappItems/);
  assert.match(source, /phone: snapshot\.sellerPhone/);
  assert.doesNotMatch(source, /snapshot\.whatsappUrl/);
  assert.doesNotMatch(source, /\bwaUrl\s*\(/);
  assert.doesNotMatch(source, /STAGING_API_TOKEN|SUPABASE_V2_SERVICE_ROLE_KEY/);
});

test('snapshot do WhatsApp deriva das mesmas linhas e itens canônicos submetidos', async () => {
  const source = await readFile('staging/site-v2-worker/public/v2-checkout-bridge.js', 'utf8');
  const map = source.indexOf('const items = lines.map(mapCartItem);');
  const snapshot = source.indexOf('formatter.createVisualWhatsAppSnapshot(lines, items);');
  const intent = source.indexOf('items: snapshot.items');

  assert.ok(map >= 0);
  assert.ok(snapshot > map);
  assert.ok(intent > snapshot);
  assert.match(source, /typeof formatter\.createVisualWhatsAppSnapshot === 'function'/);
  assert.match(source, /typeof formatter\.createVisualWhatsAppMessage === 'function'/);
  assert.match(source, /typeof formatter\.createVisualWhatsAppUrl === 'function'/);
});

test('formatador permanece exclusivo do staging e é carregado antes do bridge', async () => {
  const [productionHtml, preparation, formatter] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('scripts/v2/prepare-site-v2-static-assets.mjs', 'utf8'),
    readFile('staging/site-v2-worker/public/v2-checkout-whatsapp.js', 'utf8')
  ]);

  assert.doesNotMatch(productionHtml, /v2-checkout-whatsapp\.js/);
  assert.match(preparation, /v2-checkout-context\.js[\s\S]*v2-checkout-whatsapp\.js[\s\S]*v2-checkout-bridge\.js/);
  assert.match(formatter, /site-v2-visual-checkout-whatsapp-v1/);
  assert.match(formatter, /createVisualWhatsAppMessage/);
  assert.match(formatter, /createVisualWhatsAppUrl/);
  assert.doesNotMatch(formatter, /customerWhatsapp|customer\.name|service_role|STAGING_API_TOKEN/);
});
