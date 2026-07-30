import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_COMMERCIAL_CSS,
  ADMIN_COMMERCIAL_HTML,
  ADMIN_COMMERCIAL_JS
} from '../../staging/site-v2-worker/src/admin-commercial-page.js';

test('página comercial expõe somente assets próprios e não persiste o token', () => {
  assert.match(ADMIN_COMMERCIAL_HTML, /<title>Armazem \| Configuração comercial<\/title>/);
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

test('formulário permite controlar os dois produtos e somente os campos autorizados', () => {
  assert.match(ADMIN_COMMERCIAL_JS, /\['50x50','painel-150'\]/);
  for (const field of ['enabled', 'unitPrice', 'minimum', 'step', 'initialQuantity']) {
    assert.match(ADMIN_COMMERCIAL_JS, new RegExp(field));
  }
  assert.match(ADMIN_COMMERCIAL_JS, /effectiveDiscountPercent/);
  assert.doesNotMatch(ADMIN_COMMERCIAL_JS, /productKey\s*:\s*document|label\s*:\s*document|quantityScope\s*:\s*document/);
});
