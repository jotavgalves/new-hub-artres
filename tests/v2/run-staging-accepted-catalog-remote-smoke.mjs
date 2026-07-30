const STAGING_URL = normalizeOrigin(process.env.STAGING_URL);
const STAGING_API_TOKEN = String(process.env.SITE_V2_STAGING_API_TOKEN || '').trim();
const MAX_FOLDERS = 40;
const PROPAGATION_MAX_ATTEMPTS = 90;
const PROPAGATION_INTERVAL_MS = 1000;
const REQUIRED_STABLE_RESPONSES = 3;
const TRANSIENT_STATUSES = new Set([404, 429, 500, 502, 503, 504]);

async function main() {
  if (STAGING_API_TOKEN.length < 32) throw smokeError('SITE_V2_STAGING_API_TOKEN_MISSING_OR_SHORT');

  const stable = await waitForAcceptedCatalogDeployment();
  const metadata = stable.metadata;

  const themes = await catalogRequest('themes');
  const bolinhasThemes = await catalogRequest('themes', { product: '50x50' });
  const painelThemes = await catalogRequest('themes', { product: 'painel-150' });
  const queue = uniqueFolders(themes);
  const bolinhasThemeCount = uniqueFolders(bolinhasThemes).length;
  const painelThemeCount = uniqueFolders(painelThemes).length;
  if (!queue.length) throw smokeError('STAGING_ACCEPTED_CATALOG_THEMES_EMPTY');
  if (!bolinhasThemeCount) throw smokeError('STAGING_BOLINHAS_CATALOG_EMPTY');
  if (!painelThemeCount) throw smokeError('STAGING_PAINEL_150_CATALOG_EMPTY');

  let productCount = 0;
  let itemCount = 0;
  const visited = new Set();

  while (queue.length && visited.size < MAX_FOLDERS && !itemCount) {
    const folder = queue.shift();
    const folderId = identity(folder);
    if (!folderId || visited.has(folderId)) continue;
    visited.add(folderId);

    const products = await catalogRequest('products', { folderId });
    for (const child of uniqueFolders(products)) {
      const id = identity(child);
      if (!id) continue;
      if (child?.kind === 'product' || child?.directItems === true || id.startsWith('catalog-index-product:')) {
        productCount += 1;
        const payload = await catalogRequest('items', {
          folderId: id,
          product: String(child?.product || '50x50')
        });
        const items = Array.isArray(payload?.items) ? payload.items : [];
        itemCount += items.length;
        if (items.length) break;
      } else if (!visited.has(id)) {
        queue.push(child);
      }
    }
  }

  if (!productCount || !itemCount) throw smokeError('STAGING_ACCEPTED_CATALOG_ITEMS_NOT_REACHABLE');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    propagationAttempts: stable.attempts,
    stableResponses: stable.consecutive,
    catalogVersion: Number(metadata.catalogVersion),
    themeCount: uniqueFolders(themes).length,
    bolinhasThemeCount,
    painelThemeCount,
    visitedFolderCount: visited.size,
    productCount,
    reachableItemCount: itemCount,
    currentDesignServed: true,
    productWorkspacesServed: true,
    assetProbe: stable.assetProbeSummary,
    productionChanged: false
  })}\n`);
}

async function waitForAcceptedCatalogDeployment() {
  let consecutive = 0;
  let lastCode = 'STAGING_ACCEPTED_CATALOG_PROPAGATION_PENDING';

  for (let attempt = 1; attempt <= PROPAGATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const healthResult = await fetchJsonResult(new URL('/health', STAGING_URL));
      if (!healthResult.ok) {
        lastCode = stageCode('HEALTH', healthResult.code);
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }
      const health = healthResult.payload;
      if (
        health?.ok !== true ||
        health?.acceptedCatalog?.enabled !== true ||
        health?.acceptedCatalog?.configured !== true ||
        health?.catalogReadonlyBridge?.enabled !== false
      ) {
        lastCode = 'STAGING_HEALTH_ACCEPTED_CATALOG_PENDING';
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }

      const assetProbeResult = await fetchJsonResult(
        new URL('/internal/v2/assets/probe', STAGING_URL),
        { 'x-staging-token': STAGING_API_TOKEN }
      );
      if (!assetProbeResult.ok) {
        lastCode = stageCode('ASSET_PROBE', assetProbeResult.code);
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }
      const assetProbe = assetProbeResult.payload;
      const assetProbeValidation = validateAssetProbe(assetProbe);
      if (!assetProbeValidation.ok) {
        lastCode = assetProbeValidation.code;
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }

      const home = await fetchText(new URL('/', STAGING_URL), 2 * 1024 * 1024);
      if (!home.response.ok || !/<title>Escolha suas Artes \| Armazém Festa e Eventos<\/title>/i.test(home.text)) {
        lastCode = home.response.ok
          ? 'STAGING_ROOT_DESIGN_TITLE_NOT_MATCHED'
          : `STAGING_ROOT_HTTP_${home.response.status}`;
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }
      if (
        !home.text.includes('./assets/v2-product-workspaces.js') ||
        !home.text.includes('SiteV2ProductWorkspaces.start({')
      ) {
        lastCode = 'STAGING_PRODUCT_WORKSPACES_HTML_NOT_READY';
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }

      const metadataResult = await fetchJsonResult(new URL('/api/catalog-meta', STAGING_URL));
      if (!metadataResult.ok) {
        lastCode = stageCode('CATALOG_META', metadataResult.code);
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }
      const metadata = metadataResult.payload;
      if (!validAcceptedMetadata(metadata)) {
        lastCode = 'STAGING_ACCEPTED_CATALOG_METADATA_PENDING';
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }

      consecutive += 1;
      process.stdout.write(`${JSON.stringify({
        event: 'staging-accepted-catalog-stable-probe',
        attempt,
        consecutive,
        catalogVersion: Number(metadata.catalogVersion),
        assetProbe: assetProbeValidation.summary
      })}\n`);

      if (consecutive >= REQUIRED_STABLE_RESPONSES) {
        return Object.freeze({
          attempts: attempt,
          consecutive,
          metadata,
          assetProbeSummary: assetProbeValidation.summary
        });
      }
    } catch (error) {
      lastCode = publicCode(error?.code || error?.message, 'STAGING_ACCEPTED_CATALOG_PROPAGATION_RETRY');
      consecutive = 0;
      await waitBeforeRetry(attempt, lastCode);
    }
  }

  throw smokeError(`STAGING_ACCEPTED_CATALOG_PROPAGATION_TIMEOUT_${lastCode}`.slice(0, 100));
}

function validateAssetProbe(payload) {
  if (payload?.ok !== true) return { ok: false, code: 'STAGING_ASSET_PROBE_PAYLOAD_INVALID' };
  if (payload.bindingConfigured !== true) return { ok: false, code: 'STAGING_ASSET_BINDING_NOT_CONFIGURED' };

  const probes = Array.isArray(payload.probes) ? payload.probes : [];
  const indexProbe = probes.find(item => item?.pathname === '/index.html');
  const rootProbe = probes.find(item => item?.pathname === '/');
  const workspaceProbe = probes.find(item => item?.pathname === '/assets/v2-product-workspaces.js');

  const indexResult = validateOneAssetProbe(indexProbe, 'INDEX', ['text/html']);
  if (!indexResult.ok) return indexResult;
  const rootResult = validateOneAssetProbe(rootProbe, 'ROOT_BINDING', ['text/html']);
  if (!rootResult.ok) return rootResult;
  const workspaceResult = validateOneAssetProbe(workspaceProbe, 'PRODUCT_WORKSPACES', [
    'application/javascript',
    'text/javascript'
  ]);
  if (!workspaceResult.ok) return workspaceResult;

  return {
    ok: true,
    summary: Object.freeze({
      indexStatus: Number(indexProbe.status),
      rootBindingStatus: Number(rootProbe.status),
      workspaceStatus: Number(workspaceProbe.status),
      workspaceContentType: String(workspaceProbe.contentType || ''),
      indexTitleMatched: indexProbe.titleMatched === true,
      rootBindingTitleMatched: rootProbe.titleMatched === true,
      workspaceMarkerMatched: workspaceProbe.markerMatched === true
    })
  };
}

function validateOneAssetProbe(probe, label, expectedContentTypes) {
  if (!probe || typeof probe !== 'object') {
    return { ok: false, code: `STAGING_ASSET_${label}_PROBE_MISSING` };
  }
  if (probe.responseReceived !== true) {
    const error = publicCode(probe.error, 'STAGING_ASSET_FETCH_FAILED');
    return { ok: false, code: `STAGING_ASSET_${label}_${error}`.slice(0, 100) };
  }
  if (probe.ok !== true || Number(probe.status) !== 200) {
    return { ok: false, code: `STAGING_ASSET_${label}_HTTP_${Number(probe.status) || 0}` };
  }
  const allowedContentTypes = Array.isArray(expectedContentTypes)
    ? expectedContentTypes
    : [expectedContentTypes];
  if (!allowedContentTypes.includes(probe.contentType)) {
    return { ok: false, code: `STAGING_ASSET_${label}_CONTENT_TYPE_INVALID` };
  }
  if (allowedContentTypes.includes('text/html') && probe.titleMatched !== true) {
    return { ok: false, code: `STAGING_ASSET_${label}_TITLE_NOT_MATCHED` };
  }
  if (probe.markerMatched !== true) {
    return { ok: false, code: `STAGING_ASSET_${label}_MARKER_NOT_MATCHED` };
  }
  return { ok: true };
}

function validAcceptedMetadata(metadata) {
  return metadata?.ok === true &&
    Number.isInteger(Number(metadata.catalogVersion)) &&
    Number(metadata.catalogVersion) >= 1 &&
    Number(metadata.routeCount) >= 1 &&
    Number(metadata.folderCount) >= 1 &&
    Number(metadata.itemCount) >= 1;
}

async function waitBeforeRetry(attempt, code) {
  process.stdout.write(`${JSON.stringify({
    event: 'staging-accepted-catalog-propagation-retry',
    attempt,
    code: publicCode(code, 'STAGING_ACCEPTED_CATALOG_PROPAGATION_RETRY')
  })}\n`);
  if (attempt < PROPAGATION_MAX_ATTEMPTS) await delay(PROPAGATION_INTERVAL_MS);
}

async function catalogRequest(mode, query = {}) {
  const url = new URL('/api/drive', STAGING_URL);
  url.searchParams.set('mode', mode);
  for (const [key, value] of Object.entries(query)) {
    const text = String(value || '').trim();
    if (text) url.searchParams.set(key, text);
  }
  const payload = await fetchJson(url);
  if (payload?.ok !== true) throw smokeError('STAGING_ACCEPTED_CATALOG_REQUEST_FAILED');
  return payload;
}

async function fetchJson(url, headers = {}) {
  const result = await fetchJsonResult(url, headers);
  if (!result.ok) throw smokeError(result.code);
  return result.payload;
}

async function fetchJsonResult(url, headers = {}) {
  const { response, text } = await fetchText(url, 8 * 1024 * 1024, headers);
  if (!response.ok) {
    let remoteCode = '';
    try { remoteCode = publicCode(JSON.parse(text)?.error, ''); } catch (_) {}
    return {
      ok: false,
      code: remoteCode || (TRANSIENT_STATUSES.has(response.status)
        ? `TRANSIENT_HTTP_${response.status}`
        : `HTTP_${response.status}`)
    };
  }
  try {
    return { ok: true, payload: JSON.parse(text) };
  } catch (_) {
    return { ok: false, code: 'RESPONSE_JSON_INVALID' };
  }
}

async function fetchText(url, maxBytes, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = new Headers({
      Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
      'Cache-Control': 'no-store'
    });
    for (const [key, value] of Object.entries(extraHeaders || {})) headers.set(key, String(value));

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers
    });
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw smokeError('STAGING_RESPONSE_TOO_LARGE');
    return { response, text };
  } catch (error) {
    if (error?.name === 'AbortError') throw smokeError('STAGING_REQUEST_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function uniqueFolders(payload) {
  const rows = [payload?.folders, payload?.results, payload?.themes, payload?.products].find(Array.isArray) || [];
  const map = new Map();
  for (const row of rows) {
    const id = identity(row);
    if (id && !map.has(id)) map.set(id, row);
  }
  return [...map.values()];
}

function identity(value) {
  return String(value?.id || value?.driveId || value?.drive_id || '').trim();
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) { throw smokeError('STAGING_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw smokeError('STAGING_URL_INVALID');
  }
  return url.origin;
}

function stageCode(stage, code) {
  return publicCode(`STAGING_${stage}_${code}`, `STAGING_${stage}_FAILED`);
}

function publicCode(value, fallback) {
  const text = String(value || '').trim();
  return /^[A-Z0-9_]{3,100}$/.test(text) ? text : fallback;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function smokeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

main().catch(error => {
  const code = publicCode(
    error?.code || error?.message,
    'STAGING_ACCEPTED_CATALOG_SMOKE_FAILED'
  );
  console.error(code);
  process.exitCode = 1;
});
