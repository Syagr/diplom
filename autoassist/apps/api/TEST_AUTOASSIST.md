# AutoAssist+ End-to-End Testing Guide

## Prerequisites
```bash
# Start services
docker-compose up -d
npm run dev:api

# Verify services are running
curl http://localhost:8080/health
```

## Testing Checklist

### 1. Create Order
```bash
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "client": {
      "name": "Иван Иванов",
      "phone": "+380501234567",
      "email": "ivan@example.com"
    },
    "vehicle": {
      "plate": "AA1234BB",
      "make": "Toyota",
      "model": "Camry",
      "year": 2020
    },
    "category": "accident",
    "description": "Повреждение переднего бампера",
    "priority": "normal",
    "pickup": {
      "lat": 50.4501,
      "lng": 30.5234,
      "address": "Киев, Крещатик 1"
    }
  }'
```
Expected: `{"success":true,"orderId":1}`

### 2. Get Presigned Upload URL
```bash
curl -X POST http://localhost:8080/api/attachments/presigned \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": 1,
    "mimeType": "image/jpeg"
  }'
```
Expected: `{"success":true,"uploadUrl":"...", "objectName":"1/..."}`

### 3. Upload File (simulate)
```bash
# This would be done by frontend with the presigned URL
echo "File upload simulation - use the presigned URL from step 2"
```

### 4. Confirm Upload
```bash
curl -X POST http://localhost:8080/api/attachments/confirm \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": 1,
    "objectName": "1/12345-abcd.jpg",
    "type": "photo",
    "meta": {"size": 1024000}
  }'
```
Expected: `{"success":true,"attachmentId":1}`

### 5. Generate Insurance Offers
```bash
curl -X POST http://localhost:8080/api/insurance/generate \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": 1
  }'
```
Expected: `{"success":true,"offers":[...]}`

### 6. Get Tow Quote
```bash
curl -X POST http://localhost:8080/api/tow/quote \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": 1,
    "pickup": {"lat": 50.4501, "lng": 30.5234},
    "destination": {"lat": 50.4701, "lng": 30.5434}
  }'
```
Expected: `{"success":true,"quote":{...}}`

### 7. Create Payment Invoice
```bash
curl -X POST http://localhost:8080/api/payments/invoice \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": 1,
    "amount": 5000
  }'
```
Expected: `{"success":true,"invoice":{...}}`

### 8. Webhook Simulation (Payment)
```bash
curl -X POST http://localhost:8080/api/payments/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": 1,
    "paymentId": 1,
    "status": "paid"
  }'
```
Expected: `{"success":true,"payment":{...}}`

## WebSocket Testing

### Setup WebSocket Client
```javascript
// Browser console or Node.js
const socket = io('http://localhost:8080');

// Join order room
socket.emit('join', 'order:1');

// Listen for events
socket.on('order:created', (data) => console.log('Order created:', data));
socket.on('attachment:uploaded', (data) => console.log('File uploaded:', data));
socket.on('insurance:offers', (data) => console.log('Insurance offers:', data));
socket.on('tow:quote', (data) => console.log('Tow quote:', data));
socket.on('payment:status', (data) => console.log('Payment status:', data));
```

## Expected Event Flow
1. `order:created` → Order creation
2. `attachment:uploaded` → File upload confirmation  
3. `insurance:offers` → Insurance offers generated
4. `tow:quote` → Tow quote calculated
5. `payment:status` → Payment processed

## Verification Points
- ✅ Order created with client/vehicle data
- ✅ MinIO presigned URLs generated
- ✅ File uploads tracked in database
- ✅ Insurance rules engine working
- ✅ Tow distance calculations correct
- ✅ Payment webhooks processed
- ✅ WebSocket events emitted
- ✅ Database consistency maintained

## Troubleshooting
- Check Docker containers: `docker-compose ps`
- View API logs: `docker-compose logs api`
- Check MinIO: http://localhost:9001 (admin/password123)
- Database queries: Use Prisma Studio or direct connection

## Success Criteria
All endpoints return success responses, WebSocket events are emitted, and data is properly stored in the database.