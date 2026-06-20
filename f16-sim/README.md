# F-16 Strike Sim Replay Backend

Node.js backend for secure community replay storage using Firestore.

## Design

The browser game does not talk to Firestore directly. It talks to this API:

- `GET /api/health`
- `POST /api/replays`
- `GET /api/replays`
- `GET /api/replays/:id`

The backend validates replay payloads, computes the verified score, compresses the replay, signs the compressed blob, and stores it in Firestore.

## Firestore collections

- `replaySummaries/{replayId}`: compact scoreboard metadata.
- `replayBlobs/{replayId}`: compressed blob metadata.
- `replayBlobs/{replayId}/chunks/{00000...}`: base64 gzip chunks.

The chunked layout avoids Firestore's single-document size limit for larger replays.

## Setup

```bash
cd server
cp .env.example .env
npm install
npm start
```

For local development with the game served by the backend:

```bash
SERVE_CLIENT=true CORS_ORIGINS='*' npm start
```

Then open:

```text
http://localhost:8080
```

## Firebase Admin SDK environment variables

Use either:

```text
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

or:

```text
FIREBASE_SERVICE_ACCOUNT
```

`FIREBASE_PRIVATE_KEY` may contain escaped newlines (`\n`); the backend converts them to real newlines.

## Client API base URL

If the game and API are served from the same origin, no client config is needed.

If the API is separate, set before `js/storage.js` loads:

```html
<script>
  window.F16_API_BASE_URL = 'https://your-api.example.com';
</script>
```

You can also set local development config from the browser console:

```js
localStorage.setItem('f16_api_base_url', 'http://localhost:8080');
```

## Security notes

- The client cannot write directly to Firestore.
- Server rejects oversized or malformed replay payloads.
- Server strips dangerous object keys such as `__proto__`, `constructor`, and `prototype`.
- Server recomputes leaderboard score instead of trusting the browser score.
- Scoreboard loads metadata only; full replay data loads only when Watch is clicked.
- Compressed replay blobs are signed with `REPLAY_SIGNING_SECRET`.
- Use Firestore rules to deny client writes to replay collections.

## Firestore rules

Use `firestore.rules.example` as the baseline. It denies direct browser reads and writes. The backend uses the Admin SDK, so it can still read/write after validating requests.
