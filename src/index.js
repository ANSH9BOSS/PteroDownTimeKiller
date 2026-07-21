const express = require('express');
const logger = require('./logger');
const { loadConfig, getConfig } = require('./config');
const { initFileSync } = require('./fileSync');
const { getDbPool, startDbReplicationPoller } = require('./dbSync');
const { startAutoHealScanner } = require('./autoHeal');
const { setupApiRoutes } = require('./healthCheck');
const { sendDiscordWebhook } = require('./webhooks');

async function main() {
  logger.info('=====================================================');
  logger.info('⚡ Starting PteroDownTimeKiller Active-Active Failover System');
  logger.info('=====================================================');

  const cfg = loadConfig();
  const port = cfg.node?.port || 4000;

  // Initialize DB Connection
  try {
    const dbPool = getDbPool();
    await dbPool.query('SELECT 1');
    logger.info('Database connection established successfully.');
  } catch (err) {
    logger.warn(`Database connection warning: ${err.message}`);
  }

  // Create Express App
  const app = express();
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // Register API Routes
  setupApiRoutes(app);

  // Start HTTP Server
  app.listen(port, '0.0.0.0', () => {
    logger.info(`PteroDownTimeKiller Daemon running on http://0.0.0.0:${port}`);
    logger.info(`Health check URL: http://0.0.0.0:${port}/api/sync/status`);
    logger.info(`Web Dashboard URL: http://0.0.0.0:${port}/dashboard`);
  });

  // Start Real-Time File Watcher
  initFileSync(cfg.watch);

  // Start Peer Heartbeat Scanner & Auto-Heal
  startAutoHealScanner(5000);

  // Start Real-Time Database Replication Poller
  startDbReplicationPoller(1000);

  // Send Discord notification on daemon start
  await sendDiscordWebhook(
    '🚀 DAEMON STARTED',
    `PteroDownTimeKiller active-active failover daemon is live on node **${cfg.node?.id || 'panel-a'}**.`,
    0x3b82f6
  );
}

main().catch((err) => {
  logger.error(`Fatal error initializing PteroDownTimeKiller: ${err.message}`);
  process.exit(1);
});
