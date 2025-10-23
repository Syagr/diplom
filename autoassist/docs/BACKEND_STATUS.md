# Бэкенд: статус по факту (demo‑ready) и что осталось

Этот документ фиксирует соответствие реализованной серверной части требованиям диплома, ссылки на ключевые файлы, и короткий список оставшихся задач до «идеально».

## Что должно быть по ТЗ (бекенд)
- Регистрация/Вход
  - Email/пароль и вход через Web3‑кошелёк (MetaMask): nonce + подпись, SIWE
- Создание заявки
  - Клиентские данные, авто, фото, геолокация; заявка в статусе NEW; таймлайн
- Автоматическая калькуляция
  - Профили коэффициентов (ECONOMY/STANDARD/PREMIUM), динамика цены, lock перед оплатой
- Гео‑подбор сервисов
  - Поиск ближайших по lat/lng (Haversine), видимые предложения партнёров
- Оплата
  - Классическая (тестовая) и Web3 (Polygon Amoy), txHash, проверка по RPC
- Подтверждение и PDF‑чек
  - Генерация PDF с QR на Polygonscan, загрузка в MinIO, ссылка для клиента
- Завершение работ и proof‑hash
  - Фото/координаты/время → SHA‑256 от канонического JSON, сохранение, верификация
- Нотификации
  - In‑app (Socket.io) и Email (очередь/воркер), преференсы и записи доставок
- Безопасность и прозрачность
  - Аудит ключевых событий, health, rate‑limit, CORS, JWT, минимальные метрики

## Что сделано (коротко + где в коде)
- Auth + Web3‑логин: ГОТОВО  
  Nonce/подпись и SIWE, линковка кошелька к пользователю.  
  Код: `apps/api/src/services/walletLogin.service.ts`, роуты `apps/api/src/routes/auth.wallet.routes.ts`, модель `WalletNonce` в `schema.prisma`.
- Заказы (создание/получение/статусы): ГОТОВО  
  Создание заявки с клиентом/авто, локация pickup, таймлайн, безопасные переходы статусов.  
  Код: `apps/api/src/routes/orders.routes.ts` (CRUD + статусы), `apps/api/src/routes/orders.routes.new.ts` (завершение/доказ), сервис `apps/api/src/services/orders.service.ts`.
- Автокалькуляция и профили: ГОТОВО (база)  
  Модель `CalcProfile`, сидирование, расчёт смет (`Estimate`).  
  Код: `apps/api/src/services/estimates.service.ts`, `apps/api/src/services/calcProfiles.service.ts`, схема `CalcProfile`/`Estimate`.
- Гео‑подбор сервисов: ЕСТЬ ОСНОВА  
  Модель `ServiceCenter` (lat/lng), индексы; CRUD ендпоинты.  
  Код: `apps/api/src/services/serviceCenters.service.ts`, `apps/api/src/routes/serviceCenters.routes.ts`.  
  Требуется проверить ранжирование/радиус.
- Оплаты (classic + Web3): ГОТОВО  
  Классические пути и Stripe‑webhook (минимально), Web3‑верификация укреплена.  
  Web3 HARDENING: проверка chainId, настраиваемые подтверждения и таймаут, чёткие коды ошибок.  
  Код: `apps/api/src/services/web3payments.service.ts`.  
  Важные `.env`: `WEB3_PROVIDER_URL`/`WEB3_RPC_URL`, `WEB3_CHAIN_ID` (по умолчанию 80002), `WEB3_CONFIRMATIONS`, `WEB3_TX_TIMEOUT_MS`, `WEB3_ENFORCE_AMOUNT`, `USDC_TOKEN_ADDRESS`, `PLATFORM_RECEIVE_ADDRESS`.
- PDF‑чеки + MinIO: ГОТОВО  
  Генерация PDF (QR → Polygonscan), загрузка в MinIO, создание `Attachment`, запись `Payment.receiptUrl`.  
  Код: `apps/api/src/services/receipts.service.ts`, MinIO либы `apps/api/src/lib/minio.ts`; хранилище — в Compose.
- Proof‑of‑Completion: ГОТОВО  
  `POST /orders/:id/complete` принимает фото/координаты/время, считает SHA‑256 от канонического JSON, пишет в таймлайн;  
  `GET /orders/:id/proof` отдаёт `proofHash` + `evidence`.  
  Код: `apps/api/src/routes/orders.routes.new.ts`, сервис `apps/api/src/services/orders.service.ts`.
- Нотификации (in‑app + email): ГОТОВО  
  Модели: `Notification`, `NotificationDelivery`, `NotificationPreference`; пер‑канальные записи доставки; преференсы пользователя; in‑app через Socket.io; e‑mail через BullMQ воркер (SMTP/консоль).  
  Код: сервис `apps/api/src/services/notification.service.ts`, роуты `apps/api/src/routes/notifications.routes.ts`, сокеты `apps/api/src/services/socket.service.ts`, воркер `apps/api/src/workers/notificationsEmail.worker.ts`, очереди `apps/api/src/queues/index.ts`.  
  Исправлено: адресат заказных уведомлений ищется как реальный User по `clientId`.
- Seeds (демо‑данные): ОБНОВЛЕНЫ  
  Демо User, NotificationPreference, стартовая in‑app нотификация, сервис‑центры, клиент, авто, заказ, смета, страховка.  
  Код: `apps/api/prisma/seed.ts`.
- Инфраструктура: ГОТОВА для локалки  
  Compose (Postgres/Redis/MinIO/Prometheus/Loki, API, web).  
  Файлы: `infra/compose/docker-compose.yml` (и связанные).

## Что осталось добить до «идеально»
- DB миграция: НУЖНО ЗАПУСТИТЬ (Postgres должен быть поднят).  
  Prisma‑клиент сгенерирован; ждём доступной БД и запускаем `prisma migrate dev`, затем seed.
- Гео‑подбор: проверить/дотюнить ранжирование и ограничение радиуса (если в UI есть фильтр по расстоянию).
- Тесты и CI: быстрые интеграционные тесты (оплаты/уведомления/статусы) и GitHub Actions workflow.
- README/Docs: шаги (compose up → migrate → seed → api dev → worker notify), MetaMask шаги и переменные окружения.
- Мини‑аудит валидаций/скоростей: пройтись по express‑validator/zod, убедиться в корректных rate‑limit; health/metrics уже есть.

## Быстрые шаги для локального запуска (Windows PowerShell)

> Требуются: Docker Desktop, Node.js 20+, pnpm (corepack).

```powershell
# 1) Установить зависимости на уровне монорепо
cd C:\IT\projects\diplom\autoassist
corepack enable
pnpm install

# 2) Поднять инфраструктуру (Postgres/Redis/MinIO/Prometheus/Loki)
pnpm start:infra

# 3) Применить миграции и сиды
# (дождитесь готовности Postgres; проверьте infra логи)
cd apps\api
pnpm prisma:migrate   # алиас на prisma migrate dev
pnpm prisma:seed      # заполнить демо‑данные

# 4) Запустить API и Web
cd ..\..   # обратно в autoassist
pnpm dev
```

Если миграции упали, проверьте .env (подключение к БД) и статус контейнера Postgres. Для Web3 проверьте `WEB3_*` переменные и сеть Polygon Amoy (80002).
