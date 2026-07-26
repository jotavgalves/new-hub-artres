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
