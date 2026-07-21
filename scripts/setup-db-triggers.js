const mysql = require('mysql2/promise');
const { getConfig } = require('../src/config');
const logger = require('../src/logger');

const TABLES_TO_SYNC = [
  'users',
  'nodes',
  'servers',
  'allocations',
  'locations',
  'mounts',
  'nests',
  'eggs',
  'user_keys',
  'api_keys'
];

async function main() {
  const cfg = getConfig();
  const dbCfg = cfg.database || {};

  const connection = await mysql.createConnection({
    host: dbCfg.host || '127.0.0.1',
    port: dbCfg.port || 3306,
    user: dbCfg.user || 'pterodactyl',
    password: dbCfg.pass || '',
    database: dbCfg.name || 'panel',
    multipleStatements: true
  });

  logger.info('Initializing real-time database replication triggers...');

  // 1. Create changelog table
  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`pterodowntimekiller_changelog\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`table_name\` VARCHAR(64) NOT NULL,
      \`action\` VARCHAR(10) NOT NULL,
      \`record_data\` LONGTEXT NOT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  logger.info('Changelog table created/verified.');

  // 2. Install triggers for each table
  for (const table of TABLES_TO_SYNC) {
    try {
      // Fetch columns dynamically
      const [cols] = await connection.query(`
        SELECT COLUMN_NAME 
        FROM information_schema.columns 
        WHERE table_schema = ? AND table_name = ?
      `, [dbCfg.name || 'panel', table]);

      if (cols.length === 0) {
        logger.warn(`Table ${table} not found in database. Skipping triggers.`);
        continue;
      }

      const colNames = cols.map(c => c.COLUMN_NAME);

      // Clean existing triggers if any
      await connection.query(`DROP TRIGGER IF EXISTS \`trg_${table}_insert\``);
      await connection.query(`DROP TRIGGER IF EXISTS \`trg_${table}_update\``);
      await connection.query(`DROP TRIGGER IF EXISTS \`trg_${table}_delete\``);

      // Construct JSON arguments
      const jsonInsertUpdate = colNames.map(c => `'${c}', NEW.\`${c}\``).join(', ');
      const jsonDelete = colNames.map(c => `'${c}', OLD.\`${c}\``).join(', ');

      // Insert trigger
      await connection.query(`
        CREATE TRIGGER \`trg_${table}_insert\` AFTER INSERT ON \`${table}\`
        FOR EACH ROW
        BEGIN
          IF @pterodowntimekiller_sync IS NULL THEN
            INSERT INTO \`pterodowntimekiller_changelog\` (\`table_name\`, \`action\`, \`record_data\`)
            VALUES ('${table}', 'INSERT', JSON_OBJECT(${jsonInsertUpdate}));
          END IF;
        END;
      `);

      // Update trigger
      await connection.query(`
        CREATE TRIGGER \`trg_${table}_update\` AFTER UPDATE ON \`${table}\`
        FOR EACH ROW
        BEGIN
          IF @pterodowntimekiller_sync IS NULL THEN
            INSERT INTO \`pterodowntimekiller_changelog\` (\`table_name\`, \`action\`, \`record_data\`)
            VALUES ('${table}', 'UPDATE', JSON_OBJECT(${jsonInsertUpdate}));
          END IF;
        END;
      `);

      // Delete trigger
      await connection.query(`
        CREATE TRIGGER \`trg_${table}_delete\` AFTER DELETE ON \`${table}\`
        FOR EACH ROW
        BEGIN
          IF @pterodowntimekiller_sync IS NULL THEN
            INSERT INTO \`pterodowntimekiller_changelog\` (\`table_name\`, \`action\`, \`record_data\`)
            VALUES ('${table}', 'DELETE', JSON_OBJECT(${jsonDelete}));
          END IF;
        END;
      `);

      logger.info(`Triggers installed successfully for table: ${table}`);
    } catch (err) {
      logger.error(`Error setting up triggers for table ${table}: ${err.message}`);
    }
  }

  await connection.end();
  logger.info('Database triggers configuration complete!');
}

main().catch(err => {
  logger.error(`Fatal error in triggers installer: ${err.message}`);
  process.exit(1);
});
