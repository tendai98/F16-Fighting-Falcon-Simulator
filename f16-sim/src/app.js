'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { config } = require('./config');
const { logger } = require('./logger');
const { router: replayRouter } = require('./routes/replays');

function createCors() {
  const allowed = config.corsOrigins;
  if (!allowed.length) return cors({ origin: false });
  if (allowed.includes('*')) return cors({ origin: true });
  return cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowed.includes(origin)) return cb(null, true);
      cb(new Error('CORS origin not allowed'));
    }
  });
}

function requestId(req) {
  const raw = req.headers['x-request-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_.:-]{8,128}$/.test(id) ? id : crypto.randomUUID();
}

function createApp() {
  const app = express();

  app.use(express.static("./game"))

  if (config.security.trustProxy) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    req.id = requestId(req);
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(createCors());
  app.use(rateLimit({ windowMs: config.security.rateWindowMs, max: config.security.rateMax, standardHeaders: true, legacyHeaders: false }));

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();

    const started = process.hrtime.bigint();
    if (config.logging.apiRequests) {
      logger.info('[f16-api] request start', {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        origin: req.headers.origin || '',
        contentType: req.headers['content-type'] || '',
        contentLength: req.headers['content-length'] || ''
      });
    }

    res.on('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : (res.statusCode >= 400 ? 'warn' : 'info');
      if (config.logging.apiRequests || res.statusCode >= 400) {
        logger[level]('[f16-api] request finish', {
          requestId: req.id,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Math.round(elapsedMs),
          responseBytes: res.getHeader('content-length') || ''
        });
      }
    });

    req.on('aborted', () => {
      logger.warn('[f16-api] request aborted by client', {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        rawBodyBytes: req.rawBodyLength || 0
      });
    });

    next();
  });

  app.use(express.json({
    limit: config.limits.jsonLimit,
    strict: true,
    verify: (req, res, buf) => {
      req.rawBodyLength = buf ? buf.length : 0;
    }
  }));

  app.use((err, req, res, next) => {
    if (!err || err.type !== 'entity.too.large') return next(err);
    err.uploadStage = 'json-body-limit';
    err.uploadDiagnostics = {
      configuredJsonLimit: config.limits.jsonLimit,
      contentLength: req.headers['content-length'] || '',
      rawBodyBytes: req.rawBodyLength || 0
    };
    logger.warn('[f16-api] request body too large', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: 413,
      configuredJsonLimit: config.limits.jsonLimit,
      contentLength: req.headers['content-length'] || '',
      rawBodyBytes: req.rawBodyLength || 0
    });
    return next(err);
  });

  app.use('/api', replayRouter);

  if (config.serveClient) {
    const clientRoot = path.resolve(__dirname, '..', '..');
    app.use(express.static(clientRoot, { index: 'index.html', extensions: ['html'] }));

    // Express 5 / path-to-regexp v8 no longer accepts app.get('*').
    // Use a no-path middleware fallback so this works with Express 4 and 5.
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api/')) return next();
      return res.sendFile(path.join(clientRoot, 'index.html'));
    });
  }

  app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
  app.use((err, req, res, next) => {
    const status = err.statusCode || err.status || 500;
    const message = status >= 500 ? 'Server error' : err.message;
    const logPayload = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status,
      stage: err.uploadStage || err.stage || err.type || 'unhandled',
      message: err.message,
      rawBodyBytes: req.rawBodyLength || 0,
      uploadDiagnostics: err.uploadDiagnostics || undefined
    };
    if (status >= 500) {
      logPayload.stack = err.stack;
      logger.error('[f16-api] request error', logPayload);
    } else {
      logger.warn('[f16-api] request rejected', logPayload);
    }
    const body = { ok: false, error: message, requestId: req.id };
    if (err.uploadStage || err.stage) body.stage = err.uploadStage || err.stage;
    if (config.nodeEnv !== 'production' && status < 500 && err.uploadDiagnostics) body.diagnostics = err.uploadDiagnostics;
    res.status(status).json(body);
  });

  return app;
}

module.exports = { createApp };
