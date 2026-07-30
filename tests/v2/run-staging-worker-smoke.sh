#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PORT="${SITE_V2_STAGING_TEST_PORT:-8787}"
BASE_URL="http://127.0.0.1:${PORT}"
TOKEN="local-staging-token-0123456789abcdef"
IDEMPOTENCY_KEY="idem_smoke_0123456789abcdef"
CREATED_AT="2026-07-26T21:00:00.000Z"
LOG_FILE="/tmp/site-v2-staging-wrangler.log"
BODY_FILE="/tmp/site-v2-staging-body.json"
FIRST_FILE="/tmp/site-v2-staging-first.json"
REPLAY_FILE="/tmp/site-v2-staging-replay.json"
ORDER_FILE="/tmp/site-v2-staging-order.json"
OUTBOX_FILE="/tmp/site-v2-staging-outbox.json"
LOW_LEVEL_FILE="/tmp/site-v2-staging-low-level.json"
CONFIG_FILE="/tmp/site-v2-commercial-config.json"
CONFIG_UPDATE_FILE="/tmp/site-v2-commercial-config-update.json"
CONFIG_STALE_FILE="/tmp/site-v2-commercial-config-stale.json"
CONFIG_UNAUTHORIZED_FILE="/tmp/site-v2-commercial-unauthorized.json"

cleanup() {
  status=$?
  if [ -n "${WRANGLER_PID:-}" ] && kill -0 "$WRANGLER_PID" 2>/dev/null; then
    kill "$WRANGLER_PID" 2>/dev/null || true
    wait "$WRANGLER_PID" 2>/dev/null || true
  fi
  rm -f .dev.vars "$BODY_FILE" "$FIRST_FILE" "$REPLAY_FILE" "$ORDER_FILE" "$OUTBOX_FILE" "$LOW_LEVEL_FILE" "$CONFIG_FILE" "$CONFIG_UPDATE_FILE" "$CONFIG_STALE_FILE" "$CONFIG_UNAUTHORIZED_FILE"
  rm -rf .wrangler
  if [ "$status" -ne 0 ]; then
    echo "Falha no smoke test. Log do Wrangler:"
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
  "seller": {"id": "ana", "label": "Ana"},
  "customer": {"name": "Cliente Sintético do CI", "whatsapp": "5581999999999"},
  "items": [{
    "driveFileId": "staging-artwork-2657", "productKey": "50x50",
    "variantKey": "default", "sizeKey": "50x50", "quantity": 6,
    "unitPrice": 0.01, "lineSubtotal": 0.06
  }],
  "totals": {"subtotal": 0.06, "total": 0.06}
}
EOF

npx --yes wrangler@4.114.0 dev --local --config wrangler.site-v2-staging.jsonc --port "$PORT" > "$LOG_FILE" 2>&1 &
WRANGLER_PID=$!

for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error "$BASE_URL/health" > /tmp/site-v2-staging-health.json; then break; fi
  if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then echo "Wrangler encerrou antes de ficar pronto."; exit 1; fi
  sleep 1
  if [ "$attempt" -eq 60 ]; then echo "Worker local não ficou pronto."; exit 1; fi
done

node -e '
  const fs = require("fs");
  const health = JSON.parse(fs.readFileSync("/tmp/site-v2-staging-health.json", "utf8"));
  if (!health.ok || health.environment !== "staging") throw new Error("HEALTH_INVALID");
  if (health.writesEnabled !== true || health.lowLevelLedgerEnabled !== false) throw new Error("HEALTH_GUARDS_INVALID");
  if (health.persistence !== "durable-object-sqlite") throw new Error("PERSISTENCE_INVALID");
  if (health.commercialConfig?.enabled !== true) throw new Error("COMMERCIAL_CONFIG_HEALTH_MISSING");
'

curl --fail --silent --show-error "$BASE_URL/api/commercial-config" > "$CONFIG_FILE"
node -e '
  const fs=require("fs");const result=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  if(!result.ok||result.config?.version!==1)throw new Error("INITIAL_CONFIG_INVALID");
  if(result.config?.products?.["50x50"]?.unitPrice!==9.75)throw new Error("INITIAL_BOLINHAS_PRICE_INVALID");
  if(result.config?.products?.["painel-150"]?.unitPrice!==59.9)throw new Error("INITIAL_PAINEL_PRICE_INVALID");
' "$CONFIG_FILE"

UNAUTHORIZED_STATUS=$(curl --silent --show-error --output "$CONFIG_UNAUTHORIZED_FILE" --write-out '%{http_code}' "$BASE_URL/internal/v2/admin/commercial-config")
if [ "$UNAUTHORIZED_STATUS" != "401" ]; then echo "Configuração administrativa sem token retornou HTTP $UNAUTHORIZED_STATUS"; exit 1; fi

CONFIG_UPDATE_STATUS=$(curl --silent --show-error --output "$CONFIG_UPDATE_FILE" --write-out '%{http_code}' \
  --request PUT --header 'Content-Type: application/json' --header "X-Staging-Token: $TOKEN" \
  --data-binary '{"expectedVersion":1,"config":{"products":{"50x50":{"unitPrice":10.25,"minimum":6,"step":2,"initialQuantity":6},"painel-150":{"unitPrice":65,"minimum":1,"step":1,"initialQuantity":1}}}}' \
  "$BASE_URL/internal/v2/admin/commercial-config")
