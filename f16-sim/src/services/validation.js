'use strict';

const crypto = require('crypto');
const { config } = require('../config');

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const OUTCOMES = new Set(['WIN', 'LOSS', 'CRASH', 'DEAD', 'FAILED']);

function bad(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeAlias(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

function normalizeCountry(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(value, max = config.limits.stringLength) {
  return String(value == null ? '' : value).slice(0, max);
}

function sanitizeDeep(value, ctx, depth = 0) {
  if (ctx.nodes++ > config.limits.deepNodes) throw bad('Replay payload is too complex');
  if (depth > 18) throw bad('Replay payload nesting is too deep');

  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'boolean') return value;
  if (t === 'number') {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 1000000) / 1000000;
  }
  if (t === 'string') return safeString(value);
  if (Array.isArray(value)) {
    if (value.length > Math.max(config.limits.snapshots, config.limits.events, 250000)) {
      throw bad('Replay array exceeds allowed size');
    }
    return value.map(v => sanitizeDeep(v, ctx, depth + 1));
  }
  if (t !== 'object') return null;

  const out = {};
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw bad('Replay contains a forbidden object key');
    if (key.length > config.limits.keyLength) continue;
    out[key] = sanitizeDeep(value[key], ctx, depth + 1);
  }
  return out;
}

function validateReplayShape(replay) {
  if (!replay || typeof replay !== 'object') throw bad('Missing replay payload');
  if (!Array.isArray(replay.snapshots) || replay.snapshots.length < 1) throw bad('Replay must include snapshots');
  if (replay.snapshots.length > config.limits.snapshots) throw bad('Replay has too many snapshots');
  if (replay.events && !Array.isArray(replay.events)) throw bad('Replay events must be an array');
  if ((replay.events || []).length > config.limits.events) throw bad('Replay has too many events');

  let lastT = -1;
  for (let i = 0; i < replay.snapshots.length; i++) {
    const s = replay.snapshots[i] || {};
    const t = finiteNumber(s.t, i === 0 ? 0 : lastT);
    if (t < -0.1) throw bad('Replay snapshot timestamp is invalid');
    if (t + 0.5 < lastT) throw bad('Replay snapshots must be ordered by time');
    if (t > config.limits.replayDurationSec + 2) throw bad('Replay duration exceeds server limit');
    lastT = t;
  }

  for (const ev of replay.events || []) {
    const t = finiteNumber(ev && ev.t, 0);
    if (t < -0.1 || t > config.limits.replayDurationSec + 2) throw bad('Replay event timestamp is invalid');
    if (ev && ev.type && String(ev.type).length > 64) throw bad('Replay event type is too long');
  }
}

function normalizeSubmission(body) {
  const source = body && body.record ? body.record : body;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw bad('Invalid replay submission');

  const player = source.player || {};
  const alias = normalizeAlias(player.alias || source.alias);
  const country = normalizeCountry(player.country || source.country);
  if (!/^[A-Z0-9]{1,16}$/.test(alias)) throw bad('Alias must be 1-16 letters/numbers');
  if (!/^[A-Z]{2}$/.test(country)) throw bad('Country must be a 2-letter code');

  const missionIn = source.mission || {};
  const level = Math.trunc(finiteNumber(missionIn.level || source.level || 1, 1));
  if (level < 1 || level > 5) throw bad('Mission level must be 1, 2, 3, 4, or 5');

  const difficultyNames = ['EASY', 'NORMAL', 'HARD', 'ACE', 'AIR SUPER'];
  const outcomeRaw = String(missionIn.outcome || source.outcome || 'LOSS').toUpperCase().replace(/[^A-Z]/g, '');
  const outcome = OUTCOMES.has(outcomeRaw) ? outcomeRaw : (outcomeRaw === 'SUCCESS' ? 'WIN' : 'LOSS');

  const ctx = { nodes: 0 };
  const replay = sanitizeDeep(source.replay, ctx, 0);
  validateReplayShape(replay);

  const durationFromSnapshots = finiteNumber(replay.snapshots[replay.snapshots.length - 1].t, 0);
  const durationSec = Math.min(config.limits.replayDurationSec, Math.max(0, finiteNumber(missionIn.durationSec, durationFromSnapshots) || durationFromSnapshots));

  const record = {
    version: 1,
    player: { alias, country },
    mission: {
      level,
      difficultyIndex: level - 1,
      difficultyName: safeString(missionIn.difficultyName || difficultyNames[level - 1], 24),
      outcome,
      outcomeReason: safeString(missionIn.outcomeReason || missionIn.reason || '', 80),
      durationSec: Math.round(durationSec * 100) / 100,
      seed: Math.trunc(finiteNumber(missionIn.seed, 0))
    },
    replay,
    client: {
      replayVersion: Math.trunc(finiteNumber(replay.version, 0)),
      tickRate: finiteNumber(replay.tickRate, 10),
      snapshotCount: replay.snapshots.length,
      eventCount: (replay.events || []).length
    }
  };

  const byteLength = Buffer.byteLength(JSON.stringify(record), 'utf8');
  if (byteLength > config.limits.replayBytes) throw bad('Replay payload exceeds server byte limit');
  record.client.byteLength = byteLength;
  return record;
}

function newReplayId() {
  return `replay_${crypto.randomUUID().replace(/-/g, '')}`;
}

module.exports = { normalizeSubmission, newReplayId, bad };
