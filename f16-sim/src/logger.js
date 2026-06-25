'use strict';

const { config } = require('./config');

const LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};

function levelValue(level) {
  const key = String(level || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, key) ? LEVELS[key] : LEVELS.warn;
}

function enabled(level) {
  return levelValue(config.logging.level) >= levelValue(level);
}

function write(level, message, payload) {
  if (!enabled(level)) return;
  const fn = console[level] || console.log;
  if (payload === undefined) fn(message);
  else fn(message, payload);
}

const logger = {
  enabled,
  error(message, payload) { write('error', message, payload); },
  warn(message, payload) { write('warn', message, payload); },
  info(message, payload) { write('info', message, payload); },
  debug(message, payload) { write('debug', message, payload); }
};

module.exports = { logger };
