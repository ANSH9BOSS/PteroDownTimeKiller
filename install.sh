#!/usr/bin/env bash
set -e

ROLE="primary"
PEER_IP=""
SECRET=""
WG_PUBKEY=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --role)
      ROLE="$2"
      shift 2
      ;;
    --peer-ip)
      PEER_IP="$2"
      shift 2
      ;;
    --secret)
      SECRET="$2"
      shift 2
      ;;
    --wg-peer-pubkey)
      WG_PUBKEY="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

echo "====================================================================="
echo "⚡ PteroDownTimeKiller - Active-Active Failover System Installer"
echo "====================================================================="

# Clean any existing dangling symlinks safely
rm -rf /usr/local/bin/pterodowntimekiller 2>/dev/null || true
unlink /usr/local/bin/pterodowntimekiller 2>/dev/null || true

# Check root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Error: Please run install.sh as root (sudo)."
  exit 1
fi

# Detect Public IP
PUBLIC_IP=$(curl -fsSL https://api.ipify.org || echo "127.0.0.1")

# Install Node.js & Git if missing
if ! command -v git &> /dev/null; then
  echo "📦 Installing Git..."
  apt-get update -qq && apt-get install -y -qq git > /dev/null 2>&1
fi

if ! command -v node &> /dev/null; then
  echo "📦 Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
fi

# Create daemon directory & user config
mkdir -p /etc/pterodowntimekiller
mkdir -p /var/log/pterodowntimekiller

echo "📥 Fetching PteroDownTimeKiller codebase..."
rm -rf /opt/pterodowntimekiller
git clone --depth 1 https://github.com/ANSH9BOSS/PteroDownTimeKiller.git /opt/pterodowntimekiller

cd /opt/pterodowntimekiller
echo "📦 Installing daemon dependencies..."
npm install --quiet > /dev/null 2>&1

# Set permissions on executable binary
chmod +x /opt/pterodowntimekiller/bin/pterodowntimekiller 2>/dev/null || true

# Safely recreate system symlink
rm -rf /usr/local/bin/pterodowntimekiller 2>/dev/null || true
ln -sf /opt/pterodowntimekiller/bin/pterodowntimekiller /usr/local/bin/pterodowntimekiller
chmod +x /usr/local/bin/pterodowntimekiller 2>/dev/null || true

if [ "$ROLE" == "primary" ]; then
  echo "🚀 Configuring VPS 1 (Primary Node / Panel A)..."
  
  if [ -z "$SECRET" ]; then
    SECRET=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32)
  fi

  # Parse database credentials from local Pterodactyl config
  DB_HOST="127.0.0.1"
  DB_PORT=3306
  DB_NAME="panel"
  DB_USER="pterodactyl"
  DB_PASS="pterodactyl_password"

  if [ -f "/var/www/pterodactyl/.env" ]; then
    DB_HOST=$(grep "^DB_HOST=" /var/www/pterodactyl/.env | cut -d'=' -f2- | tr -d '\r' | xargs 2>/dev/null || echo "127.0.0.1")
    DB_PORT=$(grep "^DB_PORT=" /var/www/pterodactyl/.env | cut -d'=' -f2- | tr -d '\r' | xargs 2>/dev/null || echo "3306")
    DB_NAME=$(grep "^DB_DATABASE=" /var/www/pterodactyl/.env | cut -d'=' -f2- | tr -d '\r' | xargs 2>/dev/null || echo "panel")
    DB_USER=$(grep "^DB_USERNAME=" /var/www/pterodactyl/.env | cut -d'=' -f2- | tr -d '\r' | xargs 2>/dev/null || echo "pterodactyl")
    DB_PASS=$(grep "^DB_PASSWORD=" /var/www/pterodactyl/.env | cut -d'=' -f2- | tr -d '\r' | xargs 2>/dev/null || echo "pterodactyl_password")
  fi

  cat << EOF > /etc/pterodowntimekiller/config.json
{
  "node": {
    "id": "panel-a",
    "port": 4000,
    "publicIp": "${PUBLIC_IP}",
    "wireguardIp": "10.0.0.1"
  },
  "peer": {
    "host": "10.0.0.2",
    "port": 4000
  },
  "secret": "${SECRET}",
  "watch": [
    "/var/www/pterodactyl"
  ],
  "database": {
    "host": "${DB_HOST}",
    "port": ${DB_PORT},
    "name": "${DB_NAME}",
    "user": "${DB_USER}",
    "pass": "${DB_PASS}"
  },
  "discord": {
    "enabled": true,
    "webhookUrl": ""
  }
}
EOF

  node /opt/pterodowntimekiller/scripts/mysql-tuning.js || true
  node /opt/pterodowntimekiller/scripts/nginx-patch.js || true

  # Systemd service
  cat << EOF > /etc/systemd/system/pterodowntimekiller.service
