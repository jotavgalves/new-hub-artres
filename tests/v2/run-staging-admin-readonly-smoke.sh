#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PORT="${SITE_V2_STAGING_ADMIN_TEST_PORT:-8791}"
BASE_URL="http://127.0.0.1:${PORT}"
TOKEN="local-staging-token-0123456789abcdef"
CREATED_AT="2026-07-27T17:30:00.000Z"
IDEMPOTENCY_KEY="admin_smoke_0123456789abcdef"
SECOND_IDEMPOTENCY_KEY="admin_smoke_second_0123456789abcdef"
LOG_FILE="/tmp/site-v2-staging-admin-wrangler.log"
BODY_FILE="/tmp/site-v2-staging-admin-body.json"
ADMIN_HTML_FILE="/tmp/site-v2-staging-admin.html"
ADMIN_SCRIPT_FILE="/tmp/site-v2-staging-admin.js"
ADMIN_UNAUTH_FILE="/tmp/site-v2-staging-admin-unauth.json"
ADMIN_DATA_FILE="/tmp/site-v2-staging-admin-data.json"
ADMIN_DATA_2_FILE="/tmp/site-v2-staging-admin-data-2.json"
ADMIN_HEADERS_FILE="/tmp/site-v2-staging-admin-headers.txt"
ADMIN_HEADERS_2_FILE="/tmp/site-v2-staging-admin-headers-2.txt"
STREAM_FILE="/tmp/site-v2-staging-admin-stream.txt"

cleanup() {
  status=$?
  if [ -n "${STREAM_PID:-}" ] && kill -0 "$STREAM_PID" 2>/dev/null; then
    kill "$STREAM_PID" 2>/dev/null || true
    wait "$STREAM_PID" 2>/dev/null || true
  fi
  if [ -n "${WRANGLER_PID:-}" ] && kill -0 "$WRANGLER_PID" 2>/dev/null; then
    kill "$WRANGLER_PID" 2>/dev/null || true
    wait "$WRANGLER_PID" 2>/dev/null || true
  fi
  rm -f .dev.vars "$BODY_FILE" "$ADMIN_HTML_FILE" "$ADMIN_SCRIPT_FILE" \
    "$ADMIN_UNAUTH_FILE" "$ADMIN_DATA_FILE" "$ADMIN_DATA_2_FILE" \
    "$ADMIN_HEADERS_FILE" "$ADMIN_HEADERS_2_FILE" "$STREAM_FILE"
  rm -rf .wrangler
  if [ "$status" -ne 0 ]; then
    echo "Falha no smoke do painel administrativo."
    cat "$LOG_FILE" 2>/dev/null || true
    cat "$STREAM_FILE" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT

rm -rf .wrangler
cat > .dev.vars <<EOF_VARS
STAGING_API_TOKEN="$TOKEN"
STAGING_WRITE_ENABLED="true"
EOF_VARS

cat > "$BODY_FILE" <<EOF_BODY
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
EOF_BODY

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
grep -q "Última atualização" "$ADMIN_HTML_FILE"
grep -q "live-badge" "$ADMIN_HTML_FILE"

curl --fail --silent --show-error "$BASE_URL/admin/app.js" > "$ADMIN_SCRIPT_FILE"
grep -q "sessionStorage" "$ADMIN_SCRIPT_FILE"
grep -q "If-None-Match" "$ADMIN_SCRIPT_FILE"
grep -q "/internal/v2/admin/orders/stream" "$ADMIN_SCRIPT_FILE"
if grep -q "localStorage" "$ADMIN_SCRIPT_FILE"; then exit 1; fi

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
  --dump-header "$ADMIN_HEADERS_FILE" \
  --header "X-Staging-Token: $TOKEN" \
  "$BASE_URL/internal/v2/admin/orders?limit=50" \
  > "$ADMIN_DATA_FILE"

ETAG=$(awk 'BEGIN{IGNORECASE=1} /^etag:/ {sub(/^[^:]+:[[:space:]]*/, ""); gsub(/\r/, ""); print; exit}' "$ADMIN_HEADERS_FILE")
if [ -z "$ETAG" ]; then exit 1; fi

node -e '
  const fs = require("fs");
  const result = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!result.ok || result.readOnly !== true) throw new Error("ADMIN_NOT_READ_ONLY");
  if (result.catalog !== "synthetic-staging-only" || result.catalogVersion !== 9001) throw new Error("ADMIN_CATALOG_INVALID");
  if (result.summary?.orderCount !== 1) throw new Error("ADMIN_ORDER_COUNT_INVALID");
  if (result.summary?.totalValue !== 58.5) throw new Error("ADMIN_TOTAL_INVALID");
  if (result.summary?.itemQuantity !== 6) throw new Error("ADMIN_ITEM_QUANTITY_INVALID");
  if (result.orders?.length !== 1) throw new Error("ADMIN_ORDERS_INVALID");
  if (!Number.isInteger(result.revision) || result.revision < 1) throw new Error("ADMIN_REVISION_INVALID");
  if (!Number.isFinite(new Date(result.updatedAt).getTime())) throw new Error("ADMIN_UPDATED_AT_INVALID");
  if (result.orders[0]?.customer?.redacted !== true) throw new Error("ADMIN_CUSTOMER_NOT_REDACTED");
  if (Object.hasOwn(result.orders[0]?.customer || {}, "whatsapp")) throw new Error("ADMIN_PHONE_EXPOSED");
  if (result.orders[0]?.items?.[0]?.driveFileId !== "staging-artwork-2657") throw new Error("ADMIN_ARTWORK_INVALID");
