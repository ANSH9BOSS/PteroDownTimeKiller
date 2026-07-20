# ⚡ PteroDownTimeKiller

> **High-Availability Active-Active Failover System for Pterodactyl Panels with Zero-Install Panel Cloning, Discord Webhook commands, and Google Drive Offsite Storage.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Pterodactyl](https://img.shields.io/badge/Pterodactyl-v1.x-blue)](https://pterodactyl.io)
[![Failover](https://img.shields.io/badge/Failover-Active--Active-green)](#how-it-works)
[![Free & Open Source](https://img.shields.io/badge/Cost-100%25%20FREE-brightgreen)](#100-free--open-source)

---

## 🚀 Quick Start (Production Setup)

### Step 1: Run on Primary VPS (Panel A - Existing Panel)
Run this command on your **existing Pterodactyl Panel VPS**:

```bash
curl -fsSL "https://raw.githubusercontent.com/ANSH9BOSS/PteroDownTimeKiller/main/install.sh?v=$(date +%s)" | sudo bash -s -- --role primary
```
*This command auto-detects your PHP version, configures your database, generates Nginx reverse proxy blocks, and prints the exact join command for VPS 2.*

### Step 2: Run Auto-Generated Command on Secondary VPS (Fresh Panel B)
Paste the **custom command printed at the end of Step 1** onto your **clean fresh Ubuntu VPS 2**:

```bash
curl -fsSL "https://raw.githubusercontent.com/ANSH9BOSS/PteroDownTimeKiller/main/install.sh?v=$(date +%s)" | sudo bash -s -- --role secondary --peer-ip <vps-1-ip-or-domain> --secret YOUR_SECRET_HERE
```
* **Zero-Install Panel Cloning**: VPS 2 automatically installs Nginx, MariaDB, PHP 8.1/8.2/8.3, clones your entire Pterodactyl Panel codebase (custom themes, extensions, eggs, users & database dump) over Nginx Port 80 proxy, and initializes the local MariaDB permissions!

---

## 📐 Architecture & Routing

PteroDownTimeKiller operates fully Active-Active. Both panel database modifications are synced in real-time.

```
                  ┌────────────────────────────────────────┐
                  │          panel.quoroxcloud.fun         │
                  │        (Cloudflare / Route53 LB)       │
                  └───────────────────┬────────────────────┘
                                      │
             ┌────────────────────────┴────────────────────────┐
             ▼ (Port 80/443)                                    ▼ (Port 80/443)
┌───────────────────────────────┐              ┌───────────────────────────────┐
│     VPS 1 (Panel A)           │              │     VPS 2 (Panel B)           │
│  Nginx Proxy to Sync Daemon   │◄────────────►│  Nginx Proxy to Sync Daemon   │
│  (Real-Time File/DB Watcher)  │  Private IP  │  (Real-Time File/DB Watcher)  │
└──────────────┬────────────────┘  (Port 80)   └──────────────┬────────────────┘
               │                                              │
               ▼                                              ▼
    [Discord Webhook Alerts]                        [Google Drive Backup]
    (Status, verify, snapshots)                    (Offsite DB & Node Tarball)
```

### 🔒 Firewall-Free Web Port Routing:
Instead of requiring public access to port `4000`, PteroDownTimeKiller injects a proxy pass handler inside Nginx on both VPS nodes:
```nginx
location /api/sync/ {
    proxy_pass http://127.0.0.1:4000;
}
```
All replication traffic travels through standard **Port 80/443** (fully secure & compatible with cloud network security groups).

---

## 🛠️ CLI Management Command Reference

### 1. Verification & Health Audit
Verify that both panel URLs match exactly and audit the connection status of all Pterodactyl Wings nodes:
```bash
sudo pterodowntimekiller verify
```

### 2. Configure Peer Connection (VPC Internal IP Routing)
If your servers are in the same VPC subnet (e.g. AWS EC2, Oracle Cloud), route synchronization internally by specifying their private IPs to bypass public NAT loopback restrictions:
```bash
# On VPS 1 (Primary)
sudo pterodowntimekiller peer <vps-2-private-ip> 80

# On VPS 2 (Secondary)
sudo pterodowntimekiller peer <vps-1-private-ip> 80
```

### 3. Setup Discord Webhooks
Set up your Discord Webhook URL interactively to receive failover alerts, backup files, and verification statuses:
```bash
sudo pterodowntimekiller webhook
```

### 4. Other Administration Utilities
```bash
# View active daemon configuration details
sudo pterodowntimekiller config

# Tail the last 50 lines of daemon synchronization events
sudo pterodowntimekiller logs

# Restart the active-active sync daemon
sudo pterodowntimekiller restart

# Create an immediate database & file snapshot
sudo pterodowntimekiller snapshot create

# List all local and Google Drive snapshots
sudo pterodowntimekiller snapshot list

# Trigger full offsite backup to Google Drive
sudo pterodowntimekiller gdrive backup

# Trigger manual synchronization
sudo pterodowntimekiller sync-now

# Send a test notification to Discord Webhook
sudo pterodowntimekiller webhook test

# Dispatch a custom announcement to Discord Webhook
sudo pterodowntimekiller webhook send "Failover validation test completed!"
```

---

## 🔀 Load Balancer Failover Setup
Configure your DNS provider (e.g. Cloudflare) to route your unified domain (`panel.quoroxcloud.fun`) to both origin servers:
1. Go to Cloudflare -> Traffic -> **Load Balancing**.
2. Create an **Origin Pool** containing:
   * **VPS 1 Public IP**
   * **VPS 2 Public IP**
3. Create a **Health Monitor**:
   * Path: `/api/sync/status` (Sync status endpoint)
   * Port: `80` (or `443`)
   * Interval: `10 seconds`
4. If VPS 1 goes down, Cloudflare automatically drops VPS 1 from the rotation and routes 100% of the traffic to VPS 2 instantly.

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