[Unit]
Description=PteroDownTimeKiller Active-Active Failover Daemon
After=network.target mariadb.service nginx.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/pterodowntimekiller
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

  # Configure Firewall
  if command -v ufw &> /dev/null; then
    echo "🔥 Configuring UFW Firewall..."
    ufw allow 4000/tcp || true
    ufw allow 51820/udp || true
  fi

  systemctl daemon-reload
  node /opt/pterodowntimekiller/scripts/setup-db-triggers.js || true
  systemctl enable pterodowntimekiller || true
  systemctl restart pterodowntimekiller || true

  # Extract Primary Domain Name
  PRIMARY_DOMAIN=""
  if [ -f "/var/www/pterodactyl/.env" ]; then
    APP_URL=$(grep "^APP_URL=" /var/www/pterodactyl/.env | cut -d'=' -f2- | tr -d '\r' | xargs)
    PRIMARY_DOMAIN=$(echo "$APP_URL" | awk -F[/:] '{print $4}')
  fi

  if [ -z "$PRIMARY_DOMAIN" ]; then
    PRIMARY_DOMAIN="${PUBLIC_IP}"
  fi

  echo ""
  echo "====================================================================="
  echo "✅ Primary Panel A Setup Complete!"
  echo "---------------------------------------------------------------------"
  echo "Copy and paste this EXACT command onto VPS 2 (Fresh Secondary Panel B):"
  echo ""
  echo "curl -fsSL \"https://raw.githubusercontent.com/ANSH9BOSS/PteroDownTimeKiller/main/install.sh?v=\$(date +%s)\" | sudo bash -s -- --role secondary --peer-ip ${PRIMARY_DOMAIN} --secret ${SECRET}"
  echo "====================================================================="
  echo ""

else
  echo "🚀 Configuring VPS 2 (Secondary Node / Zero-Install Panel B)..."

  # Invoke automated panel cloner
  bash /opt/pterodowntimekiller/scripts/clone-panel.sh "${PEER_IP}" "${SECRET}"

  # Parse database credentials from cloned local Pterodactyl config
  DB_HOST="127.0.0.1"
  DB_PORT=3306
  DB_NAME="panel"
  DB_USER="pterodactyl"
  DB_PASS="pterodactyl_password"

  if [ -f "/var/www/pterodactyl/.env" ]; then
    DB_HOST=$(grep "^DB_HOST=" /var/www/pterodactyl/.env | cut -d'=' -f2- | tr -d '\r' | xargs 2>/dev/null || echo "127.0.0.1")
    DB_PORT=$(grep "^DB_PORT=" /var/www/pterodactyl/.env | cut -d'=' -f2- | tr -d '\r' | xargs 2>/dev/null || echo "3306")
    DB_NAME=$(grep "^DB_DATABASE=" /var/www/pterodactyl/.env | cut -d'=' -f2- | tr -d '\r' | xargs 2>/dev/null || echo "panel")
    DB_USER=$(grep "^DB_USERNAME=" /var/www/pterodactyl/.env | cut -d'=' -f2- | tr -d '\r' | xargs 2>/dev/null || echo "pterodactyl")
    DB_PASS=$(grep "^DB_PASSWORD=" /var/www/pterodactyl/.env | cut -d'=' -f2- | tr -d '\r' | xargs 2>/dev/null || echo "pterodactyl_password")
  fi

  # Align MariaDB user password with parsed .env password
  mysql -e "ALTER USER 'pterodactyl'@'localhost' IDENTIFIED BY '${DB_PASS}';" || true
  mysql -e "FLUSH PRIVILEGES;" || true

  cat << EOF > /etc/pterodowntimekiller/config.json
{
  "node": {
    "id": "panel-b",
    "port": 4000,
    "publicIp": "${PUBLIC_IP}",
    "wireguardIp": "10.0.0.2"
  },
  "peer": {
    "host": "10.0.0.1",
    "port": 4000
  },
  "secret": "${SECRET}",
  "watch": [
    "/var/www/pterodactyl"
  ],
  "database": {
    "host": "${DB_HOST}",
    "port": ${DB_PORT},
    "name": "${DB_NAME}",
    "user": "${DB_USER}",
    "pass": "${DB_PASS}"
  },
  "discord": {
    "enabled": true,
    "webhookUrl": ""
  }
}
EOF

  cat << EOF > /etc/systemd/system/pterodowntimekiller.service
[Unit]
Description=PteroDownTimeKiller Active-Active Failover Daemon
After=network.target mariadb.service nginx.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/pterodowntimekiller
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

  # Configure Firewall
  if command -v ufw &> /dev/null; then
    echo "🔥 Configuring UFW Firewall..."
    ufw allow 4000/tcp || true
    ufw allow 51820/udp || true
  fi

  systemctl daemon-reload
  node /opt/pterodowntimekiller/scripts/nginx-patch.js || true
  node /opt/pterodowntimekiller/scripts/setup-db-triggers.js || true
  systemctl enable pterodowntimekiller || true
  systemctl restart pterodowntimekiller || true

  echo ""
  echo "====================================================================="
  echo "🎉 CONGRATULATIONS! Panel B is Live and Synced with Panel A!"
  echo "====================================================================="
fi
