# Alpha Pro

Production-grade monorepo running NestJS + Next.js on a Contabo VPS (Ubuntu 24.04).

## Quick Start

```bash
# 1. Prepare your VPS (run once)
sudo bash scripts/bootstrap-vps.sh

# 2. Clone and configure
git clone https://github.com/yourorg/enterprise-app /opt/enterprise-app
cd /opt/enterprise-app
cp .env.example .env
nano .env   # Fill in all CHANGE_ME values

# 3. Configure reverse proxy
sudo cp infra/caddy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile   # Replace yourdomain.com
sudo systemctl start caddy

# 4. Start the stack
docker compose up -d
```

## Documentation

| File | Contents |
|---|---|
| `SETUP.md` | Full app deployment and operations guide |
| `CONTABO-VPS-SETUP.md` | Contabo VPS preparation and hardening |
| `architecture-diagram.html` | Interactive stack architecture diagram |

## Stack

- **Backend:** NestJS 10 + TypeScript
- **Frontend:** Next.js 14 (App Router)
- **Database:** PostgreSQL 16
- **Cache:** Redis 7
- **Secrets:** HashiCorp Vault
- **Feature Flags:** Unleash (self-hosted)
- **Tracing:** OpenTelemetry → Jaeger
- **Metrics:** Prometheus + Grafana
- **Errors:** Sentry
- **Orchestration:** K3s (Kubernetes-compatible, works on Contabo VPS)
- **Reverse Proxy:** Caddy (auto HTTPS)
- **CI/CD:** GitHub Actions
