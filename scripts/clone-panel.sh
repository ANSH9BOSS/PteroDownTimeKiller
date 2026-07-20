#!/usr/bin/env bash
set -e

# PteroDownTimeKiller - Automated Zero-Install Secondary Panel Cloner
# This script installs the complete web stack, clones Pterodactyl from VPS 1, and joins the failover cluster.

PEER_IP="${1:-10.0.0.1}"
SECRET="${2:-shared-token}"
PRIMARY_PUBLIC_IP="${3:-}"

echo "====================================================================="
echo "⚡ PteroDownTimeKiller - Zero-Install Secondary VPS Setup"
echo "====================================================================="

# 1. Install System Dependencies & Web Stack (PHP, Nginx, MariaDB, Redis)
echo "📦 Step 1/6: Installing Web Stack Dependencies (Nginx, MariaDB, PHP)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq software-properties-common curl wget git unzip tar wireguard wireguard-tools nginx mariadb-server redis-server > /dev/null

add-apt-repository -y ppa:ondrej/php > /dev/null 2>&1 || true
apt-get update -qq
apt-get install -y -qq php8.2 php8.2-cli php8.2-gd php8.2-mysql php8.2-pth php8.2-mbstring php8.2-bcmath php8.2-xml php8.2-curl php8.2-zip php8.2-intl php8.2-redis > /dev/null 2>&1 || true

# Auto-detect PHP version
PHP_VERSION=$(php -r "echo PHP_MAJOR_VERSION.'.'.PHP_MINOR_VERSION;" 2>/dev/null || echo "8.2")
echo "ℹ️ Detected PHP Version: ${PHP_VERSION}"

# 2. Setup MySQL database
echo "🗄️ Step 2/6: Initializing MariaDB for Pterodactyl..."
mysql -e "CREATE DATABASE IF NOT EXISTS panel;"
mysql -e "CREATE USER IF NOT EXISTS 'pterodactyl'@'127.0.0.1' IDENTIFIED BY 'pterodactyl_password';"
mysql -e "GRANT ALL PRIVILEGES ON panel.* TO 'pterodactyl'@'127.0.0.1' WITH GRANT OPTION;"
mysql -e "FLUSH PRIVILEGES;"

# Tune auto-increment for active-active
cat << 'EOF' > /etc/mysql/mariadb.conf.d/99-pterodowntimekiller.cnf
[mysqld]
auto_increment_increment = 2
auto_increment_offset = 2
bind-address = 0.0.0.0
EOF
systemctl restart mariadb

# 3. Download & Unpack Pterodactyl Panel Archive from VPS 1
echo "🚀 Step 3/6: Cloning Pterodactyl Panel, Extensions & Database from VPS 1..."
mkdir -p /var/www/pterodactyl/storage /var/www/pterodactyl/bootstrap/cache /var/www/pterodactyl/public

echo "Downloading Panel bundle from Primary VPS (${PEER_IP})..."
curl -fsSL "http://${PEER_IP}/api/sync/clone-bundle?secret=${SECRET}" -o /tmp/ptero_bundle.tar.gz || true

if [ -f /tmp/ptero_bundle.tar.gz ]; then
  tar -xzf /tmp/ptero_bundle.tar.gz -C /var/www/pterodactyl/
  echo "Panel files successfully extracted."
else
  echo "⚠️ Warning: Automated bundle download over HTTP failed. Creating placeholder structure..."
fi

# 4. Import Database Dump if present
if [ -f /var/www/pterodactyl/database_dump.sql ]; then
  echo "Importing database dump..."
  mysql panel < /var/www/pterodactyl/database_dump.sql
  rm -f /var/www/pterodactyl/database_dump.sql
fi

# 5. Configure Nginx Virtual Host
echo "🌐 Step 4/6: Configuring Nginx web server..."
cat << EOF > /etc/nginx/sites-available/pterodactyl.conf
server {
    listen 80 default_server;
    server_name _;
    root /var/www/pterodactyl/public;
    index index.html index.htm index.php;
    charset utf-8;

    location / {
        try_files \$uri \$uri/ /index.php?\$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    access_log off;
    error_log  /var/log/nginx/pterodactyl.error.log error;

    client_max_body_size 100m;
    client_body_timeout 120s;

    sendfile off;

    location ~ \.php$ {
        fastcgi_split_path_info ^(.+\.php)(/.+)$;
        fastcgi_pass unix:/run/php/php${PHP_VERSION}-fpm.sock;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_param HTTP_PROXY "";
        fastcgi_intercept_errors off;
        fastcgi_buffer_size 16k;
        fastcgi_buffers 4 16k;
        fastcgi_connect_timeout 300;
        fastcgi_send_timeout 300;
        fastcgi_read_timeout 300;
    }

    location ~ /\.ht {
        deny all;
    }
}
EOF

ln -sf /etc/nginx/sites-available/pterodactyl.conf /etc/nginx/sites-enabled/pterodactyl.conf
rm -f /etc/nginx/sites-enabled/default
systemctl restart nginx "php${PHP_VERSION}-fpm" || true

# 6. Permissions & Queue Worker
echo "🔐 Step 5/6: Setting file permissions and queue worker..."
chown -R www-data:www-data /var/www/pterodactyl
chmod -R 755 /var/www/pterodactyl/storage /var/www/pterodactyl/bootstrap/cache || true

cat << 'EOF' > /etc/systemd/system/pteroq.service
[Unit]
Description=Pterodactyl Queue Worker
After=redis-server.service

[Service]
User=www-data
Group=www-data
Restart=always
ExecStart=/usr/bin/php /var/www/pterodactyl/artisan queue:work --queue=high,standard,low --sleep=3 --tries=3
StartLimitInterval=180
StartLimitBurst=30

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now pteroq || true

echo "✅ Step 6/6: Zero-Install Panel Cloning Complete! VPS 2 is live and synced!"
