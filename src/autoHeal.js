const axios = require('axios');
const logger = require('./logger');
const { getConfig } = require('./config');
const { applyIncomingDbChange } = require('./dbSync');
const { notifyRecovery, notifyAutoHealComplete, notifyFailover } = require('./webhooks');

let lastSyncTimestamp = Date.now();
let peerWasDown = false;

async function checkPeerHeartbeat() {
  const cfg = getConfig();
  if (!cfg.peer || !cfg.peer.host) return;

  const url = `http://${cfg.peer.host}:${cfg.peer.port}/api/sync/status`;
  const startTime = Date.now();

  try {
    const res = await axios.get(url, {
      timeout: 5000,
      headers: { 'x-sync-secret': cfg.secret }
    });

    const latency = Date.now() - startTime;
    global.peerLatencyMs = latency;
    global.peerConnected = true;

    if (peerWasDown) {
      logger.warn(`Peer node ${cfg.peer.host} has recovered! Starting auto-heal...`);
      peerWasDown = false;
      await notifyRecovery(cfg.peer.host);
      await runAutoHealCatchup();
    }
  } catch (err) {
    global.peerConnected = false;
    global.peerLatencyMs = null;

    if (!peerWasDown) {
      peerWasDown = true;
      logger.error(`Peer node ${cfg.peer.host} is unreachable! Triggering failover notification...`);
      await notifyFailover(cfg.peer.host, cfg.node.id);
    }
  }
}

async function runAutoHealCatchup() {
  const cfg = getConfig();
  logger.info(`Fetching missed changes from peer since timestamp ${lastSyncTimestamp}...`);

  const url = `http://${cfg.peer.host}:${cfg.peer.port}/api/sync/pull?since=${lastSyncTimestamp}`;
  try {
    const res = await axios.get(url, {
      headers: { 'x-sync-secret': cfg.secret },
      timeout: 30000
    });

    const { dbDeltas = [], fileCount = 0 } = res.data;

    let appliedDbCount = 0;
    for (const delta of dbDeltas) {
      const result = await applyIncomingDbChange(delta.table, delta.action, delta.recordData);
      if (result.success) appliedDbCount++;
    }

    lastSyncTimestamp = Date.now();
    logger.info(`Auto-heal completed successfully: Replayed ${appliedDbCount} DB deltas.`);
    await notifyAutoHealComplete(cfg.peer.host, fileCount, appliedDbCount);
  } catch (err) {
    logger.error(`Auto-heal catchup failed: ${err.message}`);
  }
}

function startAutoHealScanner(intervalMs = 5000) {
  logger.info(`Starting peer heartbeat scanner (every ${intervalMs}ms)...`);
  setInterval(checkPeerHeartbeat, intervalMs);
}

module.exports = {
  startAutoHealScanner,
  runAutoHealCatchup,
  checkPeerHeartbeat
};