' "$ADMIN_DATA_FILE"

NOT_MODIFIED_STATUS=$(curl --silent --show-error \
  --output /dev/null \
  --write-out '%{http_code}' \
  --header "X-Staging-Token: $TOKEN" \
  --header "If-None-Match: $ETAG" \
  "$BASE_URL/internal/v2/admin/orders?limit=50")
if [ "$NOT_MODIFIED_STATUS" != "304" ]; then exit 1; fi

(timeout 12s curl --silent --show-error --no-buffer \
  --header 'Accept: text/event-stream' \
  --header "X-Staging-Token: $TOKEN" \
  "$BASE_URL/internal/v2/admin/orders/stream" > "$STREAM_FILE") &
STREAM_PID=$!

for attempt in $(seq 1 40); do
  if grep -q "event: ready" "$STREAM_FILE" 2>/dev/null; then break; fi
  if ! kill -0 "$STREAM_PID" 2>/dev/null; then exit 1; fi
  sleep 0.25
  if [ "$attempt" -eq 40 ]; then exit 1; fi
done

curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --header "X-Staging-Token: $TOKEN" \
  --header "Idempotency-Key: $SECOND_IDEMPOTENCY_KEY" \
  --data-binary "@$BODY_FILE" \
  "$BASE_URL/internal/v2/orders/submit" >/dev/null

for attempt in $(seq 1 40); do
  if grep -q "event: revision" "$STREAM_FILE" 2>/dev/null; then break; fi
  if ! kill -0 "$STREAM_PID" 2>/dev/null; then exit 1; fi
  sleep 0.25
  if [ "$attempt" -eq 40 ]; then exit 1; fi
done

UPDATED_STATUS=$(curl --silent --show-error \
  --dump-header "$ADMIN_HEADERS_2_FILE" \
  --output "$ADMIN_DATA_2_FILE" \
  --write-out '%{http_code}' \
  --header "X-Staging-Token: $TOKEN" \
  --header "If-None-Match: $ETAG" \
  "$BASE_URL/internal/v2/admin/orders?limit=50")
if [ "$UPDATED_STATUS" != "200" ]; then exit 1; fi

node -e '
  const fs = require("fs");
  const first = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const second = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (second.summary?.orderCount !== 2) throw new Error("ADMIN_LIVE_ORDER_COUNT_INVALID");
  if (second.orders?.length !== 2) throw new Error("ADMIN_LIVE_ORDERS_INVALID");
  if (!(second.revision > first.revision)) throw new Error("ADMIN_REVISION_NOT_ADVANCED");
' "$ADMIN_DATA_FILE" "$ADMIN_DATA_2_FILE"

POST_STATUS=$(curl --silent --show-error \
  --output /tmp/site-v2-staging-admin-post.json \
  --write-out '%{http_code}' \
  --request POST \
  --header "X-Staging-Token: $TOKEN" \
  "$BASE_URL/internal/v2/admin/orders")
if [ "$POST_STATUS" != "405" ]; then exit 1; fi
rm -f /tmp/site-v2-staging-admin-post.json

echo "Smoke do painel administrativo com cache e atualização ao vivo concluído com sucesso."
