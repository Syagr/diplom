# AutoAssist+ Platform Monorepo

A comprehensive decentralized insurance-service platform for automotive assistance, combining Web3 technologies, biometric authentication, and gamification, with access via Web only.

## 🚀 Структура монорепозитория

```
autoassist/
├─ apps/
│  ├─ web/                # React (Vite + TypeScript) SPA
│  ├─ api/                # Node.js (Express + Prisma) REST + WebSocket
│  
├─ web3/
│  ├─ contracts/          # Solidity (Hardhat) + NFT-паспорт + платежи
│  └─ sdk/                # JS SDK для интеграции Web3
├─ packages/
│  ├─ shared/             # Общие TypeScript типы и утилиты
│  └─ config/             # Общие конфиги (eslint, tsconfig, prettier)
├─ infra/
│  ├─ docker/             # Dockerfiles
│  ├─ compose/            # docker-compose.*.yml
│  └─ migrations/         # SQL миграции (если нужно)
└─ README.md
```

## 🔑 Уникальные фичи

### 1. Blockchain / Web3
- **Smart-contract** для оплаты ремонта и страховки (Polygon/ETH testnet)
- **NFT-паспорт авто**: история ремонтов, страховок и эвакуаторных вызовов

### 2. Геймификация + доверие
- Баллы лояльности за своевременную оплату и покупку страховки
- Achievement board: "5 лет без ДТП", "ТО вовремя 3 раза подряд"
- Рейтинг клиентов и сервисов

### 3. Персонализированные страховые продукты
- Анализ истории поломок + стиля езды (телематика/OBD-II)
- Генерация кастомных пакетов на основе рисков

### 4. Биометрия и безопасность
- Авторизация через Face ID / WebAuthn
- Подтверждение выдачи авто: QR-код + распознавание лица

### 5. Умный прайсинг запчастей
- Подбор деталей через маркетплейсы (API поставщиков)
- Сравнение цены: "оригинал" vs "аналог дешевле"

## 📲 Каналы

- **Web**: Полнофункциональное приложение с Web3-платежами и мониторингом

## 🛠️ Быстрый старт

### 1. Установка зависимостей
```bash
# Убедитесь, что у вас установлен Node.js 20+ и включен corepack
corepack enable
pnpm install
```

### 2. Настройка окружения
```bash
# Скопируйте и настройте переменные окружения
cp .env.example .env
# Отредактируйте .env согласно вашим настройкам
```

### 3. Запуск инфраструктуры
```bash
# Поднимает PostgreSQL, Redis, MinIO
pnpm start:infra
```

### 4. Настройка базы данных
```bash
# Генерация Prisma клиента и применение схемы
pnpm db:generate
pnpm db:push
```

### 5. Запуск всех сервисов
```bash
# Запускает API и Web в dev режиме
pnpm dev
```

## 🌐 Доступ к сервисам

- **Web**: http://localhost:5173
- **API**: http://localhost:8080/health
- **MinIO S3 API**: http://localhost:12002
- **MinIO Console**: http://localhost:12003 (minioadmin/minioadmin123)
- **Prometheus**: http://localhost:19091
- **Loki**: http://localhost:3100

> Примечание: в Docker Compose также поднимаются сервисы `api` и `web`. SPA отдаётся nginx на 5173 и проксирует `/api` и `/socket.io` на API контейнер.

## 🔐 Аутентификация: SIWE (EIP-4361)

- Эндпоинт: `POST /api/wallet/verify`
- Принимает два формата:
	- Простой: `{ address, signature }` (подпись nonce)
	- SIWE: `{ siweMessage, signature }` (каноничное сообщение EIP-4361)
- Переменные окружения ожиданий:
	- `EXPECTED_SIWE_DOMAIN` (по умолчанию `localhost`)
	- `EXPECTED_SIWE_URI_PREFIX` (по умолчанию `http://localhost`)
	- `EXPECTED_SIWE_CHAIN_ID` (например `80002` для Polygon Amoy)
- Ответ: пара токенов `{ access, refresh }`.

Пример SIWE-сообщения и схемы запроса/ответа описаны в `apps/api/src/openapi.json`.

Примеры запросов:

1) Простой (nonce-подпись)

```json
{
	"address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
	"signature": "0xabcdef...",
	"chainId": 80002
}
```

2) SIWE

```json
{
	"siweMessage": "localhost wants you to sign in with your Ethereum account:\n0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48\n\nURI: http://localhost/login\nVersion: 1\nChain ID: 80002\nNonce: 0x53c1f2d7a1\nIssued At: 2025-10-22T10:00:00Z",
	"signature": "0xdeadbeef..."
}
```

## 🏗️ Архитектура

- **Backend**: Node.js (Express/Prisma), PostgreSQL, Redis
- **Frontend**: React (Vite), TypeScript, Socket.IO
- **Web3**: Hardhat, Polygon testnet, ethers.js
- **DevOps**: Docker Compose, pnpm workspace

## 📋 Разработка

### Работа с базой данных
```bash
pnpm db:migrate     # Создать новую миграцию
pnpm db:push        # Применить изменения схемы
```

### Работа с контрактами
```bash
pnpm contracts:compile  # Компиляция Solidity
pnpm contracts:test     # Тестирование контрактов
pnpm contracts:deploy   # Деплой в testnet
```

### Линтинг и форматирование
```bash
pnpm lint      # Проверка всех пакетов
pnpm format    # Форматирование кода
```

## 🎯 Следующие шаги

1. **Настройте Web3**: создайте аккаунт в Infura для Polygon
2. **Добавьте детали**: эндпоинты для attachment, insurance offers, tow requests

---

**AutoAssist+** — это не просто CRM, а InsurTech Web3-платформа для автосервиса с доверием, прозрачностью и геймификацией! 🚗⛓️✨