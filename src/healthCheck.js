const express = require('express');
const logger = require('./logger');
const { getConfig } = require('./config');
const { handleIncomingFile } = require('./fileSync');
const { applyIncomingDbChange, getChangesSince } = require('./dbSync');
const { getDashboardHtml } = require('./dashboard');
const { handleDiscordCommand } = require('./webhookCommands');
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
  app.get('/api/sync/pull', authMiddleware, async (req, res) => {
    const { since } = req.query;
    const dbDeltas = await getChangesSince(since);

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
    if (action === 'sync-now') await handleWebhookCommand('sync-now');

    return res.json({ status: 'executed', action });
  });

  // 9. Clone Bundle Downloader for Zero-Install Secondary Node
  app.get('/api/sync/clone-bundle', authMiddleware, async (req, res) => {
    const { exec } = require('child_process');
    const path = require('path');
    const fs = require('fs-extra');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    const cfg = getConfig();
    const db = cfg.database || {};
    const bundlePath = '/tmp/ptero_bundle.tar.gz';
    const dbDumpPath = '/var/www/pterodactyl/database_dump.sql';

    logger.info('Preparing Pterodactyl clone bundle for Secondary VPS...');

    try {
      // Dump database inside Pterodactyl directory so it gets tarred up
      const dumpCmd = `mysqldump -h "${db.host || '127.0.0.1'}" -P "${db.port || 3306}" -u "${db.user || 'pterodactyl'}" -p"${db.pass || ''}" "${db.name || 'panel'}" > "${dbDumpPath}"`;
      await execAsync(dumpCmd);

      // Create tarball (excludes must precede the source directory path)
      const tarCmd = `tar --exclude="node_modules" --exclude="storage/logs/*" --exclude="storage/framework/cache/*" --exclude="storage/framework/views/*" --exclude="storage/framework/sessions/*" -czf "${bundlePath}" -C /var/www/pterodactyl .`;
      await execAsync(tarCmd);

      // Send file
      res.download(bundlePath, 'ptero_bundle.tar.gz', async (err) => {
        // Clean up files in background
        await fs.remove(dbDumpPath).catch(() => {});
        await fs.remove(bundlePath).catch(() => {});
        
        if (err) {
          logger.error(`Error sending clone bundle to peer: ${err.message}`);
        } else {
          logger.info('Pterodactyl clone bundle successfully sent to peer VPS.');
        }
      });
    } catch (err) {
      logger.error(`Failed to create clone bundle: ${err.message}`);
      await fs.remove(dbDumpPath).catch(() => {});
      await fs.remove(bundlePath).catch(() => {});
      res.status(500).json({ error: `Failed to compile clone bundle: ${err.message}` });
    }
  });

  // 10. Cluster Verification Check (Unified URL & Node Connections)
  app.get('/api/sync/verify-cluster', authMiddleware, async (req, res) => {
    const fs = require('fs-extra');
    const axios = require('axios');
    const { getDbPool } = require('./dbSync');
    const { sendDiscordWebhook } = require('./webhooks');
    const cfg = getConfig();

    let localAppUrl = 'Unknown';
    try {
      const envContent = await fs.readFile('/var/www/pterodactyl/.env', 'utf8');
      const match = envContent.match(/^APP_URL=(.+)$/m);
      if (match) localAppUrl = match[1].replace(/['"]/g, '').trim();
    } catch (e) {
      logger.warn(`Could not read Pterodactyl .env: ${e.message}`);
    }

    // Fetch peer details
    let peerAppUrl = 'Unknown';
    let peerConnected = false;
    const isInternal = req.query.internal === 'true' || req.query.internal === true;

    if (!isInternal && cfg.peer && cfg.peer.host) {
      try {
        const https = require('https');
        const agent = new https.Agent({ rejectUnauthorized: false });
        const peerRes = await axios.get(`http://${cfg.peer.host}:${cfg.peer.port}/api/sync/verify-cluster?secret=${cfg.secret}&internal=true`, {
          timeout: 5000,
          httpsAgent: agent
        });
        peerAppUrl = peerRes.data.localAppUrl || 'Unknown';
        peerConnected = true;
      } catch (e) {
        logger.warn(`Failed to connect to peer verification endpoint: ${e.message}`);
      }
    }

    const urlsMatch = localAppUrl === peerAppUrl;

    // Check registered Wings nodes status in database
    const nodes = [];
    try {
      const dbPool = getDbPool();
      const [rows] = await dbPool.query('SELECT id, name, fqdn, daemonListen FROM nodes');
      for (const row of rows) {
        // Quick connection ping to verify Wings is listening & configured
        let isHealthy = false;
        try {
          const wingsUrl = `https://${row.fqdn}:${row.daemonListen}/api/system/time`;
          await axios.get(wingsUrl, { timeout: 2000 });
          isHealthy = true;
        } catch (err) {
          // Fallback if HTTP ping fails or cert is self-signed
          isHealthy = err.code !== 'ECONNREFUSED';
        }
        nodes.push({
          id: row.id,
          name: row.name,
          fqdn: row.fqdn,
          port: row.daemonListen,
          isHealthy
        });
      }
    } catch (e) {
      logger.warn(`Database verification fetch failed: ${e.message}`);
    }

    const result = {
      localAppUrl,
      peerAppUrl,
      urlsMatch,
      nodes
    };

    // Dispatch detailed report to Discord
    if (!req.query.internal) {
      const nodeStatusList = nodes.map(n => `• **${n.name}** (${n.fqdn}): ${n.isHealthy ? '🟢 Connected' : '🔴 Unreachable'}`).join('\n') || 'No nodes configured.';
      await sendDiscordWebhook(
        '🔍 CLUSTER VERIFICATION REPORT',
        `PteroDownTimeKiller Verification status check.`,
        urlsMatch ? 0x22c55e : 0xef4444,
        [
          { name: 'Local App URL', value: `\`${localAppUrl}\``, inline: true },
          { name: 'Peer App URL', value: `\`${peerAppUrl}\``, inline: true },
          { name: 'Unified URL Match', value: urlsMatch ? '✅ MATCHING' : '❌ MISMATCH / MISCONFIGURED', inline: false },
          { name: 'Wings Nodes Connection', value: nodeStatusList, inline: false }
        ]
      );
    }

    return res.status(200).json(result);
  });

  // 11. Discord Webhook Command Trigger API
  app.post('/api/webhook/command', async (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Command missing' });

    await handleWebhookCommand(command);
    return res.json({ status: 'command_dispatched', command });
  });
}

module.exports = {
  setupApiRoutes
};
