const winston = require('winston');
const path = require('path');
const fs = require('fs-extra');

let logDir = '/var/log/pterodowntimekiller';
try {
  fs.ensureDirSync(logDir);
} catch (e) {
  logDir = path.join(__dirname, '../logs');
  fs.ensureDirSync(logDir);
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] [${level.toUpperCase()}]: ${message}`)
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`)
      )
    }),
    new winston.transports.File({ filename: path.join(logDir, 'daemon.log'), maxsize: 10485760, maxFiles: 5 })
  ]
});

module.exports = logger;
