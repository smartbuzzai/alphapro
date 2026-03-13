# Enterprise App — Setup & Deployment Guide

> **Target environment:** Contabo VPS running Ubuntu 24.04 LTS  
> **Stack:** NestJS API · Next.js Web · PostgreSQL · Redis · Vault · Unleash · Prometheus · Grafana · K3s  
> **Deployment mode:** Docker Compose (primary) or K3s (production orchestration)

---

## Prerequisites

Before starting, make sure the following are complete on your VPS:

- Ubuntu 24.04 LTS is installed and updated
- You have SSH access as a non-root `deploy` user
- The `bootstrap-vps.sh` script has been run (see `CONTABO-VPS-SETUP.md`)
- A domain name is pointed at your VPS IP (A record)
- Ports 80 and 443 are open in both UFW and the Contabo control panel firewall

---

## 1 — Clone the Repository

```bash
# As deploy user
cd /opt/enterprise-app
git clone https://github.com/yourorg/enterprise-app.git .
```

---

## 2 — Configure Environment Variables

```bash
cp .env.example .env
nano .env
```

Fill in every value marked `CHANGE_ME`. The critical ones are:

| Variable | How to generate |
|---|---|
| `JWT_SECRET` | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` (must be different) |
| `DB_PASSWORD` | Strong random password, min 20 chars |
| `REDIS_PASSWORD` | `openssl rand -hex 16` |
| `VAULT_TOKEN` | Set during Vault initialization (step 5) |
| `UNLEASH_API_TOKEN` | Generated from Unleash UI after first start |
| `GRAFANA_PASSWORD` | Strong password |
| `DOMAIN` | Your actual domain, e.g. `example.com` |

---

## 3 — Configure Caddy Reverse Proxy

```bash
# Copy the included Caddyfile
sudo cp infra/caddy/Caddyfile /etc/caddy/Caddyfile

# Replace placeholder domain
sudo sed -i 's/yourdomain.com/your-actual-domain.com/g' /etc/caddy/Caddyfile

# Verify config
sudo caddy validate --config /etc/caddy/Caddyfile

# Start Caddy (auto-provisions Let's Encrypt TLS)
sudo systemctl start caddy
sudo systemctl enable caddy

# Check status
sudo systemctl status caddy
sudo journalctl -u caddy -n 50
```

Caddy will automatically obtain and renew TLS certificates. DNS must be pointing to your VPS IP before this step, or the ACME challenge will fail.

---

## 4 — Start the Stack

```bash
cd /opt/enterprise-app

# Pull all Docker images first
docker compose pull

# Start in detached mode
docker compose up -d

# Watch startup logs
docker compose logs -f
```

Expected startup order: `postgres` → `redis` → `vault` → `unleash` → `api` → `web` → observability stack.

Allow 60–90 seconds for all services to become healthy on first start.

---

## 5 — Initialize HashiCorp Vault

Vault starts in uninitialized state. You must initialize and unseal it before the API can read secrets.

```bash
# Exec into vault container
docker compose exec vault sh

# Initialize (run ONCE — save the output!)
vault operator init

# This outputs:
#   Unseal Key 1: <key1>
#   Unseal Key 2: <key2>
#   Unseal Key 3: <key3>
#   Initial Root Token: <root-token>
#
# SAVE THESE SOMEWHERE SAFE. Without unseal keys, data is unrecoverable.

# Unseal (requires 3 of 5 keys)
vault operator unseal <key1>
vault operator unseal <key2>
vault operator unseal <key3>

# Login with root token
vault login <root-token>

# Enable KV secrets engine
vault secrets enable -path=secret kv-v2

# Store your app secrets
vault kv put secret/enterprise-app \
  JWT_SECRET="your-jwt-secret" \
  JWT_REFRESH_SECRET="your-refresh-secret" \
  DB_PASSWORD="your-db-password"

exit
```

Update `VAULT_TOKEN` in your `.env` file with the root token, then restart the API:

```bash
docker compose restart api
```

> **Production tip:** Create a policy-scoped token for the app instead of using the root token. See HashiCorp Vault docs on AppRole authentication.

---

## 6 — Configure Unleash Feature Flags

```bash
# Unleash runs at http://localhost:4242
# Access it via SSH tunnel:
ssh -L 4242:localhost:4242 deploy@your-server-ip
# Then open: http://localhost:4242
```

Default credentials: `admin` / `unleash4all` — **change immediately**.

Create feature flags matching what the app expects:

| Flag name | Description | Default |
|---|---|---|
| `new-dashboard` | Enables new UI dashboard | off |
| `data-export` | CSV/PDF export feature | off |
| `advanced-filters` | Advanced filtering UI | off |
| `maintenance-mode` | Puts app in maintenance mode | off |

Copy the API token from Unleash settings → API Access, then update `UNLEASH_API_TOKEN` in `.env`.

---

## 7 — Verify Health Endpoints

```bash
# API liveness (should return {"status":"ok"})
curl http://localhost:3001/health/live

