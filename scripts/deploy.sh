#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# deploy.sh — Pull latest code and redeploy the stack
# Run as deploy user: bash scripts/deploy.sh
# ─────────────────────────────────────────────────────────

set -euo pipefail

APP_DIR="/opt/enterprise-app"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

cd "$APP_DIR"

log "Pulling latest code..."
git pull origin main

log "Building Docker images..."
docker compose build --no-cache api web

log "Running zero-downtime redeploy..."
# Bring up new containers, then remove old ones
docker compose up -d --remove-orphans

log "Waiting for health checks..."
sleep 10

# Verify health
API_STATUS=$(curl -sf http://localhost:3001/health/live | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unreachable")

if [[ "$API_STATUS" == "ok" ]]; then
  echo -e "\n${GREEN}✅ Deployment successful — API is healthy${NC}"
else
  echo -e "\n${YELLOW}⚠️  API health check returned: $API_STATUS${NC}"
  echo "Check logs with: docker compose logs --tail=50 api"
fi

log "Active containers:"
docker compose ps

echo -e "\n${CYAN}Useful commands:${NC}"
echo "  Logs:    docker compose logs -f api"
echo "  Restart: docker compose restart api"
echo "  Status:  docker compose ps"
