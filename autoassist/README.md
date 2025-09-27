# AutoAssist+ Platform Monorepo

A comprehensive decentralized insurance-service platform for automotive assistance, combining Web3 technologies, biometric authentication, gamification, and multi-channel access (Web, Mobile, Telegram Bot).

## 🚀 Структура монорепозитория

```
autoassist/
├─ apps/
│  ├─ web/                # React (Vite + TypeScript) SPA
│  ├─ api/                # Node.js (Express + Prisma) REST + WebSocket
│  ├─ bot/                # Telegram Bot (telegraf) + WebApp
│  └─ mobile/             # Android (Kotlin) приложение
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

- **Web**: Полнофункциональное приложение с live-осмотром (WebRTC)
- **Mobile**: Быстрый флоу "на дороге" с VIN-сканом и push-уведомлениями
- **Telegram**: Мгновенный вход без регистрации + WebApp для детальных операций

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
# Запускает API, Web, Bot в dev режиме
pnpm dev
```

## 🌐 Доступ к сервисам

- **Web**: http://localhost:5173
- **API**: http://localhost:8080/health
- **MinIO Console**: http://localhost:12003 (admin/admin)
- **Bot**: Автоматически подключается к Telegram API

## 🏗️ Архитектура

- **Backend**: Node.js (Express/Prisma), PostgreSQL, Redis
- **Frontend**: React (Vite), TypeScript, Socket.IO
- **Web3**: Hardhat, Polygon testnet, ethers.js
- **Mobile**: Android (Kotlin), CameraX, FCM
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

1. **Настройте Telegram Bot**: получите токен от @BotFather
2. **Настройте Web3**: создайте аккаунт в Infura для Polygon
3. **Настройте Mobile**: добавьте Firebase проект для FCM
4. **Добавьте детали**: эндпоинты для attachment, insurance offers, tow requests

---

**AutoAssist+** — это не просто CRM, а InsurTech Web3-платформа для автосервиса с доверием, прозрачностью и геймификацией! 🚗⛓️✨