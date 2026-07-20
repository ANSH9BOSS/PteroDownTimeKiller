# ⚡ PteroDownTimeKiller

> **High-Availability Active-Active Failover System for Pterodactyl Panels with Zero-Install Panel Cloning, Discord Webhook Bot, and Google Drive Offsite Storage.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Pterodactyl](https://img.shields.io/badge/Pterodactyl-v1.x-blue)](https://pterodactyl.io)
[![Active-Active](https://img.shields.io/badge/Failover-Active--Active-green)](#how-it-works)
[![Free & Open Source](https://img.shields.io/badge/Cost-100%25%20FREE-brightgreen)](#100-free--open-source)

---

## 🚀 Quick Start (1-Command Installation)

### Step 1: Run on Primary VPS (Panel A - Existing Panel)
Run this command on your **existing Pterodactyl Panel VPS**:

```bash
curl -fsSL https://raw.githubusercontent.com/ANSH9BOSS/PteroDownTimeKiller/main/install.sh | sudo bash -s -- --role primary
```

### Step 2: Run Auto-Generated Command on Secondary VPS (Fresh Panel B)
At the end of Step 1, the installer will print a **custom 1-line command**. Run that command on a **clean fresh Ubuntu VPS 2**:

```bash
curl -fsSL https://raw.githubusercontent.com/ANSH9BOSS/PteroDownTimeKiller/main/install.sh | sudo bash -s -- --role secondary --peer-ip 1.2.3.4 --secret YOUR_SECRET_HERE
```

✨ **Zero-Install Panel Cloning**: VPS 2 automatically installs Nginx, MariaDB, PHP 8.2/8.3, clones your entire Pterodactyl Panel (files, custom themes, extensions, eggs, users & MySQL database), configures Nginx, and connects active-active synchronization!

---

## 📐 Architecture Overview

```
+-----------------------------------------------------------------------------------+
|                            VPS 1 (Primary - Existing Panel)                       |
| 1-Line Installer ---> Configures Panel A, WireGuard IP: 10.0.0.1, Token           |
|                 ---> Generates 1-line command containing clone credentials        |
+-----------------------------------------------------------------------------------+
                                         │ (Paste command on FRESH VPS 2)
                                         ▼
+-----------------------------------------------------------------------------------+
|                             VPS 2 (Secondary - Fresh OS)                          |
| 1. Auto-installs Nginx, MariaDB, PHP 8.2/8.3, Composer                             |
| 2. Connects to VPS 1 via WireGuard (10.0.0.2 <-> 10.0.0.1)                          |
| 3. Clones /var/www/pterodactyl (Panel, extensions, eggs, themes) from VPS 1        |
| 4. Imports MySQL database snapshot from VPS 1                                     |
| 5. Configures Nginx site & PHP-FPM pool                                           |
| 6. Launches PteroDownTimeKiller Daemon -> Instant Real-Time Active-Active Sync     |
+-----------------------------------------------------------------------------------+
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
Wings Nodes ──► panel.yourdomain.com   [Google Drive Backup]   [Discord Interactive Bot]
 (HAProxy / Cloudflare LB)              (Panel + DB + Nodes)    (!ptero status/snapshot/backup)
```

---

## 🌟 Key Features

- **⚡ Real-Time Active-Active Sync**: Bi-directional file (`chokidar`) and MySQL database replication across panels.
- **🪄 Zero-Install Panel Cloning**: No need to manually install Pterodactyl on VPS 2. It auto-clones panel code, custom themes, extensions, eggs, users, and DB from VPS 1.
- **💬 Interactive Discord Webhook Bot**: Control and monitor your cluster directly in Discord:
  - `!ptero status` / `/status` - View live cluster health, peer latency & sync state.
  - `!ptero snapshot create` / `/snapshot create` - Take instant DB & node data snapshot.
  - `!ptero snapshot list` / `/snapshot list` - View available snapshots.
  - `!ptero gdrive backup` / `/gdrive backup` - Offsite backup of Panel, DB, extensions, eggs & Wings config to Google Drive.
  - `!ptero sync-now` / `/sync-now` - Force manual re-sync between panels.
- **☁️ Google Drive Offsite Storage**: Offsite archiving of MySQL database dumps, full Pterodactyl files, eggs, extensions, and Wings `/etc/pterodactyl` node configurations.
- **📊 Glassmorphic Live Web Dashboard**: Dark mode monitoring interface at `http://<your-vps-ip>:4000/dashboard`.
- **🛠️ System CLI Tool (`pterodowntimekiller`)**: Command-line tool for admins (`status`, `snapshot`, `gdrive backup`, `sync-now`, `webhook`).
- **🔀 Free HAProxy & Cloudflare Load Balancer Ready**: Supports both 100% free self-hosted HAProxy and Cloudflare Load Balancer ($5/mo).

---

## 🔀 Load Balancer Setup

### Option A: Cloudflare Load Balancer (Recommended)
1. Add Pool with Panel A IP (`1.2.3.4`) and Panel B IP (`5.6.7.8`).
2. Add Health Monitor:
   - Type: `HTTP`
   - Path: `/api/sync/status`
   - Expected Response: `200 OK`
   - Interval: `10s`

### Option B: 100% Free HAProxy Failover Setup
Run the included HAProxy generator script:
```bash
sudo bash /opt/pterodowntimekiller/scripts/setup-haproxy.sh 10.0.0.1 10.0.0.2
```

---

## 🛠️ CLI Management Command Reference

```bash
# View live cluster status and WireGuard peer latency
pterodowntimekiller status

# Create an immediate MySQL & node data snapshot
pterodowntimekiller snapshot create

# List all local & Google Drive snapshots
pterodowntimekiller snapshot list

# Trigger full offsite backup to Google Drive
pterodowntimekiller gdrive backup

# Dispatch custom message to Discord Webhook
pterodowntimekiller webhook send "Failover test complete!"
```

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
