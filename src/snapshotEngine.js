const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const util = require('util');
const execAsync = util.promisify(exec);
const logger = require('./logger');
const { getConfig } = require('./config');
const { notifySnapshotCreated } = require('./webhooks');

let SNAPSHOT_DIR = '/var/backups/pterodowntimekiller';

async function getSnapshotDir() {
  try {
    await fs.ensureDir(SNAPSHOT_DIR);
  } catch (e) {
    SNAPSHOT_DIR = path.join(__dirname, '../snapshots');
    await fs.ensureDir(SNAPSHOT_DIR);
  }
  return SNAPSHOT_DIR;
}

async function createSnapshot(customTag = 'auto') {
  const dir = await getSnapshotDir();
  const cfg = getConfig();
  const db = cfg.database || {};
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotName = `snapshot_${cfg.node?.id || 'node'}_${customTag}_${timestamp}.sql.gz`;
  const snapshotPath = path.join(dir, snapshotName);

  logger.info(`Creating MySQL snapshot: ${snapshotName}`);

  const dumpCmd = `mysqldump -h "${db.host || '127.0.0.1'}" -P "${db.port || 3306}" -u "${db.user || 'pterodactyl'}" -p"${db.pass || ''}" "${db.name || 'panel'}" | gzip > "${snapshotPath}"`;

  try {
    await execAsync(dumpCmd);
    const stats = await fs.stat(snapshotPath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2) + ' MB';
    logger.info(`Snapshot created successfully: ${snapshotPath} (${sizeMb})`);

    // Notify Discord
    await notifySnapshotCreated(snapshotName, sizeMb);

    return {
      success: true,
      snapshotName,
      snapshotPath,
      fileSize: sizeMb
    };
  } catch (err) {
    logger.error(`Failed to create snapshot: ${err.message}`);
    return {
      success: false,
      error: err.message
    };
  }
}

async function listSnapshots() {
  const dir = await getSnapshotDir();
  const files = await fs.readdir(dir);
  const snapshots = [];

  for (const file of files) {
    if (file.endsWith('.sql.gz') || file.endsWith('.tar.gz')) {
      const filePath = path.join(dir, file);
      const stats = await fs.stat(filePath);
      snapshots.push({
        name: file,
        size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
        createdAt: stats.mtime
      });
    }
  }

  return snapshots.sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = {
  createSnapshot,
  listSnapshots,
  getSnapshotDir
};
