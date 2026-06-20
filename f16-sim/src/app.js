'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { config } = require('./config');
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

function createApp() {
  const app = express();
  app.use(express.static("game"))

  if (config.security.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(createCors());
  app.use(rateLimit({ windowMs: config.security.rateWindowMs, max: config.security.rateMax, standardHeaders: true, legacyHeaders: false }));
  app.use(express.json({ limit: config.limits.jsonLimit, strict: true }));

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
    if (status >= 500) console.error('[f16-api]', err);
    res.status(status).json({ ok: false, error: message });
  });

  return app;
}

module.exports = { createApp };
