import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_COMMERCIAL_CSS,
  ADMIN_COMMERCIAL_HTML,
  ADMIN_COMMERCIAL_JS
} from '../../staging/site-v2-worker/src/admin-commercial-page.js';

test('página comercial expõe somente assets próprios e não persiste o token', () => {
  assert.match(ADMIN_COMMERCIAL_HTML, /<title>Armazem \| Produtos e preços<\/title>/);
  assert.match(ADMIN_COMMERCIAL_HTML, /Produtos, preços e quantidades/);
  assert.match(ADMIN_COMMERCIAL_HTML, /\/admin\/commercial\/app\.css/);
  assert.match(ADMIN_COMMERCIAL_HTML, /\/admin\/commercial\/app\.js/);
  assert.match(ADMIN_COMMERCIAL_HTML, /autocomplete="off"/);
  assert.match(ADMIN_COMMERCIAL_JS, /state = \{ token:'', loading:false, config:null \}/);
  assert.doesNotMatch(ADMIN_COMMERCIAL_JS, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.doesNotMatch(`${ADMIN_COMMERCIAL_HTML}${ADMIN_COMMERCIAL_CSS}${ADMIN_COMMERCIAL_JS}`, /STAGING_API_TOKEN|local-staging-token/);
});

test('salvamento usa versão esperada, atualiza a tela e recarrega histórico', () => {
  assert.match(ADMIN_COMMERCIAL_JS, /expectedVersion:state\.config\.version/);
  assert.match(ADMIN_COMMERCIAL_JS, /render\(result\.config,\[\]\)/);
  assert.match(ADMIN_COMMERCIAL_JS, /setBusy\(false\);\s*await loadConfig\('Nova versão comercial publicada com sucesso\.'/);
  assert.match(ADMIN_COMMERCIAL_JS, /COMMERCIAL_CONFIG_VERSION_CONFLICT/);
  assert.match(ADMIN_COMMERCIAL_JS, /A versão atual foi recarregada/);
});

test('formulário controla preço e quantidade de Bolinhas e Painel 150 separadamente', () => {
  assert.match(ADMIN_COMMERCIAL_JS, /'50x50'/);
  assert.match(ADMIN_COMMERCIAL_JS, /'painel-150'/);
  for (const field of ['enabled', 'unitPrice', 'minimum', 'step', 'initialQuantity']) {
    assert.match(ADMIN_COMMERCIAL_JS, new RegExp(field));
  }
  assert.match(ADMIN_COMMERCIAL_JS, /Preço unitário \(R\$\)/);
  assert.match(ADMIN_COMMERCIAL_JS, /Quantidade mínima/);
  assert.match(ADMIN_COMMERCIAL_JS, /Incremento de quantidade/);
  assert.match(ADMIN_COMMERCIAL_JS, /Quantidade inicial sugerida/);
  assert.match(ADMIN_COMMERCIAL_JS, /effectiveDiscountPercent/);
  assert.doesNotMatch(ADMIN_COMMERCIAL_JS, /productKey\s*:\s*document|label\s*:\s*document|quantityScope\s*:\s*document/);
});

test('raízes exclusivas do Drive aparecem travadas e não entram no payload editável', () => {
  assert.match(ADMIN_COMMERCIAL_JS, /193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae/);
  assert.match(ADMIN_COMMERCIAL_JS, /18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-/);
  assert.match(ADMIN_COMMERCIAL_JS, /ORIGEM PROTEGIDA/);
  assert.match(ADMIN_COMMERCIAL_JS, /Somente artes descendentes desta raiz/);
  assert.doesNotMatch(ADMIN_COMMERCIAL_JS, /rootDriveId\s*:\s*document/);
  assert.doesNotMatch(ADMIN_COMMERCIAL_JS, /catalogRootDriveId\s*:\s*document/);
});

test('validação impede quantidade inicial incompatível e mostra prévia comercial', () => {
  assert.match(ADMIN_COMMERCIAL_JS, /initial<minimum/);
  assert.match(ADMIN_COMMERCIAL_JS, /\(initial-minimum\)%step!==0/);
  assert.match(ADMIN_COMMERCIAL_JS, /Corrija as regras destacadas antes de publicar/);
  assert.match(ADMIN_COMMERCIAL_JS, /Pedido na quantidade inicial/);
  assert.match(ADMIN_COMMERCIAL_JS, /Intl\.NumberFormat\('pt-BR',\{style:'currency',currency:'BRL'\}\)/);
  assert.match(ADMIN_COMMERCIAL_JS, /saveButton\.disabled=state\.loading\|\|!validation\.ok/);
});
