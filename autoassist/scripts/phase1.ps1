#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

Write-Host "[I] Phase 1: Core backend bring-up (PowerShell)"

# 0) Предусловия
# Если apps/api/.env содержит DATABASE_URL — ничего не делаем.
# Иначе можешь раскомментировать:
# $env:DATABASE_URL = "postgresql://USER:PASS@HOST:5432/DBNAME?schema=public"

# 1) Инфра
docker compose up -d db redis minio
docker compose ps

# 2) Prisma
Set-Location apps/api
npx prisma generate
npx prisma migrate deploy
npx prisma validate

# 3) TS check
npx tsc --noEmit

# 4) Запуск API
# при необходимости замени на npm run dev
Start-Process -FilePath "pnpm" -ArgumentList "run","dev" -NoNewWindow
Start-Sleep -Seconds 3

$PORT = if ($env:PORT) { $env:PORT } else { 3000 }
$HOST = "http://localhost:$PORT"
$ORDER_ID = if ($env:ORDER_ID) { $env:ORDER_ID } else { 1 }
$ATT_FILE = if ($env:ATT_FILE) { $env:ATT_FILE } else { ".\left-door.jpg" }

# 5) Смоук-тесты
Write-Host "[I] Smoke: attachments presign-upload ..."
$resp = curl -sS -X POST "$HOST/api/attachments/presign-upload" `
  -H "Content-Type: application/json" `
  -d "{`"orderId`": $ORDER_ID, `"fileName`": `"left-door.jpg`", `"contentType`": `"image/jpeg`", `"size`": 5242880, `"kind`": `"photo`"}" | Select-Object -ExpandProperty Content

$attId = node -e "const j=JSON.parse(process.argv[1]||'{}');console.log(j.attachmentId||'')" "$resp"
$putUrl = node -e "const j=JSON.parse(process.argv[1]||'{}');console.log(j.putUrl||'')" "$resp"
if (-not $attId -or -not $putUrl) { throw "[E] presign-upload failed" }

Write-Host "[I] Smoke: PUT upload to MinIO ..."
curl -sS -X PUT "$putUrl" -H "Content-Type: image/jpeg" --data-binary "@$ATT_FILE" | Out-Null

Write-Host "[I] Smoke: attachments complete ..."
curl -sS -X POST "$HOST/api/attachments/$attId/complete" | Out-Null

Write-Host "[I] Smoke: attachments presign GET ..."
curl -sS "$HOST/api/attachments/$attId/presign" | Select-Object -First 1

Write-Host "[I] Smoke: orders list ..."
curl -sS "$HOST/api/orders" | Select-Object -First 1

Write-Host "[I] Smoke: estimates upsert ..."
curl -sS -X POST "$HOST/api/estimates" -H "Content-Type: application/json" `
  -d "{`"orderId`": $ORDER_ID, `"items`": [{`"code`":`"P-001`",`"title`":`"Front glass`",`"qty`":1,`"unitPrice`":1000,`"kind`":`"part`",`"supplier`":`"original`"},{`"code`":`"L-001`",`"title`":`"Labor`",`"qty`":2,`"unitPrice`":300,`"kind`":`"labor`"}], `"currency`":`"UAH`", `"validDays`":7, `"discount`":5 }" `
  | Select-Object -First 1

Write-Host "[I] Smoke: payments create invoice ..."
curl -sS -X POST "$HOST/api/payments/invoice" -H "Content-Type: application/json" `
  -d "{`"orderId`": $ORDER_ID, `"amount`": 1200, `"purpose`": `"REPAIR`", `"provider`":`"LIQPAY`"}" `
  | Select-Object -First 1

Write-Host "[I] Phase 1 OK"
