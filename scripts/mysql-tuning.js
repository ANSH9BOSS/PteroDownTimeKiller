const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const logger = require('../src/logger');

async function configureMysqlAutoIncrement(nodeRole = 'primary') {
  const offset = nodeRole === 'primary' ? 1 : 2;
  const cnfContent = `[mysqld]
auto_increment_increment = 2
auto_increment_offset = ${offset}
bind-address = 0.0.0.0
`;

  const targetDirs = [
    '/etc/mysql/mariadb.conf.d',
    '/etc/mysql/mysql.conf.d',
    '/etc/mysql/conf.d'
  ];

  let wroteConfig = false;
  for (const dir of targetDirs) {
    if (fs.existsSync(dir)) {
      const cnfPath = path.join(dir, '99-pterodowntimekiller.cnf');
      await fs.writeFile(cnfPath, cnfContent);
      logger.info(`MySQL auto-increment tuning written to ${cnfPath} (offset: ${offset})`);
      wroteConfig = true;
      break;
    }
  }

  if (!wroteConfig) {
    logger.warn('Could not find standard MySQL config directory. Skipping mysql file write.');
  }

  // Reload MySQL if running
  try {
    await execAsync('systemctl restart mariadb || systemctl restart mysql');
    logger.info('MySQL service restarted successfully with active-active settings.');
  } catch (err) {
    logger.warn(`Could not restart MySQL service automatically: ${err.message}`);
  }
}

module.exports = {
  configureMysqlAutoIncrement
};
