'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { config } = require('../config');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function signReplay(id, hash, byteLength) {
  const secret = config.security.signingSecret;
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(`${id}.${hash}.${byteLength}`).digest('hex');
}

function encodeRecord(record) {
  const json = JSON.stringify(record);
  const raw = Buffer.from(json, 'utf8');
  const compressed = zlib.gzipSync(raw, { level: 9 });
  const hash = sha256(compressed);
  const base64 = compressed.toString('base64');
  const chunks = [];
  for (let i = 0; i < base64.length; i += config.limits.chunkChars) chunks.push(base64.slice(i, i + config.limits.chunkChars));
  return {
    chunks,
    hash,
    byteLength: raw.length,
    compressedByteLength: compressed.length,
    base64Length: base64.length,
    signature: signReplay(record.id, hash, compressed.length)
  };
}

function decodeRecord(id, blobMeta, chunkDocs) {
  const ordered = chunkDocs.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const base64 = ordered.map(doc => (doc.data && doc.data.data) || '').join('');
  const compressed = Buffer.from(base64, 'base64');
  const hash = sha256(compressed);
  if (blobMeta.sha256 && blobMeta.sha256 !== hash) throw new Error('Replay hash verification failed');
  if (blobMeta.signature && config.security.signingSecret) {
    const expected = signReplay(id, hash, compressed.length);
    if (blobMeta.signature !== expected) throw new Error('Replay signature verification failed');
  }
  const raw = zlib.gunzipSync(compressed);
  return JSON.parse(raw.toString('utf8'));
}

module.exports = { encodeRecord, decodeRecord };
