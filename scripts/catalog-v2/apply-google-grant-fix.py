from pathlib import Path

OLD = 'urn:ietf:params:oauth2:grant-type:jwt-bearer'
NEW = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

paths = [
    Path('scripts/catalog-v2/service-account-google-drive.mjs'),
    Path('functions/api/catalog-image.js'),
    Path('tests/catalog-v2/service-account-google-drive.test.mjs'),
]

for path in paths:
    text = path.read_text(encoding='utf-8')
    if NEW in text and OLD not in text:
        continue
    count = text.count(OLD)
    if count != 1:
        raise SystemExit(f'GRANT_TYPE_TARGET_INVALID:{path}:{count}')
    path.write_text(text.replace(OLD, NEW, 1), encoding='utf-8')

print('Google JWT bearer grant type corrected.')
