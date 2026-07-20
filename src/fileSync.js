const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const logger = require('./logger');
const { getConfig } = require('./config');

const suppressMap = new Map(); // path -> expiration timestamp

const IGNORE_PATTERNS = [
  /(^|[\/\\])\../, // Hidden files
  /storage\/framework\/cache/,
  /storage\/framework\/views/,
  /storage\/framework\/sessions/,
  /storage\/logs/,
  /bootstrap\/cache/,
  /node_modules/,
  /\.env$/,
  /\.git/
];

function isIgnored(filePath) {
  return IGNORE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function setSuppression(relPath, durationMs = 5000) {
  suppressMap.set(relPath, Date.now() + durationMs);
}

function isSuppressed(relPath) {
  const expiry = suppressMap.get(relPath);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    suppressMap.delete(relPath);
    return false;
  }
  return true;
}

async function sendFileToPeer(action, relPath, base64Content = null) {
  const cfg = getConfig();
  if (!cfg.peer || !cfg.peer.host) return;

  const url = `http://${cfg.peer.host}:${cfg.peer.port}/api/sync/push-file`;
  try {
    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    await axios.post(
      url,
      {
        action,
        relPath,
        content: base64Content,
        senderNode: cfg.node.id
      },
      {
        headers: {
          'x-sync-secret': cfg.secret
        },
        timeout: 10000,
        httpsAgent: agent
      }
    );
    logger.debug(`File sync (${action}) pushed to peer: ${relPath}`);
  } catch (err) {
    logger.warn(`Failed to push file sync to peer (${relPath}): ${err.message}`);
  }
}

function initFileSync(watchDirs) {
  const cfg = getConfig();
  const dirs = watchDirs || cfg.watch || ['/var/www/pterodactyl'];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      logger.warn(`Watch directory does not exist: ${dir}`);
      return;
    }

    logger.info(`Starting real-time file watcher on: ${dir}`);

    const watcher = chokidar.watch(dir, {
      ignored: isIgnored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    });

    watcher.on('add', async (filePath) => handleFileChange('add', dir, filePath));
    watcher.on('change', async (filePath) => handleFileChange('change', dir, filePath));
    watcher.on('unlink', async (filePath) => handleFileChange('unlink', dir, filePath));
  });
}

async function handleFileChange(action, baseDir, filePath) {
  const relPath = path.relative(baseDir, filePath);

  if (isIgnored(relPath) || isSuppressed(relPath)) {
    return;
  }

  logger.info(`File event [${action}]: ${relPath}`);

  let base64Content = null;
  if (action !== 'unlink') {
    try {
      const buffer = await fs.readFile(filePath);
      base64Content = buffer.toString('base64');
    } catch (err) {
      logger.error(`Error reading file ${filePath}: ${err.message}`);
      return;
    }
  }

  await sendFileToPeer(action, relPath, base64Content);
}

async function handleIncomingFile(action, relPath, base64Content, targetBaseDir = '/var/www/pterodactyl') {
  const fullPath = path.join(targetBaseDir, relPath);
  setSuppression(relPath);

  try {
    if (action === 'unlink') {
      if (await fs.pathExists(fullPath)) {
        await fs.remove(fullPath);
        logger.info(`Incoming sync: Removed ${relPath}`);
      }
    } else {
      await fs.ensureDir(path.dirname(fullPath));
      const buffer = Buffer.from(base64Content, 'base64');
      await fs.writeFile(fullPath, buffer);
      logger.info(`Incoming sync: Updated ${relPath} (${buffer.length} bytes)`);
    }
    return { success: true };
  } catch (err) {
    logger.error(`Error processing incoming file sync for ${relPath}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = {
  initFileSync,
  handleIncomingFile,
  setSuppression
};
