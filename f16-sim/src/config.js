'use strict';

function intEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function listEnv(name) {
  return String(process.env[name] || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  serveClient: boolEnv('SERVE_CLIENT', false),
  corsOrigins: listEnv('CORS_ORIGINS'),
  firestore: {
    summaries: process.env.FIRESTORE_REPLAY_SUMMARIES || 'replaySummaries',
    blobs: process.env.FIRESTORE_REPLAY_BLOBS || 'replayBlobs'
  },
  limits: {
    jsonLimit: process.env.JSON_BODY_LIMIT || '8mb',
    replayBytes: intEnv('MAX_REPLAY_BYTES', 8 * 1024 * 1024, 512 * 1024, 50 * 1024 * 1024),
    replayDurationSec: intEnv('MAX_REPLAY_DURATION_SEC', 3600, 60, 24 * 3600),
    snapshots: intEnv('MAX_REPLAY_SNAPSHOTS', 50000, 100, 250000),
    events: intEnv('MAX_REPLAY_EVENTS', 100000, 100, 500000),
    deepNodes: intEnv('MAX_REPLAY_NODES', 750000, 1000, 2000000),
    stringLength: intEnv('MAX_REPLAY_STRING_LENGTH', 192, 24, 2048),
    keyLength: intEnv('MAX_REPLAY_KEY_LENGTH', 64, 16, 256),
    scoreboardLimit: intEnv('SCOREBOARD_LIMIT', 100, 1, 250),
    chunkChars: intEnv('REPLAY_CHUNK_CHARS', 650000, 100000, 850000)
  },
  security: {
    signingSecret: process.env.REPLAY_SIGNING_SECRET || '',
    trustProxy: boolEnv('TRUST_PROXY', false),
    rateWindowMs: intEnv('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
    rateMax: intEnv('RATE_LIMIT_MAX', 120, 5, 10000)
  }
};

module.exports = { config };
