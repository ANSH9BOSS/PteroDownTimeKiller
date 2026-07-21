# ⚡ PteroDownTimeKiller

> **High-Availability Active-Active Failover System for Pterodactyl Panels with Zero-Install Panel Cloning, Trigger-Based Real-Time DB Sync, Discord Webhook commands, and Google Drive Offsite Storage.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Pterodactyl](https://img.shields.io/badge/Pterodactyl-v1.x-blue)](https://pterodactyl.io)
[![Failover](https://img.shields.io/badge/Failover-Active--Active-green)](#how-it-works)
[![Free & Open Source](https://img.shields.io/badge/Cost-100%25%20FREE-brightgreen)](#100-free--open-source)

---

## 📐 Architecture & Routing Concept

PteroDownTimeKiller operates fully Active-Active. Rather than relying on traditional master-slave replication, it uses a lightweight, event-driven architecture designed specifically for Pterodactyl.

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

### 1. Real-Time File Sync
Hooks directly into the Linux Kernel via `inotify` (using `chokidar`). Any changes in panel code, custom themes, assets, or eggs are pushed instantly (under 100ms) to the peer node.

### 2. Transactional Database Replication (MySQL Triggers)
To ensure near-zero database latency and absolute consistency:
* Dynamic MySQL triggers are placed on core tables (`users`, `nodes`, `servers`, `locations`, `allocations`, `mounts`, `nests`, `eggs`, `api_keys`).
* Triggers record database write operations (`INSERT`, `UPDATE`, `DELETE`) into a local `pterodowntimekiller_changelog` table queue.
* The sync daemon polls this queue every second, pushes changes to the peer, and removes them from the queue only after a successful delivery.
* **Loop Prevention**: Writes applied by the sync engine use a connection-scoped variable (`SET @pterodowntimekiller_sync = 1`) which tells the peer triggers to skip logging, preventing endless replication loops.

---

## 🚀 Step-by-Step Production Setup Guide

### 📋 Prerequisites
* **VPS 1 (Primary)**: An active, running Pterodactyl Panel.
* **VPS 2 (Secondary)**: A clean, fresh Ubuntu server.
* Both VPS instances must be in the same private subnet (VPC) or have private IP routing enabled.
* Unified Domain (e.g. `panel.quoroxcloud.fun`) pointing to Cloudflare.

---

### Step 1: Run Installer on Primary VPS (Panel A)
Run this command on your **existing Pterodactyl Panel VPS**:

```bash
curl -fsSL "https://raw.githubusercontent.com/ANSH9BOSS/PteroDownTimeKiller/main/install.sh?v=$(date +%s)" | sudo bash -s -- --role primary
```
* **What happens**: Auto-detects PHP version, initializes the changelog database, dynamically sets up MySQL triggers, patches Nginx to route sync API endpoints, restarts services, and prints a **custom joining command** with a unique sync secret token.

---

### Step 2: Run Auto-Generated Command on Secondary VPS (Panel B)
Paste the **custom command printed at the end of Step 1** onto your **clean fresh Ubuntu VPS 2** (remember to replace the public domain with **VPS 1's Private IP** to bypass Cloudflare):

```bash
curl -fsSL "https://raw.githubusercontent.com/ANSH9BOSS/PteroDownTimeKiller/main/install.sh?v=$(date +%s)" | sudo bash -s -- --role secondary --peer-ip <vps-1-private-ip> --secret YOUR_SECRET_HERE
```
* **What happens**: Installs Nginx, MariaDB, PHP; clones your Pterodactyl panel codebase (themes, extensions, uploads) and database; registers database triggers; generates a self-signed SSL certificate so that **Cloudflare Full SSL mode works out-of-the-box** without redirect loops; restarts the daemon.

---

### Step 3: Establish Peer Pairing (Bi-directional Link)
Now configure both daemons to route synchronization requests directly over their private VPC IPs:

```bash
# 1. On VPS 1 (Primary) - Point it to VPS 2's Private IP
sudo pterodowntimekiller peer <vps-2-private-ip> 80

# 2. On VPS 2 (Secondary) - Point it to VPS 1's Private IP
sudo pterodowntimekiller peer <vps-1-private-ip> 80
```

Verify that they are matched and the cluster is healthy:
```bash
sudo pterodowntimekiller verify
```

---

### Step 4: Configure Cloudflare Load Balancer
Configure your DNS provider (e.g. Cloudflare) to route your unified domain (`panel.quoroxcloud.fun`) to both origin servers:
1. Go to Cloudflare Dashboard -> Traffic -> **Load Balancing**.
2. Create an **Origin Pool** containing:
   * **VPS 1 Public IP**
   * **VPS 2 Public IP**
3. Create a **Health Monitor**:
   * Path: `/api/sync/status` (Sync status endpoint)
   * Port: `80` (or `443` HTTPS)
   * Interval: `10 seconds`

---

### Step 5: Bypass Cloudflare WAF for Local Wings
If your game nodes (Wings daemon) are running on the same machine as the panel, Cloudflare's Bot Mitigation WAF will block local API calls with a `403 Managed Challenge`. 

To bypass this securely while keeping Let's Encrypt SSL functional, add a local DNS override to the `/etc/hosts` file on your Wings server:
```bash
echo "127.0.0.1 panel.quoroxcloud.fun" | sudo tee -a /etc/hosts
```
Restart the Wings service:
```bash
sudo systemctl restart wings
```

---

## 🧪 Interactive Failover & Recovery Testing

Follow this scenario to test your active-active failover and automatic catchup logs:

### 1. Test Active Replication (Both Online)
1. Log into your panel and **create a test user** (e.g., `realtime_test`).
2. Open the other VPS panel in your browser—the user is there instantly.

### 2. Test Failover (VPS 1 Crashed)
1. Stop the web stack on VPS 1:
   ```bash
   sudo systemctl stop nginx
   ```
2. Refresh your panel. Cloudflare detects the crash and routes you to VPS 2 automatically.
3. **Create a user** on the panel (e.g. `crashed_vps1`). This change is queued in the local database queue on VPS 2.

### 3. Test Auto-Heal (VPS 1 Recovers)
1. Start Nginx back up on VPS 1:
   ```bash
   sudo systemctl start nginx
   ```
2. The sync daemon on VPS 2 detects VPS 1 is back online, fetches the queue, and automatically syncs `crashed_vps1` to VPS 1.
3. Stop Nginx on VPS 2 (`sudo systemctl stop nginx`) to route your browser back to VPS 1.
4. Refresh your panel—**the user created during the crash is fully recovered and present on VPS 1!**

---

## 🛠️ CLI Command Reference

```bash
# Verify cluster alignment and Wings node status
sudo pterodowntimekiller verify

# Route sync traffic privately
sudo pterodowntimekiller peer <peer-private-ip> 80

# Configure Discord Webhook notifications
sudo pterodowntimekiller webhook

# Test Discord Webhook notification
sudo pterodowntimekiller webhook test

# View active sync configuration
sudo pterodowntimekiller config

# Monitor real-time sync events
sudo pterodowntimekiller logs

# Restart sync daemon service
sudo pterodowntimekiller restart
```

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
