# Quick Test Guide

## API Endpoints Test

### 1. Attachments
```bash
# Get presigned URL
POST /api/attachments/presign
{
  "orderId": 1,
  "mime": "image/jpeg",
  "type": "photo"
}

# Save attachment after upload
POST /api/attachments
{
  "orderId": 1,
  "objectName": "1/1234567890-abcd.jpeg",
  "type": "photo"
}
```

### 2. Insurance Offers
```bash
# Generate offers
POST /api/insurance/offers
{
  "orderId": 1
}

# Accept offer
POST /api/insurance/123/accept
```

### 3. Tow Quote
```bash
# Get quote
POST /api/tow/quote
{
  "orderId": 1,
  "from": {"lat": 50.4501, "lng": 30.5234},
  "to": {"lat": 50.4851, "lng": 30.5164}
}

# Assign tow
POST /api/tow/1/assign
{
  "partnerId": 5
}
```

### 4. Payments
```bash
# Create invoice
POST /api/payments/invoice
{
  "orderId": 1,
  "amount": 2500
}

# Webhook simulation
POST /api/payments/webhook
{
  "orderId": 1,
  "paymentId": 123,
  "status": "paid"
}
```

## WebSocket Events

```javascript
// Connect to socket
const socket = io('http://localhost:8080');

// Join order room
socket.emit('join', 'order:1');

// Listen for updates
socket.on('attachment:added', data => console.log('New attachment:', data));
socket.on('order:updated', data => console.log('Order updated:', data));
socket.on('payment:status', data => console.log('Payment status:', data));
```

## Environment Setup

```env
MINIO_ENDPOINT=localhost
MINIO_PORT=12002
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=attachments

DATABASE_URL=postgresql://user:pass@localhost:5432/autoassist

API_PORT=8080
```

## Start Commands

```bash
npm install
npm run dev
```

Server starts on http://localhost:8080
Health check: GET /health