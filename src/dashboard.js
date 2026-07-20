const express = require('express');
const { getConfig } = require('./config');
const { listSnapshots } = require('./snapshotEngine');

function getDashboardHtml(cfg) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PteroDownTimeKiller - Live Failover Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
    body { background: #0f172a; color: #f8fafc; padding: 2rem; min-height: 100vh; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    .title { font-size: 1.8rem; font-weight: 700; background: linear-gradient(135deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .badge { padding: 0.4rem 0.8rem; border-radius: 9999px; font-weight: 600; font-size: 0.85rem; }
    .badge-online { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid #22c55e; }
    .badge-offline { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .card { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 1rem; padding: 1.5rem; }
    .card-title { font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .card-value { font-size: 1.8rem; font-weight: 700; }
    .actions { display: flex; gap: 1rem; margin-bottom: 2rem; }
    .btn { background: #3b82f6; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: 0.2s; }
    .btn:hover { background: #2563eb; transform: translateY(-2px); }
    .btn-purple { background: #8b5cf6; }
    .btn-purple:hover { background: #7c3aed; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="title">⚡ PteroDownTimeKiller</h1>
      <p style="color: #94a3b8;">Active-Active Real-Time Failover Dashboard</p>
    </div>
    <span class="badge ${global.peerConnected ? 'badge-online' : 'badge-offline'}">
      ${global.peerConnected ? 'PEER CONNECTED' : 'PEER OFFLINE / FAILOVER ACTIVE'}
    </span>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-title">Local Node ID</div>
      <div class="card-value">${cfg.node?.id || 'panel-a'}</div>
      <p style="color: #64748b; margin-top: 0.5rem; font-size: 0.85rem;">IP: ${cfg.node?.wireguardIp || '10.0.0.1'}</p>
    </div>

    <div class="card">
      <div class="card-title">Peer Latency</div>
      <div class="card-value">${global.peerLatencyMs ? global.peerLatencyMs + ' ms' : 'N/A'}</div>
      <p style="color: #64748b; margin-top: 0.5rem; font-size: 0.85rem;">WireGuard Encrypted Tunnel</p>
    </div>

    <div class="card">
      <div class="card-title">Sync Engine State</div>
      <div class="card-value" style="color: #34d399;">REALTIME</div>
      <p style="color: #64748b; margin-top: 0.5rem; font-size: 0.85rem;">File & DB Replication</p>
    </div>
  </div>

  <div class="actions">
    <button class="btn" onclick="triggerAction('sync-now')">🔄 Trigger Manual Sync</button>
    <button class="btn btn-purple" onclick="triggerAction('gdrive-backup')">☁️ Run Google Drive Backup</button>
    <button class="btn" style="background:#059669;" onclick="triggerAction('snapshot-create')">📸 Take DB Snapshot</button>
  </div>

  <script>
    async function triggerAction(cmd) {
      alert('Executing command: ' + cmd);
      await fetch('/api/dashboard/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: cmd })
      });
      location.reload();
    }
  </script>
</body>
</html>`;
}

module.exports = {
  getDashboardHtml
};
