# Backend-Only Replay Store Update

## Summary
- Removed the hybrid replay store pattern that mixed backend replays with browser-local replay storage.
- Browser replay list now uses backend metadata only via `GET /api/replays`.
- Full replay payloads are fetched only when a player selects a replay via `GET /api/replays/:id`.
- Browser no longer saves full replay missions to IndexedDB or localStorage.
- Legacy browser replay databases/caches are deleted on startup so old stale replay data cannot appear after Firestore is cleared.
- Failed uploads are retried only in memory while the page remains open; they are not persisted into browser replay storage.
- After successful upload, the client discards the full replay payload and keeps only compact backend metadata for the debrief UI.
- The backend filters replay summaries so entries with missing blob/chunk payloads are not shown.
- The backend returns `404 Replay not found` for missing or incomplete replay data.

## Expected Database Reset Behavior
1. Clear Firestore replay documents/collections.
2. Reload the client.
3. Scoreboard/replay list returns empty from the backend.
4. No old browser replay cache is displayed.
5. Complete a new real mission.
6. `POST /api/replays` recreates the required Firestore summary/blob/chunk documents.
7. Selecting WATCH downloads only that selected replay from the backend.
