# AutoAssist+ Mobile App (Android)

## 🎯 Описание

Мобильное приложение для AutoAssist+ платформы с поддержкой:
- VIN-сканирования через камеру
- Геолокации для вызова эвакуатора
- Push-уведомлений о статусе заявок
- Биометрической аутентификации
- QR-сканирования при выдаче авто

## 🔧 Технологии

- **Kotlin** - основной язык разработки
- **Jetpack Compose** - современный UI toolkit
- **CameraX** - камера и ML Kit для VIN-сканирования
- **Room** - локальная база данных
- **Retrofit** - HTTP клиент для API
- **Firebase Messaging** - push-уведомления
- **Biometric API** - отпечатки пальцев и Face ID
- **Google Maps** - карты и геолокация

## 📱 Основные экраны

1. **Splash & Auth** - загрузка и биометрическая аутентификация
2. **Main Dashboard** - список заявок, быстрые действия
3. **Create Order** - новая заявка с фото и геолокацией
4. **VIN Scanner** - сканирование VIN через камеру
5. **Order Details** - детали заявки, статус, оплата
6. **QR Scanner** - сканирование QR при получении авто
7. **Profile** - профиль, баллы лояльности, настройки

## 🚀 Установка и запуск

### Требования
- Android Studio Hedgehog (2023.1.1) или новее
- Android SDK 34+
- Kotlin 1.9+
- Gradle 8.2+

### Настройка

1. **Клонирование проекта**
```bash
cd apps/mobile
```

2. **Firebase настройка**
   - Создайте проект в [Firebase Console](https://console.firebase.google.com/)
   - Скачайте `google-services.json` в `app/` директорию
   - Включите Firebase Messaging

3. **Google Maps API**
   - Получите API ключ в [Google Cloud Console](https://console.cloud.google.com/)
   - Добавьте ключ в `local.properties`:
   ```
   MAPS_API_KEY=your_google_maps_api_key_here
   ```

4. **API конфигурация**
   ```kotlin
   // В app/src/main/res/values/strings.xml
   <string name="api_base_url">http://your-api-domain.com</string>
   ```

### Сборка и запуск

```bash
# Сборка debug версии
./gradlew assembleDebug

# Установка на устройство
./gradlew installDebug

# Запуск тестов
./gradlew test
```

## 📂 Структура проекта

```
mobile/
├── app/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/autoassist/
│   │   │   │   ├── ui/          # UI компоненты
│   │   │   │   ├── data/        # Repository, API, Database
│   │   │   │   ├── domain/      # Business logic
│   │   │   │   ├── di/          # Dependency Injection
│   │   │   │   └── utils/       # Утилиты
│   │   │   ├── res/            # Ресурсы (layouts, strings, etc.)
│   │   │   └── AndroidManifest.xml
│   │   └── test/               # Unit тесты
│   ├── build.gradle.kts
│   └── google-services.json   # Firebase config
├── build.gradle.kts
├── gradle.properties
├── local.properties
└── README.md
```

## 🔐 Безопасность

- Биометрическая аутентификация через Android Biometric API
- Сертификаты SSL pinning для API запросов
- Шифрование локальных данных
- Обфускация кода в release сборке

## 📡 API интеграция

Приложение интегрируется с AutoAssist+ API:
- `POST /api/orders` - создание заявки
- `GET /api/orders` - получение списка заявок
- `GET /api/orders/{id}` - детали заявки
- `PATCH /api/orders/{id}/status` - обновление статуса

## 🔔 Push уведомления

Firebase Messaging для уведомлений о:
- Изменении статуса заявки
- Прибытии эвакуатора
- Готовности автомобиля к выдаче
- Специальных предложениях

## 🎯 Планируемые функции

- [ ] Интеграция с Web3 кошельками
- [ ] Offline режим с синхронизацией
- [ ] AR сканирование повреждений
- [ ] Чат с механиком
- [ ] Система рейтингов и отзывов

## 📄 Лицензия

Этот проект является частью дипломной работы.

---
**AutoAssist+** - современная платформа для автосервиса 🚗⚡