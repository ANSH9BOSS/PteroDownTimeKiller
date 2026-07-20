const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

const CONFIG_PATH = process.env.CONFIG_PATH || '/etc/pterodowntimekiller/config.json';
let config = {};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = fs.readJsonSync(CONFIG_PATH);
      logger.info(`Loaded configuration from ${CONFIG_PATH}`);
    } else {
      const examplePath = path.join(__dirname, '../config/config.example.json');
      if (fs.existsSync(examplePath)) {
        config = fs.readJsonSync(examplePath);
        logger.warn(`Config file ${CONFIG_PATH} not found. Using fallback example config.`);
      }
    }
  } catch (err) {
    logger.error(`Error reading config file: ${err.message}`);
  }
  return config;
}

function getConfig() {
  if (!config.node) {
    return loadConfig();
  }
  return config;
}

module.exports = {
  loadConfig,
  getConfig,
  CONFIG_PATH
};
