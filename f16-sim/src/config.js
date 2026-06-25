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
  logging: {
    level: (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info')).toLowerCase(),
    apiRequests: boolEnv('API_REQUEST_LOGS', process.env.NODE_ENV !== 'production'),
    replayUploads: boolEnv('REPLAY_UPLOAD_LOGS', process.env.NODE_ENV !== 'production'),
    replayStore: boolEnv('REPLAY_STORE_LOGS', process.env.NODE_ENV !== 'production')
  },
  firestore: {
    summaries: process.env.FIRESTORE_REPLAY_SUMMARIES || 'replaySummaries',
    blobs: process.env.FIRESTORE_REPLAY_BLOBS || 'replayBlobs'
  },
  limits: {
    jsonLimit: process.env.JSON_BODY_LIMIT || '56mb',
    replayBytes: intEnv('MAX_REPLAY_BYTES', 56 * 1024 * 1024, 512 * 1024, 256 * 1024 * 1024),
    replayUploadBytes: intEnv('MAX_REPLAY_UPLOAD_BYTES', intEnv('MAX_REPLAY_BYTES', 56 * 1024 * 1024, 512 * 1024, 256 * 1024 * 1024), 512 * 1024, 512 * 1024 * 1024),
    replayExpandedBytes: intEnv('MAX_REPLAY_EXPANDED_BYTES', 512 * 1024 * 1024, 1024 * 1024, 1024 * 1024 * 1024),
    replayDurationSec: intEnv('MAX_REPLAY_DURATION_SEC', 6 * 3600, 60, 24 * 3600),
    snapshots: intEnv('MAX_REPLAY_SNAPSHOTS', 250000, 100, 1000000),
    events: intEnv('MAX_REPLAY_EVENTS', 500000, 100, 2000000),
    validateReplayDeep: boolEnv('VALIDATE_REPLAY_DEEP', false),
    deepNodes: intEnv('MAX_REPLAY_NODES', 5000000, 1000, 20000000),
    deepDepth: intEnv('MAX_REPLAY_DEPTH', 32, 4, 128),
    stringLength: intEnv('MAX_REPLAY_STRING_LENGTH', 192, 24, 4096),
    keyLength: intEnv('MAX_REPLAY_KEY_LENGTH', 64, 16, 512),
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
