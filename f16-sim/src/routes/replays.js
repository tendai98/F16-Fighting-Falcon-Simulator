'use strict';

const express = require('express');
const { normalizeSubmission, newReplayId } = require('../services/validation');
const { computeVerifiedScore } = require('../services/scoring');
const { saveReplay, listReplays, getReplay } = require('../services/replayStore');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'f16-replay-api', version: 1, time: new Date().toISOString() });
});

router.post('/replays', async (req, res, next) => {
  try {
    const record = normalizeSubmission(req.body);
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

    const saved = await saveReplay(record, summary);
    res.status(201).json({ ok: true, id, summary: saved.summary, score, storage: saved.storage });
  } catch (err) {
    next(err);
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
