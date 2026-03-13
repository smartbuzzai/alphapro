#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Enterprise App — Contabo VPS Bootstrap Script
# Ubuntu 24.04 LTS
#
# Run as root ONCE after first login:
#   chmod +x scripts/bootstrap-vps.sh
#   sudo bash scripts/bootstrap-vps.sh
#
# What this does:
#   1. Creates a non-root deploy user
#   2. Hardens SSH
#   3. Configures UFW firewall
#   4. Installs Docker, Node.js 20, K3s
#   5. Adds 8GB swap (critical on Contabo — ships with 0 swap)
#   6. Installs Caddy reverse proxy
#   7. Installs Fail2ban
#   8. Configures unattended security updates
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}══════ $1 ══════${NC}"; }

[[ $EUID -ne 0 ]] && err "Run as root: sudo bash $0"

# ── CONFIGURE THESE BEFORE RUNNING ────────────────────────────────────
DEPLOY_USER="deploy"
YOUR_SSH_PUBLIC_KEY=""    # Paste your SSH public key here, or leave blank to skip
# ──────────────────────────────────────────────────────────────────────

step "System Update"
apt update && apt upgrade -y
apt install -y curl wget git unzip software-properties-common \
  ca-certificates gnupg apt-transport-https fail2ban ufw htop ncdu

step "Create Deploy User"
if id "$DEPLOY_USER" &>/dev/null; then
  warn "User $DEPLOY_USER already exists — skipping"
else
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  usermod -aG sudo "$DEPLOY_USER"
  usermod -aG docker "$DEPLOY_USER" 2>/dev/null || true
  log "Created user: $DEPLOY_USER"
fi

if [[ -n "$YOUR_SSH_PUBLIC_KEY" ]]; then
  mkdir -p /home/$DEPLOY_USER/.ssh
  echo "$YOUR_SSH_PUBLIC_KEY" >> /home/$DEPLOY_USER/.ssh/authorized_keys
  chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
  chmod 700 /home/$DEPLOY_USER/.ssh
  chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
  log "SSH key installed for $DEPLOY_USER"
fi

step "Swap File (8GB — Critical on Contabo)"
if [[ ! -f /swapfile ]]; then
  fallocate -l 8G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Tune: only use swap under real pressure
  echo 'vm.swappiness=10'           >> /etc/sysctl.conf
  echo 'vm.vfs_cache_pressure=50'   >> /etc/sysctl.conf
  sysctl -p
  log "8GB swap created and enabled"
else
  warn "Swap file already exists — skipping"
fi

step "SSH Hardening"
SSHD_CONFIG="/etc/ssh/sshd_config"
cp $SSHD_CONFIG ${SSHD_CONFIG}.backup.$(date +%Y%m%d)

# Apply hardened settings
cat >> $SSHD_CONFIG << 'SSHEOF'

# ── Hardened by bootstrap-vps.sh ─────────────────────────
PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding no
PrintMotd no
MaxAuthTries 3
MaxSessions 10
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
AllowAgentForwarding no
AllowTcpForwarding no
# ─────────────────────────────────────────────────────────
SSHEOF

systemctl restart sshd
log "SSH hardened (root login disabled, password auth disabled)"
warn "IMPORTANT: Make sure your SSH key works before closing this session!"

step "UFW Firewall"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP (Caddy redirect)'
ufw allow 443/tcp  comment 'HTTPS (Caddy)'
ufw --force enable
log "Firewall configured — ports 22, 80, 443 open"

step "Fail2Ban"
cat > /etc/fail2ban/jail.local << 'F2BEOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled = true
port    = ssh
logpath = %(sshd_log)s
maxretry = 3
bantime  = 86400
F2BEOF
systemctl enable fail2ban --now
systemctl restart fail2ban
log "Fail2ban configured (SSH: 3 tries, 24h ban)"

