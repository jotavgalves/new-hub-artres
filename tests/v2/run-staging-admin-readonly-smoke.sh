#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PORT="${SITE_V2_STAGING_ADMIN_TEST_PORT:-8791}"
BASE_URL="http://127.0.0.1:${PORT}"
TOKEN="local-staging-token-0123456789abcdef"
CREATED_AT="2026-07-27T17:30:00.000Z"
IDEMPOTENCY_KEY="admin_smoke_0123456789abcdef"
LOG_FILE="/tmp/site-v2-staging-admin-wrangler.log"
BODY_FILE="/tmp/site-v2-staging-admin-body.json"
ADMIN_HTML_FILE="/tmp/site-v2-staging-admin.html"
ADMIN_UNAUTH_FILE="/tmp/site-v2-staging-admin-unauth.json"
ADMIN_DATA_FILE="/tmp/site-v2-staging-admin-data.json"

cleanup() {
  status=$?
  if [ -n "${WRANGLER_PID:-}" ] && kill -0 "$WRANGLER_PID" 2>/dev/null; then
    kill "$WRANGLER_PID" 2>/dev/null || true
    wait "$WRANGLER_PID" 2>/dev/null || true
  fi
  rm -f .dev.vars "$BODY_FILE" "$ADMIN_HTML_FILE" "$ADMIN_UNAUTH_FILE" "$ADMIN_DATA_FILE"
  rm -rf .wrangler
  if [ "$status" -ne 0 ]; then
    echo "Falha no smoke do painel administrativo."
    cat "$LOG_FILE" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT

rm -rf .wrangler
cat > .dev.vars <<EOF
STAGING_API_TOKEN="$TOKEN"
STAGING_WRITE_ENABLED="true"
EOF

cat > "$BODY_FILE" <<EOF
{
  "submissionCreatedAt": "$CREATED_AT",
  "seller": { "id": "admin-smoke", "label": "Admin Smoke" },
  "customer": { "name": "Cliente Sintético", "whatsapp": "5581999999999" },
  "items": [{
    "driveFileId": "staging-artwork-2657",
    "productKey": "50x50",
    "variantKey": "default",
    "sizeKey": "50x50",
    "quantity": 6
  }]
}
EOF

npx --yes wrangler@4.114.0 dev \
  --local \
  --config wrangler.site-v2-staging.jsonc \
  --port "$PORT" \
  > "$LOG_FILE" 2>&1 &
WRANGLER_PID=$!

for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error "$BASE_URL/health" >/dev/null; then break; fi
  if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then exit 1; fi
  sleep 1
  if [ "$attempt" -eq 60 ]; then exit 1; fi
done

ADMIN_HTML_STATUS=$(curl --silent --show-error --output "$ADMIN_HTML_FILE" --write-out '%{http_code}' "$BASE_URL/admin")
if [ "$ADMIN_HTML_STATUS" != "200" ]; then exit 1; fi

grep -q "Pedidos sintéticos" "$ADMIN_HTML_FILE"
grep -q "SOMENTE LEITURA" "$ADMIN_HTML_FILE"

UNAUTH_STATUS=$(curl --silent --show-error \
  --output "$ADMIN_UNAUTH_FILE" \
  --write-out '%{http_code}' \
  "$BASE_URL/internal/v2/admin/orders?limit=50")
if [ "$UNAUTH_STATUS" != "401" ]; then exit 1; fi

node -e '
  const fs = require("fs");
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (body.error !== "STAGING_TOKEN_INVALID") throw new Error("ADMIN_UNAUTH_GUARD_INVALID");
' "$ADMIN_UNAUTH_FILE"

curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --header "X-Staging-Token: $TOKEN" \
  --header "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data-binary "@$BODY_FILE" \
  "$BASE_URL/internal/v2/orders/submit" >/dev/null

curl --fail --silent --show-error \
  --header "X-Staging-Token: $TOKEN" \
  "$BASE_URL/internal/v2/admin/orders?limit=50" \
  > "$ADMIN_DATA_FILE"

node -e '
  const fs = require("fs");
  const result = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!result.ok || result.readOnly !== true) throw new Error("ADMIN_NOT_READ_ONLY");
  if (result.catalog !== "synthetic-staging-only" || result.catalogVersion !== 9001) throw new Error("ADMIN_CATALOG_INVALID");
  if (result.summary?.orderCount !== 1) throw new Error("ADMIN_ORDER_COUNT_INVALID");
  if (result.summary?.totalValue !== 58.5) throw new Error("ADMIN_TOTAL_INVALID");
  if (result.summary?.itemQuantity !== 6) throw new Error("ADMIN_ITEM_QUANTITY_INVALID");
  if (result.orders?.length !== 1) throw new Error("ADMIN_ORDERS_INVALID");
  if (result.orders[0]?.customer?.redacted !== true) throw new Error("ADMIN_CUSTOMER_NOT_REDACTED");
  if (Object.hasOwn(result.orders[0]?.customer || {}, "whatsapp")) throw new Error("ADMIN_PHONE_EXPOSED");
  if (result.orders[0]?.items?.[0]?.driveFileId !== "staging-artwork-2657") throw new Error("ADMIN_ARTWORK_INVALID");
' "$ADMIN_DATA_FILE"

POST_STATUS=$(curl --silent --show-error \
  --output /tmp/site-v2-staging-admin-post.json \
  --write-out '%{http_code}' \
  --request POST \
  --header "X-Staging-Token: $TOKEN" \
  "$BASE_URL/internal/v2/admin/orders")
if [ "$POST_STATUS" != "405" ]; then exit 1; fi
rm -f /tmp/site-v2-staging-admin-post.json

echo "Smoke do painel administrativo somente leitura concluído com sucesso."
