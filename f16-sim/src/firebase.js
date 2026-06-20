'use strict';

// Firebase Admin SDK compatibility wrapper.
// Uses the modular Admin SDK entry points instead of the legacy admin.apps API.
// This avoids crashes in newer Node/Admin SDK combinations where admin.apps may
// not be exposed on the default require('firebase-admin') object.
const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function privateKeyFromEnv(value) {
  return String(value || '').replace(/\\n/g, '\n');
}

function serviceAccountFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (parsed.private_key) parsed.private_key = privateKeyFromEnv(parsed.private_key);
    return parsed;
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKeyFromEnv(process.env.FIREBASE_PRIVATE_KEY)
    };
  }

  return null;
}

function initFirebase() {
  const apps = getApps();
  if (apps.length) return apps[0];

  const serviceAccount = serviceAccountFromEnv();
  const options = {};

  if (serviceAccount) {
    options.credential = cert(serviceAccount);
  } else {
    options.credential = applicationDefault();
  }

  if (process.env.FIREBASE_DATABASE_URL) options.databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (process.env.FIREBASE_PROJECT_ID && !serviceAccount) options.projectId = process.env.FIREBASE_PROJECT_ID;

  return initializeApp(options);
}

const app = initFirebase();
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

module.exports = { app, db, FieldValue };
