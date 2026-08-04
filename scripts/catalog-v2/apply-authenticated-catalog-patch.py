from pathlib import Path

service = Path('scripts/catalog-v2/service-account-google-drive.mjs')
text = service.read_text(encoding='utf-8')

replacements = [
    (
        "const clientEmail = String(parsed.client_email || '').trim();",
        "const clientEmail = String(parsed.client_email || parsed.clientEmail || '').trim();",
        'service account email aliases',
    ),
    (
        "const privateKey = String(parsed.private_key || '').replace(/\\\\n/g, '\\n').trim();",
        "const privateKey = String(parsed.private_key || parsed.privateKey || '').replace(/\\\\n/g, '\\n').trim();",
        'service account private key aliases',
    ),
    (
        "const tokenUri = String(parsed.token_uri || GOOGLE_TOKEN_URL).trim();",
        "const tokenUri = String(parsed.token_uri || parsed.tokenUri || GOOGLE_TOKEN_URL).trim();",
        'service account token URI aliases',
    ),
    (
        "projectId: safeText(parsed.project_id, 200),",
        "projectId: safeText(parsed.project_id || parsed.projectId, 200),",
        'service account project aliases',
    ),
    (
        "privateKeyId: safeText(parsed.private_key_id, 200)",
        "privateKeyId: safeText(parsed.private_key_id || parsed.privateKeyId, 200)",
        'service account key ID aliases',
    ),
    (
        "grant_type: 'urn:ietf:params:oauth-type:jwt-bearer'.replace('oauth-type', 'oauth-grant-type'),",
        "grant_type: 'urn:ietf:params:oauth2:grant-type:jwt-bearer',",
        'OAuth JWT grant type',
    ),
]

for old, new, label in replacements:
    if new in text:
        continue
    if old not in text:
        raise SystemExit(f'SERVICE_ACCOUNT_PATCH_TARGET_NOT_FOUND: {label}')
    text = text.replace(old, new, 1)

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
