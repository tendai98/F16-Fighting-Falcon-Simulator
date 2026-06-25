# Sync Cleanup Update

- Mission save now always attempts the backend immediately.
- If the backend cannot be reached, the mission replay is saved locally as a pending record.
- Pending local records retry silently in the background.
- After a pending record uploads successfully, the local copy is deleted.
- Successful online saves are no longer duplicated into IndexedDB.
- Replay playback no longer caches full backend replay payloads locally.
- Backend/local status labels and warnings were removed from the player UI.
- The Reset Local Data button was removed from the main menu.
