# Contabo VPS Setup Guide — Ubuntu 24.04 LTS

> Complete step-by-step guide for preparing a Contabo VPS to run the Enterprise App stack.

---

## Important: Contabo-Specific Constraints

Before starting, understand two things that differ from AWS/GCP/Azure:

**1. No nested virtualization.**
Contabo VPS instances run KVM but with hardware virtualization extensions disabled (`VM-x/AMD-V: off`). Full Kubernetes (`kubeadm`) will not run. Use **K3s** instead — it is a certified Kubernetes distribution that does not require nested virtualization and is included in this stack.

**2. Zero swap by default.**
Contabo ships all VPS plans with no swap configured. Node.js, the monitoring stack, and Docker builds will spike memory and crash without it. The setup below adds 8GB of swap as one of the first steps.

---

## Recommended VPS Plan

| Plan | vCPU | RAM | Storage | Suitable for |
|---|---|---|---|---|
| Cloud VPS 10 | 3 vCPU | 8 GB | 100 GB NVMe | Dev / staging only |
| **Cloud VPS 20** ✅ | **6 vCPU** | **18 GB** | **200 GB NVMe** | **Full stack — recommended** |
| Cloud VPS 40 | 8 vCPU | 30 GB | 400 GB NVMe | High traffic production |

The **Cloud VPS 20** is the most popular Contabo plan and comfortably runs the full stack including all monitoring services.

When ordering, select:
- **OS:** Ubuntu 24.04 LTS
- **Region:** Choose closest to your users
- **Storage:** NVMe (faster than HDD options)

---

## Step 1 — First Login

After Contabo sends your VPS credentials by email:

```bash
# SSH in as root with the password from the email
ssh root@YOUR_VPS_IP

# Immediately change the root password
passwd
```

> Contabo may take 15–45 minutes to provision a new VPS. If SSH refuses connection, wait a few more minutes.

---

## Step 2 — Run the Bootstrap Script (Recommended)

The easiest path is to use the included bootstrap script, which automates all hardening and installation steps:

```bash
# Upload the script to the server
scp scripts/bootstrap-vps.sh root@YOUR_VPS_IP:/root/

# SSH in and run it
ssh root@YOUR_VPS_IP
bash /root/bootstrap-vps.sh
```

**What the bootstrap script installs and configures:**
- Non-root `deploy` user with sudo
- 8 GB swap file with tuned swappiness
- SSH hardening (root login disabled, password auth disabled)
- UFW firewall (ports 22, 80, 443)
- Fail2ban (SSH brute-force protection)
- Unattended security updates
- Docker CE + Docker Compose plugin
- Node.js 20 LTS
- K3s (lightweight Kubernetes, no nested virt required)
- Caddy reverse proxy
- Local Docker registry for K3s image loading
- Production sysctl tuning (file descriptors, TCP settings)

If you prefer to run each step manually, follow Steps 3–12 below.

---

## Step 3 — Manual: Create Deploy User

```bash
adduser deploy
usermod -aG sudo deploy
usermod -aG docker deploy

# Add your SSH public key for the deploy user
mkdir -p /home/deploy/.ssh
echo "YOUR_SSH_PUBLIC_KEY" >> /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

---

## Step 4 — Manual: Add Swap (Critical)

```bash
# Create 8 GB swap file
fallocate -l 8G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Make it persist across reboots
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Tune: only swap under real pressure (default 60 is too aggressive)
echo 'vm.swappiness=10' >> /etc/sysctl.conf
echo 'vm.vfs_cache_pressure=50' >> /etc/sysctl.conf
sysctl -p

# Verify
free -h
```

---

## Step 5 — Manual: Harden SSH

```bash
# Backup original config first
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

nano /etc/ssh/sshd_config
```

Find and change/add these lines:

```
PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowTcpForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
```

```bash
# Test config before restarting
sshd -t

# Restart SSH
systemctl restart sshd
```

> ⚠️ **Before restarting SSH:** Open a second terminal and verify your deploy user can SSH in with the key. If you lock yourself out, use Contabo's VNC console to fix it.

---

## Step 6 — Manual: Configure Firewall

**UFW (OS-level firewall):**

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP'
ufw allow 443/tcp  comment 'HTTPS'
ufw enable

# Verify
ufw status verbose
```

**Contabo control panel firewall:**

Log in to your Contabo customer panel at `my.contabo.com`. Navigate to your VPS → Firewall. Add the same rules there:

| Direction | Protocol | Port | Action |
|---|---|---|---|
| Inbound | TCP | 22 | Allow |
| Inbound | TCP | 80 | Allow |
| Inbound | TCP | 443 | Allow |
| Inbound | ALL | ALL | Deny |

> Both the Contabo panel firewall and UFW must allow a port for traffic to reach it.

---

## Step 7 — Manual: Install Docker CE

```bash
# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Add the repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list

# Install
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add deploy user to docker group
usermod -aG docker deploy

# Verify
docker run hello-world
docker compose version
```

> Use `docker compose` (plugin, no hyphen) — not the legacy `docker-compose` v1.

---

## Step 8 — Manual: Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify
node --version   # Should be v20.x.x
npm --version
```

---

## Step 9 — Manual: Install K3s

K3s is a lightweight Kubernetes distribution that runs without nested virtualization — solving the Contabo VPS limitation.

```bash
# Install K3s (systemd service starts automatically)
curl -sfL https://get.k3s.io | sh -

# Verify K3s is running
k3s kubectl get nodes

# Copy kubeconfig for the deploy user
mkdir -p /home/deploy/.kube
cp /etc/rancher/k3s/k3s.yaml /home/deploy/.kube/config
chown deploy:deploy /home/deploy/.kube/config
chmod 600 /home/deploy/.kube/config

