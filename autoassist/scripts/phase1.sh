#!/usr/bin/env bash
set -euo pipefail

# ====== 0) Предусловия ======
# Ожидается, что .env лежит в apps/api/.env и содержит DATABASE_URL, MINIO_*, REDIS_*, PORT
# Если .env нет, раскомментируй следующую строку и подставь URL вручную:
# export DATABASE_URL="postgresql://USER:PASS@HOST:5432/DBNAME?schema=public"

echo "[I] Phase 1: Core backend bring-up (Bash)"

# ====== 1) Поднять локальную инфру ======
echo "[I] docker compose up db redis minio ..."
docker compose up -d db redis minio
docker compose ps

# ====== 2) Prisma: generate + migrate + validate ======
echo "[I] prisma generate/migrate/validate ..."
pushd apps/api >/dev/null
npx prisma generate
# прод-стиль применения миграций; для локальной разработки можешь заменить на `npx prisma migrate dev --name phase1_init`
npx prisma migrate deploy
npx prisma validate

# ====== 3) TypeScript check ======
echo "[I] TypeScript check ..."
npx tsc --noEmit

# ====== 4) Запуск API (dev) ======
echo "[I] starting API (dev) ..."
# при необходимости замени на npm run dev
pnpm run dev &

API_PID=$!
sleep 3
echo "[I] API pid=$API_PID"

# ====== 5) Смоук-тесты (attachments/orders/estimates/payments) ======
HOST="http://localhost:${PORT:-3000}"
ORDER_ID="${ORDER_ID:-1}"              # при необходимости задай свои значения
ATT_FILE="${ATT_FILE:-./left-door.jpg}"

echo "[I] Smoke: attachments presign-upload ..."
RESP=$(curl -sS -X POST "$HOST/api/attachments/presign-upload" \
  -H "Content-Type: application/json" \
  -d "{\"orderId\": ${ORDER_ID}, \"fileName\": \"left-door.jpg\", \"contentType\": \"image/jpeg\", \"size\": 5242880, \"kind\": \"photo\"}")

ATT_ID=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{let j=JSON.parse(d);console.log(j.attachmentId||'');}catch{console.log('');}})")
PUT_URL=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{let j=JSON.parse(d);console.log(j.putUrl||'');}catch{console.log('');}})")
test -n "$ATT_ID" && test -n "$PUT_URL" || { echo "[E] presign-upload failed"; kill $API_PID; exit 1; }

echo "[I] Smoke: PUT upload to MinIO ..."
curl -sS -X PUT "$PUT_URL" -H "Content-Type: image/jpeg" --data-binary "@${ATT_FILE}" >/dev/null

echo "[I] Smoke: attachments complete ..."
curl -sS -X POST "$HOST/api/attachments/${ATT_ID}/complete" >/dev/null

echo "[I] Smoke: attachments presign GET ..."
curl -sS "$HOST/api/attachments/${ATT_ID}/presign" | head -c 200 && echo

echo "[I] Smoke: orders list ..."
curl -sS "$HOST/api/orders" | head -c 200 && echo

echo "[I] Smoke: estimates upsert ..."
curl -sS -X POST "$HOST/api/estimates" -H "Content-Type: application/json" \
  -d "{\"orderId\": ${ORDER_ID}, \"items\": [{\"code\":\"P-001\",\"title\":\"Front glass\",\"qty\":1,\"unitPrice\":1000,\"kind\":\"part\",\"supplier\":\"original\"},{\"code\":\"L-001\",\"title\":\"Labor\",\"qty\":2,\"unitPrice\":300,\"kind\":\"labor\"}], \"currency\":\"UAH\", \"validDays\":7, \"discount\":5 }" \
  | head -c 200 && echo

echo "[I] Smoke: payments create invoice ..."
curl -sS -X POST "$HOST/api/payments/invoice" -H "Content-Type: application/json" \
  -d "{\"orderId\": ${ORDER_ID}, \"amount\": 1200, \"purpose\": \"REPAIR\", \"provider\":\"LIQPAY\"}" \
  | head -c 200 && echo

echo "[I] Phase 1 OK"
# оставляем API в фоне; снимай вручную при необходимости
# kill $API_PID
popd >/dev/null
