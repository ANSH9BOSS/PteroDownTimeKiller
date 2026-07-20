const express = require('express');
const logger = require('./logger');
const { getConfig } = require('./config');
const { handleIncomingFile } = require('./fileSync');
const { applyIncomingDbChange, getChangesSince } = require('./dbSync');
const { getDashboardHtml } = require('./dashboard');
const { handleDiscordCommand } = require('./discordBot');
const { createSnapshot } = require('./snapshotEngine');
const { performGDriveBackup } = require('./gdrive');

function setupApiRoutes(app) {
  // Middleware for secret authentication
  const authMiddleware = (req, res, next) => {
    const cfg = getConfig();
    const token = req.headers['x-sync-secret'] || req.query.secret;
    if (token && token === cfg.secret) {
      return next();
    }
    logger.warn(`Unauthorized API attempt from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid sync secret' });
  };

  // 1. Health Check Endpoint for Cloudflare Load Balancer
  app.get('/api/sync/status', (req, res) => {
    const cfg = getConfig();
    const isHealthy = true; // Returns 200 OK as long as local daemon & panel are operational

    if (isHealthy) {
      return res.status(200).json({
        status: 'healthy',
        node: cfg.node?.id || 'panel-a',
        role: 'active',
        timestamp: Date.now(),
        peerConnected: global.peerConnected || false,
        latencyMs: global.peerLatencyMs || null
      });
    } else {
      return res.status(503).json({ status: 'unhealthy' });
    }
  });

  // 2. Incoming File Sync Push
  app.post('/api/sync/push-file', authMiddleware, async (req, res) => {
    const { action, relPath, content } = req.body;
    if (!action || !relPath) {
      return res.status(400).json({ error: 'Missing action or relPath' });
    }

    const result = await handleIncomingFile(action, relPath, content);
    if (result.success) {
      return res.status(200).json({ status: 'ok' });
    } else {
      return res.status(500).json({ error: result.error });
    }
  });

  // 3. Incoming DB Sync Push
  app.post('/api/sync/push-db', authMiddleware, async (req, res) => {
    const { table, action, recordData } = req.body;
    if (!table || !action || !recordData) {
      return res.status(400).json({ error: 'Missing table, action or recordData' });
    }

    const result = await applyIncomingDbChange(table, action, recordData);
    if (result.success) {
      return res.status(200).json({ status: 'ok' });
    } else {
      return res.status(500).json({ error: result.error });
    }
  });

  // 4. Auto-Heal State Sync Reader
  app.get('/api/sync/pull', authMiddleware, (req, res) => {
    const { since } = req.query;
    const dbDeltas = getChangesSince(since);

    return res.status(200).json({
      timestamp: Date.now(),
      dbDeltas,
      fileCount: 0
    });
  });

  // 5. Automated Pairing Handshake
  app.post('/api/sync/handshake', authMiddleware, (req, res) => {
    const cfg = getConfig();
    logger.info(`Handshake initiated by secondary node: ${req.body?.nodeId}`);
    return res.status(200).json({
      status: 'paired',
      primaryNode: cfg.node?.id,
      timestamp: Date.now()
    });
  });

  // 6. Web Dashboard Route
  app.get('/dashboard', (req, res) => {
    const cfg = getConfig();
    res.send(getDashboardHtml(cfg));
  });

  // 7. Dashboard Actions API
  app.post('/api/dashboard/action', async (req, res) => {
    const { action } = req.body;
    if (action === 'snapshot-create') await createSnapshot('web_ui');
    if (action === 'gdrive-backup') await performGDriveBackup();
    if (action === 'sync-now') await handleDiscordCommand('sync-now');

    return res.json({ status: 'executed', action });
  });

  // 8. Discord Webhook Command Trigger API
  app.post('/api/webhook/command', async (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Command missing' });

    await handleDiscordCommand(command);
    return res.json({ status: 'command_dispatched', command });
  });
}

module.exports = {
  setupApiRoutes
};
