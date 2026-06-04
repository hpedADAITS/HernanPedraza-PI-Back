const fs = require('fs');
const path = require('path');
const config = require('../config');

const logsDir = path.dirname(config.logFile);

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const colors = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[35m',
  reset: '\x1b[0m',
};

const formatTimestamp = () => {
  return new Date().toISOString();
};

const formatMessage = (level, message, meta = {}) => {
  const timestamp = formatTimestamp();
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message} ${metaStr}`;
};

const log = (level, message, meta = {}) => {
  if (levels[level] > levels[config.logLevel]) return;

  const formatted = formatMessage(level, message, meta);

  // Only log to console in development
  if (config.env === 'development') {
    console.log(`${colors[level]}${formatted}${colors.reset}`);
  }

  try {
    fs.appendFileSync(config.logFile, formatted + '\n');
  } catch (err) {
    // Silent fail - file logging should not crash the app
  }
};

const logger = {
  error: (message, meta) => log('error', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  info: (message, meta) => log('info', message, meta),
  debug: (message, meta) => log('debug', message, meta),
};

module.exports = logger;
