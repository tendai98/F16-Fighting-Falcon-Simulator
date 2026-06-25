'use strict';

const { db, FieldValue } = require('../firebase');
const { config } = require('../config');
const { logger } = require('../logger');
const { encodeRecord, decodeRecord } = require('./replayCodec');

function asIso(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.toDate) return value.toDate().toISOString();
  return new Date(value).toISOString();
}

function cleanSummary(doc) {
  const d = doc.data ? doc.data() : doc;
  return {
    id: d.id,
    createdAt: asIso(d.createdAtIso || d.createdAt),
    alias: d.alias || '',
    country: d.country || '',
    level: d.level || 1,
    difficultyName: d.difficultyName || '',
    outcome: d.outcome || '',
    score: d.score || 0,
    durationSec: d.durationSec || 0,
    replayVersion: d.replayVersion || 0,
    snapshotCount: d.snapshotCount || 0,
    eventCount: d.eventCount || 0,
    verified: d.verified === true,
    moderationStatus: d.moderationStatus || 'approved',
    storage: d.storage || '',
    chunkCount: d.chunkCount || undefined,
    syncStatus: 'synced'
  };
}

async function chunkCount(blobRef) {
  try {
    const countSnap = await blobRef.collection('chunks').count().get();
    return countSnap.data().count || 0;
  } catch (err) {
    // Older Admin SDKs may not expose aggregation count(). Use a very small
    // metadata-only fallback: verify at least one chunk exists without reading
    // the whole replay payload. Full count verification still happens on GET.
    const one = await blobRef.collection('chunks').limit(1).select().get();
    return one.empty ? 0 : null;
  }
}

async function hasCompleteReplayPayload(id) {
  if (!id) return false;
  const blobRef = db.collection(config.firestore.blobs).doc(id);
  const blobSnap = await blobRef.get();
  if (!blobSnap.exists) return false;
  const meta = blobSnap.data() || {};
  const expected = Number(meta.chunkCount || 0);
  if (!Number.isFinite(expected) || expected < 1) return false;
  const actual = await chunkCount(blobRef);
  if (actual === null) return true;
  return actual === expected;
}

async function saveReplay(record, summary, opts = {}) {
  const encoded = encodeRecord(record);
  const now = FieldValue.serverTimestamp();
  const summaryRef = db.collection(config.firestore.summaries).doc(record.id);
  const blobRef = db.collection(config.firestore.blobs).doc(record.id);
  const batch = db.batch();

  if (config.logging.replayStore) logger.info('[f16-api] replay firestore write prepared', {
    requestId: opts.requestId || '',
    id: record.id,
    summaryCollection: config.firestore.summaries,
    blobCollection: config.firestore.blobs,
    chunkCount: encoded.chunks.length,
    byteLength: encoded.byteLength,
    compressedByteLength: encoded.compressedByteLength,
    base64Length: encoded.base64Length
  });

  batch.set(summaryRef, {
    ...summary,
    createdAt: now,
    createdAtIso: record.createdAt,
    updatedAt: now,
    verified: true,
    moderationStatus: 'approved',
    storage: 'firestore-gzip-chunks',
    chunkCount: encoded.chunks.length,
    compressedByteLength: encoded.compressedByteLength
  });

  batch.set(blobRef, {
    id: record.id,
    replayId: record.id,
    encoding: 'gzip+base64+chunks',
    chunkCount: encoded.chunks.length,
    sha256: encoded.hash,
    signature: encoded.signature,
    byteLength: encoded.byteLength,
    compressedByteLength: encoded.compressedByteLength,
    base64Length: encoded.base64Length,
    createdAt: now,
    updatedAt: now
  });

  encoded.chunks.forEach((chunk, index) => {
    const id = String(index).padStart(5, '0');
    batch.set(blobRef.collection('chunks').doc(id), { index, data: chunk });
  });

  try {
    await batch.commit();
  } catch (err) {
    logger.error('[f16-api] replay firestore write failed', {
      requestId: opts.requestId || '',
      id: record.id,
      code: err && err.code,
      message: err && err.message,
      chunkCount: encoded.chunks.length,
      byteLength: encoded.byteLength,
      compressedByteLength: encoded.compressedByteLength,
      base64Length: encoded.base64Length
    });
    err.stage = err.stage || 'firestore-commit';
    throw err;
  }

  if (config.logging.replayStore) logger.info('[f16-api] replay firestore write committed', {
    requestId: opts.requestId || '',
    id: record.id,
    chunkCount: encoded.chunks.length,
    compressedByteLength: encoded.compressedByteLength
  });

  return { summary: cleanSummary({ ...summary, chunkCount: encoded.chunks.length, storage: 'firestore-gzip-chunks' }), storage: { chunkCount: encoded.chunks.length, compressedByteLength: encoded.compressedByteLength } };
}

async function listReplays(limit) {
  const cap = Math.max(1, Math.min(Number(limit) || config.limits.scoreboardLimit, config.limits.scoreboardLimit));
  const snap = await db.collection(config.firestore.summaries)
    .orderBy('score', 'desc')
    .limit(cap)
    .get();

  const candidates = snap.docs.map(cleanSummary).filter(r => r.moderationStatus === 'approved' && r.id);
  const checked = await Promise.all(candidates.map(async r => {
    const complete = await hasCompleteReplayPayload(r.id).catch(() => false);
    return complete ? r : null;
  }));
  return checked.filter(Boolean);
}

async function getReplay(id) {
  const summaryRef = db.collection(config.firestore.summaries).doc(id);
  const summarySnap = await summaryRef.get();
  if (!summarySnap.exists) return null;
  const summary = summarySnap.data();
  if (summary.moderationStatus !== 'approved') return null;

  const blobRef = db.collection(config.firestore.blobs).doc(id);
  const blobSnap = await blobRef.get();
  if (!blobSnap.exists) return null;
  const blobMeta = blobSnap.data() || {};
  const expected = Number(blobMeta.chunkCount || 0);
  if (!Number.isFinite(expected) || expected < 1) return null;

  const chunksSnap = await blobRef.collection('chunks').orderBy('index').get();
  if (chunksSnap.size !== expected) return null;

  const chunkDocs = chunksSnap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
  if (chunkDocs.some(doc => !doc.data || typeof doc.data.data !== 'string' || !doc.data.data)) return null;

  let record;
  try {
    record = decodeRecord(id, blobMeta, chunkDocs);
  } catch (err) {
    logger.warn('[f16-api] replay decode failed', { id, message: err && err.message ? err.message : String(err) });
    return null;
  }
  record.syncStatus = 'synced';
  record.score = record.score || { total: summary.score || 0, breakdown: {} };
  return record;
}

module.exports = { saveReplay, listReplays, getReplay, hasCompleteReplayPayload };
