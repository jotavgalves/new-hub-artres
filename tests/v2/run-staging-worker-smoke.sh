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

cleanup() {
  status=$?
  if [ -n "${WRANGLER_PID:-}" ] && kill -0 "$WRANGLER_PID" 2>/dev/null; then
    kill "$WRANGLER_PID" 2>/dev/null || true
    wait "$WRANGLER_PID" 2>/dev/null || true
  fi
  rm -f .dev.vars "$BODY_FILE" "$FIRST_FILE" "$REPLAY_FILE" "$ORDER_FILE" "$OUTBOX_FILE"
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
  "seller": {
    "id": "ana",
    "label": "Ana"
  },
  "customer": {
    "name": "Cliente Sintético do CI",
    "whatsapp": "5581999999999"
  },
  "items": [
    {
      "driveFileId": "staging-artwork-2657",
      "productKey": "50x50",
      "variantKey": "default",
      "sizeKey": "50x50",
      "quantity": 6,
      "unitPrice": 0.01,
      "lineSubtotal": 0.06
    }
  ],
  "totals": {
    "subtotal": 0.06,
    "total": 0.06
  }
}
EOF

npx --yes wrangler@4.114.0 dev \
  --local \
  --config wrangler.site-v2-staging.jsonc \
  --port "$PORT" \
  > "$LOG_FILE" 2>&1 &
WRANGLER_PID=$!

for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error "$BASE_URL/health" > /tmp/site-v2-staging-health.json; then
    break
  fi
  if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
    echo "Wrangler encerrou antes de ficar pronto."
    exit 1
  fi
  sleep 1
  if [ "$attempt" -eq 60 ]; then
    echo "Worker local não ficou pronto."
    exit 1
  fi
done

node -e '
  const fs = require("fs");
  const health = JSON.parse(fs.readFileSync("/tmp/site-v2-staging-health.json", "utf8"));
  if (!health.ok) throw new Error("HEALTH_NOT_OK");
  if (health.environment !== "staging") throw new Error("ENVIRONMENT_NOT_STAGING");
  if (health.writesEnabled !== true) throw new Error("LOCAL_WRITES_NOT_ENABLED");
  if (health.persistence !== "durable-object-sqlite") throw new Error("PERSISTENCE_INVALID");
  if (health.catalog !== "synthetic-staging-only") throw new Error("CATALOG_NOT_SYNTHETIC");
'

FIRST_STATUS=$(curl --silent --show-error \
  --output "$FIRST_FILE" \
  --write-out '%{http_code}' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header "X-Staging-Token: $TOKEN" \
  --header "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data-binary "@$BODY_FILE" \
  "$BASE_URL/internal/v2/orders/submit")

if [ "$FIRST_STATUS" != "201" ]; then
  echo "Primeira submissão retornou HTTP $FIRST_STATUS"
  cat "$FIRST_FILE"
  exit 1
fi

ORDER_NUMBER=$(node -e '
  const fs = require("fs");
  const result = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!result.ok || result.action !== "CREATED" || result.replayed !== false) throw new Error("FIRST_SUBMISSION_INVALID");
  if (result.orderNumber !== "PED2600001A") throw new Error(`ORDER_NUMBER_INVALID:${result.orderNumber}`);
  if (result.pricing?.total !== 58.5) throw new Error(`SERVER_TOTAL_INVALID:${result.pricing?.total}`);
  if (result.itemCount !== 1) throw new Error("ITEM_COUNT_INVALID");
  if (!result.warnings?.includes("CLIENT_ITEM_PRICE_IGNORED:staging-artwork-2657")) throw new Error("CLIENT_PRICE_WARNING_MISSING");
  if (!result.warnings?.includes("CLIENT_ORDER_TOTALS_IGNORED")) throw new Error("CLIENT_TOTAL_WARNING_MISSING");
  process.stdout.write(result.orderNumber);
' "$FIRST_FILE")

REPLAY_STATUS=$(curl --silent --show-error \
  --output "$REPLAY_FILE" \
  --write-out '%{http_code}' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header "X-Staging-Token: $TOKEN" \
  --header "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data-binary "@$BODY_FILE" \
  "$BASE_URL/internal/v2/orders/submit")

if [ "$REPLAY_STATUS" != "200" ]; then
  echo "Replay retornou HTTP $REPLAY_STATUS"
  cat "$REPLAY_FILE"
  exit 1
fi

node -e '
  const fs = require("fs");
  const first = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const replay = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (!replay.ok || replay.action !== "REPLAY" || replay.replayed !== true) throw new Error("REPLAY_INVALID");
  if (replay.orderNumber !== first.orderNumber) throw new Error("REPLAY_ORDER_NUMBER_CHANGED");
' "$FIRST_FILE" "$REPLAY_FILE"

ENCODED_CREATED_AT=$(node -p 'encodeURIComponent(process.argv[1])' "$CREATED_AT")
curl --fail --silent --show-error \
  --header "X-Staging-Token: $TOKEN" \
  "$BASE_URL/internal/v2/ledger/order?number=$ORDER_NUMBER&createdAt=$ENCODED_CREATED_AT" \
  > "$ORDER_FILE"

curl --fail --silent --show-error \
  --header "X-Staging-Token: $TOKEN" \
  "$BASE_URL/internal/v2/ledger/outbox?createdAt=$ENCODED_CREATED_AT" \
  > "$OUTBOX_FILE"

node -e '
  const fs = require("fs");
  const orderResult = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const outboxResult = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (!orderResult.ok || orderResult.order?.orderNumber !== "PED2600001A") throw new Error("ORDER_QUERY_INVALID");
  if (orderResult.order?.items?.[0]?.driveFileId !== "staging-artwork-2657") throw new Error("DRIVE_FILE_ID_LOST");
  if (orderResult.order?.pricing?.total !== 58.5) throw new Error("ORDER_TOTAL_INVALID");
  if (!outboxResult.ok || outboxResult.events?.length !== 1) throw new Error("OUTBOX_COUNT_INVALID");
  if (outboxResult.events[0]?.eventType !== "order.created.v2") throw new Error("OUTBOX_EVENT_INVALID");
  if (outboxResult.events[0]?.aggregateId !== "PED2600001A") throw new Error("OUTBOX_AGGREGATE_INVALID");
' "$ORDER_FILE" "$OUTBOX_FILE"

echo "Smoke test do staging concluído com sucesso."