echo 'export KUBECONFIG=/home/deploy/.kube/config' >> /home/deploy/.bashrc

# Create a kubectl alias
echo 'alias kubectl="k3s kubectl"' >> /home/deploy/.bashrc
source /home/deploy/.bashrc

# Verify as deploy user
kubectl get nodes
```

**K3s vs full Kubernetes:**

| Feature | K3s | Full K8s |
|---|---|---|
| Nested virt required | ❌ No | ✅ Yes |
| Memory footprint | ~512 MB | ~2+ GB |
| Kubectl compatible | ✅ Yes | ✅ Yes |
| Ingress controller | Traefik (built-in) | Install separately |
| Metrics server | Built-in | Install separately |
| HPA support | ✅ Yes | ✅ Yes |
| Cert-manager | Install separately | Install separately |

---

## Step 10 — Manual: Install Caddy

Caddy is the reverse proxy that handles HTTPS termination and routes traffic to your app and API. It auto-provisions Let's Encrypt certificates.

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list

apt update && apt install caddy -y

# Verify
caddy version
systemctl status caddy
```

Copy the app Caddyfile into place:

```bash
cp /opt/enterprise-app/infra/caddy/Caddyfile /etc/caddy/Caddyfile

# Edit with your real domain
nano /etc/caddy/Caddyfile

# Validate
caddy validate --config /etc/caddy/Caddyfile

# Start (only after DNS is pointing to this VPS)
systemctl start caddy
systemctl enable caddy
```

---

## Step 11 — Manual: Install Fail2ban

```bash
apt install fail2ban -y

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled  = true
port     = ssh
maxretry = 3
bantime  = 86400
EOF

systemctl enable fail2ban --now
systemctl restart fail2ban

# Check status
fail2ban-client status
fail2ban-client status sshd
```

---

## Step 12 — Point Your Domain

In your DNS provider, create A records pointing to your VPS IP:

```
@        A    YOUR_VPS_IP    (apex domain — yourdomain.com)
api      A    YOUR_VPS_IP
grafana  A    YOUR_VPS_IP    (optional — can restrict by IP in Caddyfile)
www      A    YOUR_VPS_IP
```

DNS propagation typically takes 5–30 minutes. Caddy will not obtain a TLS cert until DNS resolves correctly.

Verify DNS is working:

```bash
dig +short yourdomain.com
dig +short api.yourdomain.com
# Both should return your VPS IP
```

---

## Step 13 — Accessing Monitoring Dashboards Securely

Grafana, Prometheus, and Jaeger are bound to `127.0.0.1` only — never exposed directly on the internet. Access them via SSH tunneling:

```bash
# Create tunnels (run on your LOCAL machine, not the VPS)
ssh -N -L 3030:localhost:3030 \
       -L 9090:localhost:9090 \
       -L 16686:localhost:16686 \
       -L 4242:localhost:4242 \
    deploy@YOUR_VPS_IP

# Keep this terminal open, then visit:
# http://localhost:3030  → Grafana
# http://localhost:9090  → Prometheus
# http://localhost:16686 → Jaeger tracing
# http://localhost:4242  → Unleash feature flags
```

---

## Post-Setup Checklist

Work through each item after the bootstrap is complete:

- [ ] SSH key login works for `deploy` user
- [ ] Root login is disabled (test: `ssh root@VPS_IP` should fail)
- [ ] `ufw status` shows ports 22, 80, 443 open
- [ ] Contabo panel firewall matches UFW rules
- [ ] `free -h` shows 8 GB swap available
- [ ] `docker --version` returns 25+
- [ ] `k3s kubectl get nodes` returns a Ready node
- [ ] Caddy is running: `systemctl status caddy`
- [ ] DNS A records resolve to VPS IP: `dig +short yourdomain.com`
- [ ] HTTPS works: `curl -I https://yourdomain.com`
- [ ] All stack containers healthy: `docker compose ps`
- [ ] API health check passes: `curl https://api.yourdomain.com/health/live`
- [ ] Vault initialized and unsealed
- [ ] Unleash default password changed
- [ ] Auto-start on reboot enabled: `systemctl is-enabled enterprise-app`

---

## Reboot Procedure

After any reboot (planned or unplanned):

```bash
# 1. Check services came back up
systemctl status docker
systemctl status k3s
systemctl status caddy

# 2. Check containers are running
docker compose -f /opt/enterprise-app/docker-compose.yml ps

# 3. Unseal Vault (seals itself on every restart)
cd /opt/enterprise-app
docker compose exec vault vault operator unseal <unseal-key-1>
docker compose exec vault vault operator unseal <unseal-key-2>
docker compose exec vault vault operator unseal <unseal-key-3>

# 4. Restart API after Vault is unsealed
docker compose restart api

# 5. Verify
curl http://localhost:3001/health/ready
```

---

## Useful Contabo-Specific Notes

**VNC Console:** If you lock yourself out of SSH, log in to `my.contabo.com` and use the VNC console — it gives you browser-based terminal access without SSH.

**Snapshots:** Contabo offers VPS snapshots in the control panel. Take one before major changes.

**Backups:** Contabo offers automated backups as an add-on. Enable it for production servers. Also back up your Vault unseal keys and database separately.

**DDoS protection:** Contabo includes basic DDoS protection on all plans. For application-level protection, consider Cloudflare in front of Caddy.

**IPv6:** Contabo VPS plans include both IPv4 and IPv6. The stack is configured for IPv4 but works on dual-stack. Update Caddyfile if you need explicit IPv6 binding.
