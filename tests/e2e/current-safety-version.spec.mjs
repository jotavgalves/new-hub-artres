import { test, expect } from '@playwright/test';

async function waitForThemes(page) {
  const heroTitle = page.locator('h1').first();
  await expect(heroTitle).toBeVisible();
  await expect(heroTitle).toContainText(/vamos montar.*festa/i);
  await expect(page.locator('[data-theme]').first()).toBeVisible({ timeout: 25_000 });
}

async function openFirstArtworkList(page) {
  await waitForThemes(page);
  await page.locator('[data-theme]').first().click();

  for (let depth = 0; depth < 6; depth += 1) {
    const artwork = page.locator('[data-card]').first();
    const productOrFolder = page.locator('[data-product]').first();

    await page.locator('[data-card], [data-product]').first().waitFor({
      state: 'visible',
      timeout: 25_000
    });

    if (await artwork.isVisible().catch(() => false)) return artwork;

    await expect(productOrFolder).toBeVisible();
    await productOrFolder.click();
  }

  throw new Error('NAO_FOI_POSSIVEL_ABRIR_LISTA_DE_ARTES');
}

function installDiagnostics(page) {
  const diagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    badResponses: []
  };

  page.on('console', message => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });

  page.on('pageerror', error => {
    diagnostics.pageErrors.push(String(error && error.stack ? error.stack : error));
  });

  page.on('requestfailed', request => {
    diagnostics.failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'UNKNOWN'
    });
  });

  page.on('response', response => {
    if (response.status() >= 400) {
      diagnostics.badResponses.push({
        url: response.url(),
        status: response.status(),
        method: response.request().method()
      });
    }
  });

  return diagnostics;
}

async function attachRuntimeSnapshot(page, testInfo, diagnostics) {
  const runtime = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    heroTitle: document.querySelector('h1')?.textContent?.trim() || '',
    promoTitle: document.querySelector('.promo h3')?.textContent?.trim() || '',
    themeCountLabel: document.querySelector('#count')?.textContent?.trim() || '',
    themeCards: document.querySelectorAll('[data-theme]').length,
    productCards: document.querySelectorAll('[data-product]').length,
    artworkCards: document.querySelectorAll('[data-card]').length,
    scripts: Array.from(document.scripts).map(script => script.src || 'inline'),
    globals: {
      catalogVersionedCache: Boolean(window.__CATALOG_VERSIONED_CACHE__),
      catalogRuntimeSafe: Boolean(window.__ARMAZEM_CATALOG_RUNTIME_SAFE__),
      customerCheckout: Boolean(window.__ARMAZEM_CUSTOMER_CHECKOUT__),
      navigationUx: Boolean(window.__ARMAZEM_CATALOG_NAV_UX__)
    },
    storageKeys: Object.keys(localStorage).sort()
  }));

  await testInfo.attach('runtime-diagnostics.json', {
    body: Buffer.from(JSON.stringify({ runtime, diagnostics }, null, 2)),
    contentType: 'application/json'
  });
}

function collectObjectKeys(value, path = '', keys = []) {
  if (!value || typeof value !== 'object') return keys;

  for (const [key, nested] of Object.entries(value)) {
    const currentPath = path ? `${path}.${key}` : key;
    keys.push({ key, path: currentPath });
    collectObjectKeys(nested, currentPath, keys);
  }

  return keys;
}

function summarizeConfig(payload) {
  const config = payload?.config || {};
  const products = Object.fromEntries(
    Object.entries(config.products || {}).map(([key, definition]) => [key, {
      label: definition?.label || '',
      productKey: definition?.productKey || '',
      unitPrice: definition?.unitPrice ?? null,
      minQty: definition?.minQty ?? null,
      step: definition?.step ?? null,
      disableCustomization: definition?.disableCustomization ?? null,
      skipProductsStep: definition?.skipProductsStep ?? null
    }])
  );

  return {
    ok: payload?.ok === true,
    source: payload?.source || '',
    storageReady: payload?.storageReady === true,
    warning: payload?.warning || '',
    version: config.version ?? null,
    sellers: (config.sellers || []).map(seller => ({
      id: seller.id || '',
      label: seller.label || '',
      active: seller.active !== false,
      phoneConfigured: Boolean(String(seller.phone || '').trim())
    })),
    products,
    productCatalog: (config.productCatalog || []).map(item => ({
      id: item.id || '',
      label: item.label || '',
      productKey: item.productKey || '',
      active: item.active !== false,
      editable: item.editable !== false
    })),
    drives: (config.drives || []).map(drive => ({
      id: drive.id || '',
      name: drive.name || '',
      active: drive.active !== false,
      type: drive.type || '',
      productKey: drive.productKey || '',
      structure: drive.structure || '',
      filenamePattern: drive.filenamePattern || '',
      folderIdConfigured: Boolean(String(drive.folderId || '').trim()),
      folderIdLength: String(drive.folderId || '').length
    })),
    ui: config.ui || {},
    campaign: config.campaign || {},
    maintenance: config.maintenance || {},
    orderSettings: config.orderSettings || {},
    productionApi: config.productionApi || {},
    hero: config.content?.hero || {},
    promo: config.content?.promo || {},
    catalogContent: config.content?.catalog || {},
    cartContent: config.content?.cart || {},
    appearance: config.appearance || {}
  };
}

