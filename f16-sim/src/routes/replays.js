'use strict';

const express = require('express');
const zlib = require('zlib');
const { normalizeSubmission, newReplayId } = require('../services/validation');
const { computeVerifiedScore } = require('../services/scoring');
const { saveReplay, listReplays, getReplay } = require('../services/replayStore');
const { config } = require('../config');
const { logger } = require('../logger');

const router = express.Router();

function parseReplayRequest(req) {
  if (!Buffer.isBuffer(req.body)) {
    return {
      body: req.body,
      metrics: {
        uploadEncoding: 'json',
        uploadBodyLength: req.rawBodyLength || 0,
        expandedBodyLength: req.rawBodyLength || 0
      }
    };
  }

  const uploadBodyLength = req.body.length;
  let raw;
  try {
    raw = zlib.gunzipSync(req.body, { maxOutputLength: config.limits.replayExpandedBytes });
  } catch (err) {
    if (err && (err.code === 'ERR_BUFFER_TOO_LARGE' || /larger than/i.test(err.message || ''))) {
      const tooLarge = new Error('Compressed replay expands beyond server limit');
      tooLarge.statusCode = 413;
      tooLarge.uploadStage = 'gzip-expand-limit';
      throw tooLarge;
    }
    const invalid = new Error('Invalid compressed replay upload');
    invalid.statusCode = 400;
    invalid.uploadStage = 'gzip-decode';
    throw invalid;
  }

  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    const invalid = new Error('Invalid compressed replay JSON');
    invalid.statusCode = 400;
    invalid.uploadStage = 'gzip-json-parse';
    throw invalid;
  }

  req.decompressedBodyLength = raw.length;
  return {
    body,
    metrics: {
      uploadEncoding: 'gzip-json',
      uploadBodyLength,
      expandedBodyLength: raw.length
    }
  };
}

function describeSubmission(body, metrics) {
  metrics = metrics || {};
  const source = body && body.record ? body.record : body;
  const replay = source && source.replay;
  const snapshots = replay && Array.isArray(replay.snapshots) ? replay.snapshots : [];
  const events = replay && Array.isArray(replay.events) ? replay.events : [];
  const mission = source && source.mission ? source.mission : {};
  const player = source && source.player ? source.player : {};
  const firstSnapshot = snapshots[0] || {};
  const lastSnapshot = snapshots[snapshots.length - 1] || {};

  return {
    uploadEncoding: metrics.uploadEncoding || 'json',
    uploadBodyBytes: metrics.uploadBodyLength || 0,
    expandedBodyBytes: metrics.expandedBodyLength || metrics.uploadBodyLength || 0,
    bodyKeys: source && typeof source === 'object' ? Object.keys(source).slice(0, 24) : [],
    clientReplayId: source && source.id || '',
    createdAt: source && source.createdAt || '',
    aliasLength: player.alias ? String(player.alias).length : 0,
    country: player.country || '',
    missionLevel: mission.level,
    missionOutcome: mission.outcome,
    missionDurationSec: mission.durationSec,
    replayVersion: replay && replay.version,
    tickRate: replay && replay.tickRate,
    snapshotCount: snapshots.length,
    eventCount: events.length,
    firstSnapshotT: firstSnapshot.t,
    lastSnapshotT: lastSnapshot.t
  };
}

function attachUploadContext(err, stage, diagnostics) {
  err.uploadStage = err.uploadStage || stage;
  err.uploadDiagnostics = err.uploadDiagnostics || diagnostics;
  return err;
}

router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'f16-replay-api', version: 1, time: new Date().toISOString() });
});

router.post('/replays', async (req, res, next) => {
  let stage = 'received';
  let parsed;
  let diagnostics = {};
  try {
    parsed = parseReplayRequest(req);
    diagnostics = describeSubmission(parsed.body, parsed.metrics);
  } catch (err) {
    diagnostics = {
      uploadEncoding: Buffer.isBuffer(req.body) ? 'gzip-json' : 'json',
      uploadBodyBytes: req.rawBodyLength || (Buffer.isBuffer(req.body) ? req.body.length : 0),
      expandedBodyBytes: req.decompressedBodyLength || 0
    };
    logger.warn('[f16-api] replay upload parse failed', {
      requestId: req.id,
      stage: err.uploadStage || 'parse',
      status: err.statusCode || err.status || 400,
      message: err.message,
      diagnostics
    });
    return next(attachUploadContext(err, err.uploadStage || 'parse', diagnostics));
  }
  if (config.logging.replayUploads) logger.info('[f16-api] replay upload received', { requestId: req.id, diagnostics });

  try {
    stage = 'normalization';
    const record = normalizeSubmission(parsed.body, parsed.metrics);

    if (config.logging.replayUploads) logger.info('[f16-api] replay upload accepted', {
      requestId: req.id,
      clientReplayId: diagnostics.clientReplayId,
      alias: record.player.alias,
      country: record.player.country,
      level: record.mission.level,
      outcome: record.mission.outcome,
      durationSec: record.mission.durationSec,
      snapshotCount: record.client.snapshotCount,
      eventCount: record.client.eventCount,
      byteLength: record.client.byteLength,
      uploadByteLength: record.client.uploadByteLength,
      uploadEncoding: record.client.uploadEncoding,
      validationMode: record.client.validationMode
    });

    stage = 'scoring';
    const id = newReplayId();
    const createdAt = new Date().toISOString();
    const score = computeVerifiedScore(record);

    record.id = id;
    record.createdAt = createdAt;
    record.score = score;
    record.syncStatus = 'synced';

    const summary = {
      id,
      createdAtIso: createdAt,
      alias: record.player.alias,
      country: record.player.country,
      level: record.mission.level,
      difficultyName: record.mission.difficultyName,
      outcome: record.mission.outcome,
      score: score.total,
      durationSec: record.mission.durationSec,
      replayVersion: record.replay.version || 0,
      snapshotCount: record.replay.snapshots.length,
      eventCount: (record.replay.events || []).length,
      verified: true,
      moderationStatus: 'approved'
    };

    stage = 'firestore-save';
    const saved = await saveReplay(record, summary, { requestId: req.id });

    if (config.logging.replayUploads) logger.info('[f16-api] replay upload saved', {
      requestId: req.id,
      id,
      clientReplayId: diagnostics.clientReplayId,
      score: score.total,
      storage: saved.storage
    });

    res.status(201).json({ ok: true, id, summary: saved.summary, score, storage: saved.storage, requestId: req.id });
  } catch (err) {
    logger.warn('[f16-api] replay upload failed', {
      requestId: req.id,
      stage,
      status: err.statusCode || err.status || 500,
      message: err.message,
      diagnostics
    });
    next(attachUploadContext(err, stage, diagnostics));
  }
});

router.get('/replays', async (req, res, next) => {
  try {
    const replays = await listReplays(req.query.limit);
    res.json({ ok: true, replays });
  } catch (err) {
    next(err);
  }
});

router.get('/replays/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    if (!/^replay_[a-f0-9]{32}$/i.test(id)) return res.status(400).json({ ok: false, error: 'Invalid replay id' });
    const record = await getReplay(id);
    if (!record) return res.status(404).json({ ok: false, error: 'Replay not found' });
    res.json({ ok: true, record });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
