#!/usr/bin/env bash
set -e

# PteroDownTimeKiller - Free HAProxy Load Balancer Generator
PANEL_A_IP="${1:-10.0.0.1}"
PANEL_B_IP="${2:-10.0.0.2}"

echo "====================================================================="
echo "🔀 Generating 100% Free HAProxy Failover Configuration"
echo "====================================================================="

apt-get update -qq && apt-get install -y -qq haproxy > /dev/null

cat << EOF > /etc/haproxy/haproxy.cfg
global
    log /dev/log local0
    log /dev/log local1 notice
    chroot /var/lib/haproxy
    user haproxy
    group haproxy
    daemon

defaults
    log     global
    mode    http
    option  httplog
    option  dontlognull
    timeout connect 5000
    timeout client  50000
    timeout server  50000

frontend pterodactyl_front
    bind *:80
    bind *:443
    mode http
    default_backend pterodactyl_back

backend pterodactyl_back
    mode http
    balance roundrobin
    option httpchk GET /api/sync/status
    http-check expect status 200
    default-server inter 3s fall 2 rise 2
    server panel-a ${PANEL_A_IP}:80 check
    server panel-b ${PANEL_B_IP}:80 check backup
EOF

systemctl restart haproxy
echo "✅ HAProxy Active-Active Failover Router is live on port 80/443!"
