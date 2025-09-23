# AutoAssist+ API

Comprehensive insurance and towing assistance platform API server.

## Features

### Core Services
- **Triage Service**: Automatic order processing, cost calculations, insurance offers
- **Attachments Service**: File upload via MinIO, presigned URLs, multipart uploads
- **Insurance Service**: Rule-based policy generation, client discount calculations
- **Payments Service**: Multi-provider support (LiqPay, crypto, escrow smart contracts)
- **Tow Service**: Quote calculations, driver assignment, real-time tracking
- **Notification Service**: Multi-channel notifications (in-app, email, SMS, Telegram, push)
- **Socket Service**: Real-time communication via WebSocket

### API Features
- RESTful endpoints with comprehensive validation
- Real-time updates via Socket.IO
- JWT authentication with role-based access control
- Rate limiting and security middleware
- Comprehensive error handling and logging
- File upload and storage management
- Multi-language support (UA/EN)

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Real-time**: Socket.IO
- **Storage**: MinIO S3-compatible object storage
- **Cache**: Redis
- **Authentication**: JWT with bcrypt
- **Validation**: Joi/Zod schemas
- **Logging**: Winston with daily rotation
- **Testing**: Jest with Supertest

## Project Structure

```
src/
├── app.ts                 # Main application entry point
├── services/              # Business logic services
│   ├── triage.service.ts     # Order processing & automation
│   ├── attachments.service.ts # File upload & management
│   ├── insurance.service.ts   # Insurance policy generation
│   ├── payments.service.ts    # Payment processing
│   ├── socket.service.ts      # WebSocket communication
│   └── notification.service.ts # Multi-channel notifications
├── routes/                # API route handlers
│   ├── auth.routes.ts
│   ├── orders.routes.ts
│   ├── attachments.routes.ts
│   ├── insurance.routes.ts
│   ├── payments.routes.ts
│   ├── tow.routes.ts
│   └── notifications.routes.ts
├── libs/                  # Shared utilities
│   └── logger.ts
├── middleware/            # Express middleware
├── types/                 # TypeScript type definitions
└── utils/                 # Helper functions
```

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL
- Redis
- MinIO (or S3-compatible storage)

### Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Setup environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Setup database**:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:3001`

## Environment Variables

### Required Configuration

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/autoassist_db"
REDIS_URL="redis://localhost:6379"

# JWT Security
JWT_SECRET="your-super-secret-jwt-key"
JWT_EXPIRES_IN="7d"

# MinIO Storage
MINIO_ENDPOINT="localhost"
MINIO_PORT=9000
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MINIO_BUCKET="autoassist-uploads"

# Server
PORT=3001
NODE_ENV="development"
CORS_ORIGIN="http://localhost:3000"
```

### Optional Integrations

```env
# Payment Providers
LIQPAY_PUBLIC_KEY="your-liqpay-key"
LIQPAY_PRIVATE_KEY="your-liqpay-secret"

# Notification Services
SMTP_HOST="smtp.gmail.com"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
TELEGRAM_BOT_TOKEN="your-telegram-bot-token"
FCM_SERVER_KEY="your-fcm-server-key"

# Blockchain
WEB3_PROVIDER_URL="https://mainnet.infura.io/v3/your-project-id"
ESCROW_CONTRACT_ADDRESS="0x..."
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/refresh` - Token refresh
- `POST /api/auth/logout` - User logout

### Orders Management
- `GET /api/orders` - List orders with filters
- `POST /api/orders` - Create new order
- `GET /api/orders/:id` - Get order details
- `PUT /api/orders/:id` - Update order
- `DELETE /api/orders/:id` - Cancel order

### File Attachments
- `POST /api/attachments/upload` - Upload files
- `GET /api/attachments/presigned-url` - Get upload URL
- `GET /api/attachments/:id` - Download file
- `DELETE /api/attachments/:id` - Delete file

### Insurance
- `POST /api/insurance/quote` - Generate insurance quote
- `POST /api/insurance/policy` - Create insurance policy
- `GET /api/insurance/policies` - List user policies

### Payments
- `POST /api/payments/liqpay` - Process LiqPay payment
- `POST /api/payments/crypto` - Process crypto payment
- `POST /api/payments/escrow` - Create escrow payment
- `GET /api/payments/:id/status` - Check payment status

### Tow Services
- `POST /api/tow/quote` - Get towing quote
- `POST /api/tow/:orderId/assign` - Assign tow truck
- `GET /api/tow/:orderId/status` - Track tow status
- `PUT /api/tow/:orderId/status` - Update tow status

### Notifications
- `GET /api/notifications` - Get user notifications
- `PUT /api/notifications/:id/read` - Mark as read
- `GET /api/notifications/preferences` - Get preferences
- `PUT /api/notifications/preferences` - Update preferences

## Real-time Events (WebSocket)

### Connection
```javascript
const socket = io('http://localhost:3001', {
  auth: { token: 'your-jwt-token' }
});
```

### Event Subscriptions
```javascript
// Order updates
socket.emit('subscribe:order', orderId);
socket.on('order:updated', (data) => {
  console.log('Order updated:', data);
});

// Dashboard metrics
socket.emit('subscribe:dashboard');
socket.on('dashboard:updated', (metrics) => {
  console.log('New metrics:', metrics);
});

// Tow tracking
socket.emit('subscribe:tow', towRequestId);
socket.on('tow:location', (location) => {
  console.log('Tow location:', location);
});

// Chat functionality
socket.emit('join:chat', chatId);
socket.emit('send:message', { chatId, message: 'Hello!' });
socket.on('new:message', (message) => {
  console.log('New message:', message);
});
```

## Development

### Available Scripts

```bash
npm run dev          # Start development server with hot reload
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run lint:fix     # Fix ESLint errors
npm run test         # Run tests
npm run test:watch   # Run tests in watch mode
npm run db:migrate   # Run database migrations
npm run db:seed      # Seed database with test data
npm run db:studio    # Open Prisma Studio
```

### Database Operations

```bash
# Generate Prisma client
npm run db:generate

# Create and apply migration
npm run db:migrate

# Reset database (development only)
npx prisma migrate reset

# View data in Prisma Studio
npm run db:studio
```

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Docker Deployment

### Build Image
```bash
npm run docker:build
```

### Run Container
```bash
npm run docker:run
```

### Docker Compose
```yaml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/autoassist
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
      - minio
```

## Production Deployment

### Environment Setup
1. Set `NODE_ENV=production`
2. Use strong JWT secrets
3. Configure proper CORS origins
4. Set up SSL/TLS certificates
5. Configure reverse proxy (nginx)
6. Set up monitoring and logging

### Security Checklist
- [ ] JWT secrets are cryptographically secure
- [ ] Database credentials are secured
- [ ] CORS is properly configured
- [ ] Rate limiting is enabled
- [ ] File upload restrictions are in place
- [ ] HTTPS is enforced
- [ ] Security headers are set
- [ ] Input validation is comprehensive

## Architecture

### Service Layer Pattern
Each major feature is organized into services that handle business logic:

- **Services**: Core business logic and external integrations
- **Routes**: HTTP request handling and validation
- **Middleware**: Cross-cutting concerns (auth, logging, etc.)
- **Utils**: Shared helper functions

### Real-time Architecture
- WebSocket connections managed through Socket.IO
- Room-based subscriptions for scalability
- Event-driven architecture for real-time updates
- Integration with business services for live data

### Payment Processing
- Multiple payment provider support
- Webhook handling for payment status updates
- Escrow smart contracts for secure transactions
- Comprehensive payment status tracking

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

MIT License - see LICENSE file for details