from pathlib import Path

RAW_OLD = 'urn:ietf:params:oauth2:grant-type:jwt-bearer'
RAW_NEW = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
ENCODED_OLD = 'grant_type=urn%3Aietf%3Aparams%3Aoauth2%3Agrant-type%3Ajwt-bearer'
ENCODED_NEW = 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'

for path in [
    Path('scripts/catalog-v2/service-account-google-drive.mjs'),
    Path('functions/api/catalog-image.js'),
]:
    text = path.read_text(encoding='utf-8')
    if RAW_NEW in text and RAW_OLD not in text:
        continue
    count = text.count(RAW_OLD)
    if count != 1:
        raise SystemExit(f'GRANT_TYPE_TARGET_INVALID:{path}:{count}')
    path.write_text(text.replace(RAW_OLD, RAW_NEW, 1), encoding='utf-8')

test_path = Path('tests/catalog-v2/service-account-google-drive.test.mjs')
test_text = test_path.read_text(encoding='utf-8')
if ENCODED_NEW not in test_text:
    count = test_text.count(ENCODED_OLD)
    if count != 1:
        raise SystemExit(f'ENCODED_GRANT_TYPE_TARGET_INVALID:{count}')
    test_text = test_text.replace(ENCODED_OLD, ENCODED_NEW, 1)
test_path.write_text(test_text, encoding='utf-8')

print('Google JWT bearer grant type corrected.')