if [ "$CONFIG_UPDATE_STATUS" != "200" ]; then cat "$CONFIG_UPDATE_FILE"; exit 1; fi
node -e '
  const fs=require("fs");const result=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  if(!result.ok||result.config?.version!==2)throw new Error("CONFIG_VERSION_NOT_INCREMENTED");
  if(result.config?.products?.["50x50"]?.unitPrice!==10.25)throw new Error("UPDATED_PRICE_INVALID");
' "$CONFIG_UPDATE_FILE"

CONFIG_STALE_STATUS=$(curl --silent --show-error --output "$CONFIG_STALE_FILE" --write-out '%{http_code}' \
  --request PUT --header 'Content-Type: application/json' --header "X-Staging-Token: $TOKEN" \
  --data-binary '{"expectedVersion":1,"config":{"products":{"50x50":{"unitPrice":11,"minimum":6,"step":2,"initialQuantity":6},"painel-150":{"unitPrice":65,"minimum":1,"step":1,"initialQuantity":1}}}}' \
  "$BASE_URL/internal/v2/admin/commercial-config")
if [ "$CONFIG_STALE_STATUS" != "409" ]; then cat "$CONFIG_STALE_FILE"; exit 1; fi
node -e '
  const fs=require("fs");const result=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  if(result.error!=="COMMERCIAL_CONFIG_VERSION_CONFLICT"||result.currentVersion!==2)throw new Error("STALE_CONFIG_GUARD_INVALID");
' "$CONFIG_STALE_FILE"

FIRST_STATUS=$(curl --silent --show-error --output "$FIRST_FILE" --write-out '%{http_code}' --request POST \
  --header 'Content-Type: application/json' --header "X-Staging-Token: $TOKEN" --header "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data-binary "@$BODY_FILE" "$BASE_URL/internal/v2/orders/submit")
if [ "$FIRST_STATUS" != "201" ]; then echo "Primeira submissão retornou HTTP $FIRST_STATUS"; cat "$FIRST_FILE"; exit 1; fi

ORDER_NUMBER=$(node -e '
  const fs=require("fs");const result=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  if(!result.ok||result.action!=="CREATED"||result.replayed!==false)throw new Error("FIRST_SUBMISSION_INVALID");
  if(result.orderNumber!=="PED2600001A")throw new Error(`ORDER_NUMBER_INVALID:${result.orderNumber}`);
  if(result.pricing?.total!==61.5)throw new Error(`SERVER_TOTAL_INVALID:${result.pricing?.total}`);
  if(result.configVersion!==2)throw new Error(`CONFIG_VERSION_INVALID:${result.configVersion}`);
  if(!result.warnings?.includes("CLIENT_ITEM_PRICE_IGNORED"))throw new Error("CLIENT_PRICE_WARNING_MISSING");
  process.stdout.write(result.orderNumber);
' "$FIRST_FILE")

REPLAY_STATUS=$(curl --silent --show-error --output "$REPLAY_FILE" --write-out '%{http_code}' --request POST \
  --header 'Content-Type: application/json' --header "X-Staging-Token: $TOKEN" --header "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data-binary "@$BODY_FILE" "$BASE_URL/internal/v2/orders/submit")
if [ "$REPLAY_STATUS" != "200" ]; then cat "$REPLAY_FILE"; exit 1; fi
node -e '
  const fs=require("fs");const first=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const replay=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
  if(!replay.ok||replay.action!=="REPLAY"||replay.orderNumber!==first.orderNumber)throw new Error("REPLAY_INVALID");
  if(replay.configVersion!==2||replay.pricing?.total!==61.5)throw new Error("REPLAY_COMMERCIAL_VERSION_INVALID");
' "$FIRST_FILE" "$REPLAY_FILE"

LOW_LEVEL_STATUS=$(curl --silent --show-error --output "$LOW_LEVEL_FILE" --write-out '%{http_code}' --request POST --header "X-Staging-Token: $TOKEN" "$BASE_URL/internal/v2/ledger/submit")
if [ "$LOW_LEVEL_STATUS" != "503" ]; then cat "$LOW_LEVEL_FILE"; exit 1; fi

ENCODED_CREATED_AT=$(node -p 'encodeURIComponent(process.argv[1])' "$CREATED_AT")
curl --fail --silent --show-error --header "X-Staging-Token: $TOKEN" "$BASE_URL/internal/v2/ledger/order?number=$ORDER_NUMBER&createdAt=$ENCODED_CREATED_AT" > "$ORDER_FILE"
curl --fail --silent --show-error --header "X-Staging-Token: $TOKEN" "$BASE_URL/internal/v2/ledger/outbox?createdAt=$ENCODED_CREATED_AT" > "$OUTBOX_FILE"

node -e '
  const fs=require("fs");const orderResult=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const outboxResult=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
  if(!orderResult.ok||orderResult.order?.orderNumber!=="PED2600001A")throw new Error("ORDER_QUERY_INVALID");
  if(orderResult.order?.items?.[0]?.driveFileId!=="staging-artwork-2657")throw new Error("DRIVE_FILE_ID_LOST");
  if(orderResult.order?.integrity?.configVersion!==2)throw new Error("ORDER_CONFIG_VERSION_LOST");
  if(orderResult.order?.pricing?.total!==61.5)throw new Error("ORDER_COMMERCIAL_TOTAL_LOST");
  if(orderResult.order?.customer?.redacted!==true)throw new Error("ORDER_CUSTOMER_NOT_REDACTED");
  if(!outboxResult.ok||outboxResult.events?.length!==1)throw new Error("OUTBOX_COUNT_INVALID");
' "$ORDER_FILE" "$OUTBOX_FILE"

echo "Smoke test do staging concluído com sucesso."