step "Unattended Security Updates"
cat > /etc/apt/apt.conf.d/50unattended-upgrades-custom << 'UUEOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Automatic-Reboot "false";
UUEOF
systemctl enable unattended-upgrades --now
log "Automatic security updates enabled"

step "Docker CE"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker "$DEPLOY_USER"
systemctl enable docker --now
log "Docker CE installed"

step "Node.js 20 LTS"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
log "Node.js $(node --version) installed"

step "K3s (Lightweight Kubernetes — no nested virt needed)"
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik" sh -
# Note: Pass --disable traefik if you want to use Caddy instead of Traefik
# Remove --disable traefik if you want K3s's built-in Traefik ingress

# Copy kubeconfig for deploy user
mkdir -p /home/$DEPLOY_USER/.kube
cp /etc/rancher/k3s/k3s.yaml /home/$DEPLOY_USER/.kube/config
chown $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.kube/config
chmod 600 /home/$DEPLOY_USER/.kube/config
sed -i "s/127.0.0.1/localhost/" /home/$DEPLOY_USER/.kube/config
echo 'export KUBECONFIG=/home/'$DEPLOY_USER'/.kube/config' \
  >> /home/$DEPLOY_USER/.bashrc

systemctl enable k3s --now
log "K3s installed ($(k3s --version | head -1))"

step "Caddy Reverse Proxy"
apt install -y debian-keyring debian-archive-keyring
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
mkdir -p /var/log/caddy
chown caddy:caddy /var/log/caddy
systemctl enable caddy
log "Caddy installed — configure /etc/caddy/Caddyfile then: systemctl start caddy"

step "Application Directory"
mkdir -p /opt/enterprise-app
chown $DEPLOY_USER:$DEPLOY_USER /opt/enterprise-app
log "App directory: /opt/enterprise-app (owned by $DEPLOY_USER)"

step "Local Docker Registry (for K3s image loading)"
docker run -d \
  --name registry \
  --restart=unless-stopped \
  -p 127.0.0.1:5000:5000 \
  -v registry_data:/var/lib/registry \
  registry:2 2>/dev/null || warn "Registry may already be running"
log "Local Docker registry running on localhost:5000"

# K3s registry config
mkdir -p /etc/rancher/k3s
cat > /etc/rancher/k3s/registries.yaml << 'REGEOF'
mirrors:
  "localhost:5000":
    endpoint:
      - "http://localhost:5000"
REGEOF
systemctl restart k3s
log "K3s configured to use local registry"

step "System Tuning for Production"
cat >> /etc/sysctl.conf << 'SYSCTLEOF'
# Network performance
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
# File descriptors
fs.file-max = 2097152
SYSCTLEOF
sysctl -p

# Increase file descriptor limits
cat >> /etc/security/limits.conf << 'LIMEOF'
*    soft nofile 65535
*    hard nofile 65535
root soft nofile 65535
root hard nofile 65535
LIMEOF
log "System tuned for production workloads"

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Bootstrap Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Deploy user:   ${CYAN}$DEPLOY_USER${NC}"
echo -e "  App directory: ${CYAN}/opt/enterprise-app${NC}"
echo -e "  Firewall:      ${CYAN}UFW — ports 22, 80, 443${NC}"
echo -e "  Docker:        ${CYAN}$(docker --version)${NC}"
echo -e "  Node.js:       ${CYAN}$(node --version)${NC}"
echo -e "  K3s:           ${CYAN}$(k3s --version | head -1)${NC}"
echo -e "  Swap:          ${CYAN}$(swapon --show | tail -1)${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Log in as $DEPLOY_USER and verify SSH key works"
echo -e "  2. Clone your repo to /opt/enterprise-app"
echo -e "  3. cp .env.example .env && fill in real secrets"
echo -e "  4. Copy infra/caddy/Caddyfile to /etc/caddy/Caddyfile"
echo -e "     Update domain name, then: systemctl start caddy"
echo -e "  5. docker compose up -d"
echo -e "  6. See SETUP.md for full deployment steps"
echo ""
