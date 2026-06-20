'use strict';

const { db, FieldValue } = require('../firebase');
const { config } = require('../config');
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
    syncStatus: 'synced'
  };
}

async function saveReplay(record, summary) {
  const encoded = encodeRecord(record);
  const now = FieldValue.serverTimestamp();
  const summaryRef = db.collection(config.firestore.summaries).doc(record.id);
  const blobRef = db.collection(config.firestore.blobs).doc(record.id);
  const batch = db.batch();

  batch.set(summaryRef, {
    ...summary,
    createdAt: now,
    createdAtIso: record.createdAt,
    updatedAt: now,
    verified: true,
    moderationStatus: 'approved',
    storage: 'firestore-gzip-chunks'
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

  await batch.commit();
  return { summary: cleanSummary(summary), storage: { chunkCount: encoded.chunks.length, compressedByteLength: encoded.compressedByteLength } };
}

async function listReplays(limit) {
  const cap = Math.max(1, Math.min(Number(limit) || config.limits.scoreboardLimit, config.limits.scoreboardLimit));
  const snap = await db.collection(config.firestore.summaries)
    .orderBy('score', 'desc')
    .limit(cap)
    .get();
  return snap.docs.map(cleanSummary).filter(r => r.moderationStatus === 'approved');
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
  const chunksSnap = await blobRef.collection('chunks').get();
  const record = decodeRecord(id, blobSnap.data(), chunksSnap.docs.map(doc => ({ id: doc.id, data: doc.data() })));
  record.syncStatus = 'synced';
  record.score = record.score || { total: summary.score || 0, breakdown: {} };
  return record;
}

module.exports = { saveReplay, listReplays, getReplay };