# API readiness (checks DB, Unleash, disk)
curl http://localhost:3001/health/ready

# Public HTTPS endpoints
curl https://yourdomain.com
curl https://api.yourdomain.com/health/live

# Prometheus metrics
curl http://localhost:3001/metrics
```

---

## 8 — Access Monitoring Dashboards

All monitoring ports are bound to `127.0.0.1` (localhost only). Access them via SSH tunnel:

```bash
# Open all dashboard tunnels in one command:
ssh -L 3030:localhost:3030 \
    -L 9090:localhost:9090 \
    -L 16686:localhost:16686 \
    -L 4242:localhost:4242 \
    deploy@your-server-ip

# Then open in browser:
# Grafana:    http://localhost:3030  (admin / your GRAFANA_PASSWORD)
# Prometheus: http://localhost:9090
# Jaeger:     http://localhost:16686
# Unleash:    http://localhost:4242
```

---

## 9 — Enable Auto-Restart on Reboot

```bash
sudo bash -c 'cat > /etc/systemd/system/enterprise-app.service << EOF
[Unit]
Description=Enterprise App Stack
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/enterprise-app
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300
User=deploy

[Install]
WantedBy=multi-user.target
EOF'

sudo systemctl daemon-reload
sudo systemctl enable enterprise-app
```

---

## 10 — Feature Module Toggles

Turn features on or off without redeploying — just update `.env` and restart the API:

```bash
# Edit .env
FEATURE_AUDIT=true
FEATURE_NOTIFICATIONS=true

# Restart API to pick up changes
docker compose restart api

# Verify modules loaded
docker compose logs api | grep "Module ENABLED"
```

---

## Deploying Updates

For subsequent deployments, use the included deploy script:

```bash
bash scripts/deploy.sh
```

Or manually:

```bash
cd /opt/enterprise-app
git pull origin main
docker compose build api web
docker compose up -d --remove-orphans
docker compose logs -f api
```

---

## K3s Mode (Production Orchestration)

If you want Kubernetes-style orchestration instead of plain Docker Compose:

```bash
# Create namespace
kubectl create namespace production

# Store secrets in K3s
kubectl create secret generic enterprise-api-secrets \
  --from-env-file=.env \
  -n production

# Apply manifests
kubectl apply -f infra/k3s/deployments/api-deployment.yaml

# Apply ingress (uses K3s built-in Traefik)
kubectl apply -f infra/k3s/ingress/traefik-ingress.yaml

# Watch rollout
kubectl rollout status deployment/enterprise-api -n production

# Check pods
kubectl get pods -n production
kubectl logs -f deployment/enterprise-api -n production
```

---

## Common Operations

| Task | Command |
|---|---|
| View all logs | `docker compose logs -f` |
| Restart single service | `docker compose restart api` |
| Check container status | `docker compose ps` |
| Shell into API container | `docker compose exec api sh` |
| DB shell | `docker compose exec postgres psql -U $DB_USER $DB_NAME` |
| Redis CLI | `docker compose exec redis redis-cli -a $REDIS_PASSWORD` |
| Stop everything | `docker compose down` |
| Stop + delete volumes | `docker compose down -v` ⚠️ destroys data |
| Unseal Vault after reboot | `docker compose exec vault vault operator unseal` |

---

## Vault Must Be Unsealed After Every Restart

Vault seals itself on restart for security. After any reboot or `docker compose down/up`, you must unseal it before the API can start successfully:

```bash
docker compose exec vault vault operator unseal <unseal-key-1>
docker compose exec vault vault operator unseal <unseal-key-2>
docker compose exec vault vault operator unseal <unseal-key-3>
docker compose restart api
```

> **Automate this carefully.** Auto-unsealing in production typically uses Vault's AWS KMS or Transit seal. On a single VPS, consider using `vault operator unseal` in a startup script with keys stored in a separate secure location.

---

## Troubleshooting

**API not starting:**
```bash
docker compose logs api --tail=100
curl http://localhost:3001/health/live
```

**Vault sealed after reboot:**
```bash
docker compose exec vault vault status
# If "Sealed: true" — run the unseal commands above
```

**Caddy not getting TLS cert:**
```bash
sudo journalctl -u caddy -n 100
# Check: DNS A record points to your VPS IP
# Check: ports 80 and 443 are open
sudo caddy validate --config /etc/caddy/Caddyfile
```

**Database connection refused:**
```bash
docker compose logs postgres --tail=50
docker compose exec postgres pg_isready
```

**Out of memory:**
```bash
free -h          # Check RAM + swap usage
docker stats     # Per-container memory
# Add more swap or reduce container memory limits in docker-compose.yml
```
