from pathlib import Path

service = Path('scripts/catalog-v2/service-account-google-drive.mjs')
text = service.read_text(encoding='utf-8')
wrong = "grant_type: 'urn:ietf:params:oauth-type:jwt-bearer'.replace('oauth-type', 'oauth-grant-type'),"
right = "grant_type: 'urn:ietf:params:oauth2:grant-type:jwt-bearer',"
if wrong in text:
    text = text.replace(wrong, right, 1)
elif right not in text:
    raise SystemExit('SERVICE_ACCOUNT_GRANT_TYPE_TARGET_NOT_FOUND')
service.write_text(text, encoding='utf-8')

route = Path('functions/api/catalog-v2.js')
text = route.read_text(encoding='utf-8')
import_line = "import { tryAcceptedCatalogRequest } from './_accepted_catalog.js';\n"
if import_line not in text:
    text = import_line + text

marker = """    ).trim();

    if (mode === 'themes') {"""
replacement = """    ).trim();

    const accepted = await tryAcceptedCatalogRequest(context.env, {
      mode,
      productKey,
      folderId,
      query,
      limit: 80
    });
    if (accepted) return json(accepted, 200, 15);

    if (mode === 'themes') {"""
if replacement not in text:
    if marker not in text:
        raise SystemExit('CATALOG_ACCEPTED_INSERTION_TARGET_NOT_FOUND')
    text = text.replace(marker, replacement, 1)

old_virtual = """  if (text.startsWith('catalog-v2-product:')) return text;
  return /^[A-Za-z0-9_-]{5,200}$/.test(text) ? text : fallback;"""
new_virtual = """  if ([
    'catalog-v2-product:',
    'catalog-bolinhas-product:',
    'catalog-panel150-product:'
  ].some(prefix => text.startsWith(prefix))) return text;
  return /^[A-Za-z0-9_-]{5,200}$/.test(text) ? text : fallback;"""
if new_virtual not in text:
    if old_virtual not in text:
        raise SystemExit('CATALOG_VIRTUAL_ID_TARGET_NOT_FOUND')
    text = text.replace(old_virtual, new_virtual, 1)

route.write_text(text, encoding='utf-8')
print('Authenticated catalog patch applied.')
