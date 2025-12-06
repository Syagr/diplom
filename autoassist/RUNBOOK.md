# AutoAssist — Runbook (Windows-friendly)

End-to-end steps to run the full stack locally using Docker. Works on Windows with PowerShell and Docker Desktop.

## What this starts
- PostgreSQL 16, Redis 7, MinIO
- API (Node.js/Express, port 8080)
- One-off Prisma schema sync + seed
- Web SPA (Vite-built, served by Nginx on http://localhost:5174)
- Optional observability: Prometheus (19091), Loki (3100)

## Prerequisites
- Docker Desktop installed and running
- PowerShell terminal
- Optional: MetaMask in your browser; Polygon Amoy network set up (chainId 80002)

## Quick start

1) Clone and open the repo

2) (Optional) Configure environment
- Most values are already set for local. For Web3 verification you can set:
  - `WEB3_PROVIDER_URL`, `PLATFORM_RECEIVE_ADDRESS`, `USDC_TOKEN_ADDRESS`, `WEB3_ENFORCE_AMOUNT=false`
- You can place these in a `.env` at repo root or export in shell before `compose up`.

3) Start the stack (one command)

```powershell
# From the repo root
$dc = "c:/IT/projects/diplom/autoassist/infra/compose/docker-compose.yml"
docker compose -f $dc up -d
```

This will:
- Bring up db/redis/minio, set up MinIO bucket
- Run Prisma schema sync + seed once (`prisma-migrate` service)
- Build and start API and Web

4) Verify services

```powershell
# Health endpoint
curl http://localhost:8080/health

# Open web app
start http://localhost:5174
```

5) Run API integration tests (optional)

```powershell
# Runs inside compose network with seeded DB/MinIO/Redis
$dc = "c:/IT/projects/diplom/autoassist/infra/compose/docker-compose.yml"
docker compose -f $dc run --no-deps --rm api-tests
```

Expected: all suites pass.

6) Stop

```powershell
$dc = "c:/IT/projects/diplom/autoassist/infra/compose/docker-compose.yml"
docker compose -f $dc down
```

To reset data:
```powershell
$dc = "c:/IT/projects/diplom/autoassist/infra/compose/docker-compose.yml"
docker compose -f $dc down -v
```

## E2E smoke path (manual)
1) Auth via MetaMask
   - Connect wallet on the web app → backend issues nonce → sign → verify
   - If wrong chain, switch to Polygon Amoy (80002)
2) Create order
   - Use the “New Order” wizard: client data, vehicle, problem, up to 10 photos, pickup point on map
3) Auto-calc and lock estimate
   - Open the order → view estimate; lock before payment
4) Pay
   - Classic (mock) or Web3:
     - Web3: send tx with MetaMask (USDC/MATIC) → enter/confirm txHash if needed → server verifies with confirmations
5) Receipt
   - After success, open receipt (PDF via presigned URL). QR links to Polygonscan
6) Proof
   - Complete the order, then view /orders/:id/proof (proofHash + evidence)

## Useful paths
- Compose file: `autoassist/infra/compose/docker-compose.yml`
- API app: `autoassist/apps/api`
- Web app: `autoassist/apps/web`
- Test runner: `autoassist/apps/api/__tests__` + compose service `api-tests`
- Seed scripts: `autoassist/apps/api/prisma/seed.ts`, `autoassist/apps/api/scripts/seed-demo-orders.js`

## Troubleshooting
- Ports in use: adjust ports in compose (`8080`, `5174`, `12002`, `12003`, `19091`, `3100`).
- Prisma errors on first run: rerun the one-off service
  ```powershell
  $dc = "c:/IT/projects/diplom/autoassist/infra/compose/docker-compose.yml"
  docker compose -f $dc up --no-deps --force-recreate prisma-migrate
  ```
- MinIO bucket not found: the `minio-setup` service creates `attachments`. Recreate if needed.
- Web3 verification not configured: leave `WEB3_ENFORCE_AMOUNT=false` for tests and classic payments.

## Notes
- CORS allows http://localhost:5173 and http://localhost:5174 by default.
- API metrics: `http://localhost:8080/metrics` (Prometheus exposition).
- Sockets: user:{id}, order:{id}, dashboard.