function summarizeRules(payload) {
  const rules = payload?.rules || payload || {};
  const themeBlocks = Array.isArray(rules.themeBlocks) ? rules.themeBlocks : [];
  const artBlocks = Array.isArray(rules.artBlocks) ? rules.artBlocks : [];

  return {
    ok: payload?.ok !== false,
    topLevelKeys: Object.keys(payload || {}).sort(),
    ruleKeys: Object.keys(rules || {}).sort(),
    version: rules.version ?? payload?.version ?? null,
    themeBlockCount: themeBlocks.length,
    artBlockCount: artBlocks.length,
    updatedAt: rules.updatedAt || payload?.updatedAt || ''
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_) {}
  });
});

test('registra a página inicial da Atual Versão de Segurança', async ({ page }, testInfo) => {
  const diagnostics = installDiagnostics(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForThemes(page);

  await expect(page.locator('#barItems')).toHaveText('0 item(ns)');
  await expect(page.locator('#barTotal')).toContainText('R$');

  await page.screenshot({
    path: testInfo.outputPath('home-full.png'),
    fullPage: true
  });

  await attachRuntimeSnapshot(page, testInfo, diagnostics);
});

test('navega até uma arte e adiciona ao carrinho sem finalizar pedido', async ({ page }, testInfo) => {
  const diagnostics = installDiagnostics(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const artwork = await openFirstArtworkList(page);

  await artwork.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('artwork-list.png'),
    fullPage: true
  });

  const addButton = artwork.locator('[data-select]').first();
  await expect(addButton).toBeVisible();
  await addButton.click();

  await expect(page.locator('#barItems')).not.toHaveText('0 item(ns)');
  await expect(page.locator('#cartDesk, #cartMob').filter({ hasText: 'Seu orçamento' }).first()).toBeAttached();

  await page.screenshot({
    path: testInfo.outputPath('cart-after-one-item.png'),
    fullPage: true
  });

  await attachRuntimeSnapshot(page, testInfo, diagnostics);
});

test('registra contratos públicos sem persistir dados sensíveis', async ({ request }, testInfo) => {
  const [configResponse, metaResponse, rulesResponse] = await Promise.all([
    request.get('/api/config'),
    request.get('/api/catalog-meta'),
    request.get('/api/catalog-rules')
  ]);

  expect(configResponse.status()).toBe(200);
  expect(metaResponse.status()).toBe(200);
  expect(rulesResponse.status()).toBe(200);

  const [configPayload, metaPayload, rulesPayload] = await Promise.all([
    configResponse.json(),
    metaResponse.json(),
    rulesResponse.json()
  ]);

  const forbiddenExactKeys = new Set([
    'secret',
    'token',
    'password',
    'apikey',
    'api_key',
    'service_role_key',
    'servicerolekey',
    'private_key',
    'privatekey',
    'admin_secret',
    'adminsecret'
  ]);

  const exposedSensitivePaths = collectObjectKeys(configPayload)
    .filter(({ key }) => forbiddenExactKeys.has(String(key).toLowerCase()))
    .map(({ path }) => path);

  expect(exposedSensitivePaths).toEqual([]);

  const publicContracts = {
    capturedAt: new Date().toISOString(),
    config: summarizeConfig(configPayload),
    catalogMeta: {
      ok: metaPayload?.ok !== false,
      keys: Object.keys(metaPayload || {}).sort(),
      version: metaPayload?.version || metaPayload?.catalogVersion || '',
      schema: metaPayload?.schema || '',
      updatedAt: metaPayload?.updatedAt || ''
    },
    catalogRules: summarizeRules(rulesPayload),
    exposedSensitivePaths
  };

  await testInfo.attach('public-api-contracts.json', {
    body: Buffer.from(JSON.stringify(publicContracts, null, 2)),
    contentType: 'application/json'
  });
});
