# AutoAssist+ Docker Compose Infrastructure

This directory contains Docker Compose configuration for local development and testing of the AutoAssist+ platform.

## Quick Start

1. **Copy environment variables:**
   ```bash
   cp .env.example .env
   ```

2. **Edit environment variables:**
   - Set your `TELEGRAM_BOT_TOKEN` (required for bot functionality)
   - Adjust passwords and secrets as needed
   - Configure external service URLs if needed

3. **Start all services:**
   ```bash
   docker-compose up -d
   ```

4. **View logs:**
   ```bash
   docker-compose logs -f
   ```

## Services Overview

### Core Services

- **PostgreSQL** (`db`): Main database
  - Port: 5432
  - Database: `autoassist`
  - User: `postgres`

- **Redis** (`redis`): Caching and session storage
  - Port: 6379
  - Password configured via env vars

- **MinIO** (`minio`): Object storage for file attachments
  - Port: 9000 (API), 9001 (Console)
  - Console: http://localhost:9001
  - Default credentials: minioadmin/minioadmin123

### Application Services

- **API** (`api`): Node.js/Express backend
  - Port: 8080
  - Auto-reloads on code changes
  - Health check: http://localhost:8080/health

- **Web** (`web`): React frontend with Vite
  - Port: 5173
  - Hot reload enabled
  - Access: http://localhost:5173

- **Bot** (`bot`): Telegram bot service
  - Requires `TELEGRAM_BOT_TOKEN` environment variable
  - Connects to API internally

- **Nginx** (`nginx`): Reverse proxy (optional)
  - Port: 80
  - Routes traffic to appropriate services
  - Access: http://localhost

### Monitoring Services

- **Prometheus** (`prometheus`): Metrics collection
  - Port: 9090
  - Access: http://localhost:9090

- **Grafana** (`grafana`): Monitoring dashboards
  - Port: 3000
  - Access: http://localhost:3000
  - Default: admin/admin123

- **Loki** (`loki`): Log aggregation
  - Port: 3100

## Development Workflow

### First Time Setup

1. **Install dependencies in each app:**
   ```bash
   # From repository root
   pnpm install
   
   # Or in each app directory
   cd apps/api && pnpm install
   cd apps/web && pnpm install  
   cd apps/bot && pnpm install
   ```

2. **Setup database:**
   ```bash
   # Start database first
   docker-compose up -d db redis minio
   
   # Run migrations
   cd apps/api
   pnpm run db:migrate
   ```

3. **Start development services:**
   ```bash
   docker-compose up -d api web bot
   ```

### Daily Development

```bash
# Start all services
docker-compose up -d

# View specific service logs
docker-compose logs -f api
docker-compose logs -f web

# Restart a service after code changes (if needed)
docker-compose restart api

# Stop all services
docker-compose down
```

### Database Management

```bash
# Access PostgreSQL
docker-compose exec db psql -U postgres -d autoassist

# Run Prisma migrations
cd apps/api
pnpm run db:migrate

# Reset database
pnpm run db:reset

# Open Prisma Studio
pnpm run db:studio
```

### File Storage (MinIO)

- Console: http://localhost:9001
- API Endpoint: http://localhost:9000
- Bucket: `attachments` (auto-created)
- Files accessible at: http://localhost:9000/attachments/filename

## Configuration Files

- `docker-compose.yml`: Main service definitions
- `.env.example`: Environment variables template
- `nginx.conf`: Reverse proxy configuration
- `prometheus.yml`: Metrics collection config
- `init.sql`: Database initialization

## Troubleshooting

### Common Issues

1. **Port conflicts:**
   ```bash
   # Check what's using a port
   netstat -tulpn | grep :5432
   
   # Stop conflicting services or change ports in docker-compose.yml
   ```

2. **Database connection issues:**
   ```bash
   # Check database health
   docker-compose ps db
   docker-compose logs db
   
   # Reset database
   docker-compose down -v
   docker-compose up -d db
   ```

3. **File permission issues:**
   ```bash
   # Fix volume permissions
   sudo chown -R $USER:$USER ./data
   ```

4. **Telegram bot not working:**
   - Verify `TELEGRAM_BOT_TOKEN` is set in `.env`
   - Check bot logs: `docker-compose logs bot`
   - Ensure bot is not running elsewhere

### Useful Commands

```bash
# Rebuild specific service
docker-compose build api
docker-compose up -d api

# View container resource usage
docker stats

# Clean up everything
docker-compose down -v --remove-orphans
docker system prune -a

# Backup database
docker-compose exec db pg_dump -U postgres autoassist > backup.sql

# Restore database  
cat backup.sql | docker-compose exec -T db psql -U postgres -d autoassist
```

## Production Considerations

When deploying to production:

1. **Security:**
   - Change all default passwords
   - Use strong JWT secrets
   - Enable SSL/HTTPS
   - Configure proper firewall rules

2. **Persistence:**
   - Use external volumes for data
   - Setup database backups
   - Configure log rotation

3. **Scaling:**
   - Use external database service
   - Setup load balancing
   - Configure horizontal scaling

4. **Monitoring:**
   - Setup alerting rules
   - Configure external log aggregation
   - Monitor resource usage

## Network Architecture

All services run on `autoassist-network` (172.20.0.0/16):
- Database: 172.20.0.x
- Cache: 172.20.0.x  
- Storage: 172.20.0.x
- Applications: 172.20.0.x

Internal communication uses service names (e.g., `api:8080`, `db:5432`).