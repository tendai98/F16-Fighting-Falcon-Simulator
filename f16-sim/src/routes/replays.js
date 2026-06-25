'use strict';

const express = require('express');
const { normalizeSubmission, newReplayId } = require('../services/validation');
const { computeVerifiedScore } = require('../services/scoring');
const { saveReplay, listReplays, getReplay } = require('../services/replayStore');
const { config } = require('../config');
const { logger } = require('../logger');

const router = express.Router();

function describeSubmission(body, rawBodyLength) {
  const source = body && body.record ? body.record : body;
  const replay = source && source.replay;
  const snapshots = replay && Array.isArray(replay.snapshots) ? replay.snapshots : [];
  const events = replay && Array.isArray(replay.events) ? replay.events : [];
  const mission = source && source.mission ? source.mission : {};
  const player = source && source.player ? source.player : {};
  const firstSnapshot = snapshots[0] || {};
  const lastSnapshot = snapshots[snapshots.length - 1] || {};

  return {
    rawBodyBytes: rawBodyLength || 0,
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
  const diagnostics = describeSubmission(req.body, req.rawBodyLength);
  if (config.logging.replayUploads) logger.info('[f16-api] replay upload received', { requestId: req.id, diagnostics });

  try {
    stage = 'normalization';
    const record = normalizeSubmission(req.body, { rawBodyLength: req.rawBodyLength });

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
