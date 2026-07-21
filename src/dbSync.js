const mysql = require('mysql2/promise');
const axios = require('axios');
const logger = require('./logger');
const { getConfig } = require('./config');

let pool = null;
const changeLog = []; // In-memory log of recent DB change events for delta sync
const MAX_LOG_SIZE = 1000;

function getDbPool() {
  if (pool) return pool;
  const cfg = getConfig();
  const dbCfg = cfg.database || {};

  pool = mysql.createPool({
    host: dbCfg.host || '127.0.0.1',
    port: dbCfg.port || 3306,
    user: dbCfg.user || 'pterodactyl',
    password: dbCfg.pass || '',
    database: dbCfg.name || 'panel',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  return pool;
}

function recordChange(table, action, recordData) {
  const entry = {
    id: Date.now() + Math.random().toString(36).substr(2, 4),
    table,
    action,
    recordData,
    timestamp: Date.now()
  };
  changeLog.push(entry);
  if (changeLog.length > MAX_LOG_SIZE) {
    changeLog.shift();
  }
  return entry;
}

async function sendDbChangeToPeer(table, action, recordData) {
  const cfg = getConfig();
  if (!cfg.peer || !cfg.peer.host) return;

  const url = `http://${cfg.peer.host}:${cfg.peer.port}/api/sync/push-db`;
  try {
    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    await axios.post(
      url,
      {
        table,
        action,
        recordData,
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
    logger.debug(`DB change pushed to peer [${table}:${action}]`);
  } catch (err) {
    logger.warn(`Failed to push DB change to peer [${table}]: ${err.message}`);
  }
}

async function applyIncomingDbChange(table, action, recordData) {
  const p = getDbPool();
  const connection = await p.getConnection();
  try {
    // Disable logging for this connection session to prevent infinite replication loops
    await connection.query('SET @pterodowntimekiller_sync = 1');

    if (action === 'DELETE') {
      const keys = Object.keys(recordData);
      if (keys.length === 0) return { success: false, error: 'No key provided for delete' };
      const primaryKey = keys.includes('id') ? 'id' : keys[0];
      const val = recordData[primaryKey];
      await connection.query(`DELETE FROM \`${table}\` WHERE \`${primaryKey}\` = ?`, [val]);
      logger.info(`Incoming DB Sync: Deleted record from ${table} where ${primaryKey} = ${val}`);
    } else {
      // REPLACE INTO for upsert
      const keys = Object.keys(recordData);
      const cols = keys.map((k) => `\`${k}\``).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map((k) => recordData[k]);

      const sql = `REPLACE INTO \`${table}\` (${cols}) VALUES (${placeholders})`;
      await connection.query(sql, values);
      logger.info(`Incoming DB Sync: Applied UPSERT to table ${table}`);
    }
    return { success: true };
  } catch (err) {
    logger.error(`Error applying incoming DB change to ${table}: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    connection.release();
  }
}

function getChangesSince(timestamp) {
  const since = parseInt(timestamp, 10) || 0;
  return changeLog.filter((c) => c.timestamp > since);
}

let isPolling = false;
function startDbReplicationPoller(intervalMs = 1000) {
  logger.info(`Starting real-time database replication poller (every ${intervalMs}ms)...`);
  setInterval(async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      const p = getDbPool();
      // Fetch oldest unprocessed change log rows
      const [rows] = await p.query('SELECT * FROM pterodowntimekiller_changelog ORDER BY id LIMIT 50');
      if (rows.length === 0) {
        isPolling = false;
        return;
      }

      for (const row of rows) {
        const recordData = JSON.parse(row.record_data);
        await sendDbChangeToPeer(row.table_name, row.action, recordData);
        // Delete processed log entry
        await p.query('DELETE FROM pterodowntimekiller_changelog WHERE id = ?', [row.id]);
      }
    } catch (err) {
      // Avoid spamming logs if tables are not set up yet
      if (!err.message.includes('Table') && !err.message.includes('exist')) {
        logger.error(`Database replication poller error: ${err.message}`);
      }
    } finally {
      isPolling = false;
    }
  }, intervalMs);
}

module.exports = {
  getDbPool,
  recordChange,
  sendDbChangeToPeer,
  applyIncomingDbChange,
  getChangesSince,
  startDbReplicationPoller
};
