# F-16 Strike Sim Update Implementation Notes

## Added systems

- Main menu before mission start.
- Existing 1-4 level selection only: EASY, NORMAL, HARD, ACE.
- H key opens Scoreboard / Replays.
- Help / controls now use Esc; H opens Scoreboard / Replays.
- Post-mission debrief with automatic mission save.
- Uppercase alias validation: A-Z and 0-9 only, maximum 16 characters.
- Country selection stored as a 2-letter code.
- IndexedDB replay storage with localStorage fallback.
- Backend-ready replay records with player, mission, score and replay payload.
- Replay recorder using initial state + 10 Hz snapshots + event log.
- Smooth replay playback through interpolation between snapshots.
- Score tracking for takeoff, waypoints, weapons, kills, survival, level multiplier, outcome multiplier and penalties.
- Scoreboard / replay browser with date, alias, country, level, outcome, score and Watch action.
- HARD / ACE enemy flight AI stabilization using bounded tactical states: INTERCEPT, CHASE, EVADE, EXTEND and REATTACK.

## Main files added

- `js/game_state.js`
- `js/storage.js`
- `js/scoring.js`
- `js/replay.js`
- `js/menu_ui.js`

## Main files modified

- `index.html`
- `css/cockpit.css`
- `js/main.js`
- `js/core.js`
- `js/hud_weapons.js`
- `js/mfd.js`

## Validation run

- `node --check js/*.js` completed successfully for every JavaScript file.
- A Node VM script-load smoke test loaded the browser scripts with DOM/canvas stubs and verified the new globals are defined.
- A VM replay/storage smoke test generated a score, replay snapshots/events, normalized alias/country, saved via the storage fallback, listed records, and fetched a saved replay.
- Script/link existence checks confirmed all `index.html` script and stylesheet references resolve inside the package.
- ZIP integrity check completed successfully.

## Notes

A full manual test is still recommended in the target browser because the simulator uses canvas rendering, live keyboard input, IndexedDB and audio APIs. A headless Chromium attempt in this environment was blocked from loading local/localhost pages by the sandbox policy, so the validation above is static plus VM smoke testing rather than full interactive browser playback.

## Replay patch v3

Updated after replay validation feedback:

- Replaced the center replay control strip with a compact top-left radial replay widget.
- Widget now shows pilot alias, score, elapsed time, and a countdown timer based on the recorded replay duration.
- Replay controls are now three curved/arch buttons: PAUSE/PLAY, RESTART, EXIT.
- Replay snapshots now include full cockpit/instrument state, including:
  - active MFD
  - MFD page per display
  - FCR mode/range/sweep
  - TGP zoom/FOV/track/polarity/laser state
  - DLNK range
  - DED page
  - datalink tune entry and tuned frequency
  - ECM on/cursor/jam slots
  - master arm/mode
  - selected station and station quantities
  - steerpoint
  - air/ground/HARM lock IDs
- Replay events now include an exact cockpit snapshot and force an immediate state snapshot, so instrument changes do not wait for the next 10 Hz sample.
- MFD OSB presses and MFD screen taps are now recorded as replay cockpit actions.
- Replay playback now restores cockpit state during playback and keeps the displayed MFDs synchronized with the recorded pilot actions.
- Replay playback now triggers one-shot sound effects from recorded events and keeps continuous warning sounds active while replay is playing.
- MFD sweep animation is frozen during replay so recorded instrument state is not overwritten by live display update logic.

## Replay widget layer polish

Updated the replay control widget after visual feedback:

- The circular pilot/timer display now renders in the foreground.
- The PAUSE/PLAY, RESTART, and EXIT buttons now sit behind the circle instead of having their left borders clipped.
- Button borders remain complete and rounded; the foreground circle naturally overlaps their left edge for a layered instrument-panel look.
- Widget overflow remains visible so no control border is cut off by the container.

## State cleanup patch

This build adds transition cleanup for mission end, replay start/stop/restart, return-to-menu, and active mission reset.

- Clears stale HUD banners, MSL AWAY timers, RWR flags, flare/caution/stall flags, screen flash, and held input state.
- Resets cockpit/MFD state on new missions and menu/replay transitions.
- Clears live bombs/missiles/effects after recorder finalization so failed/completed missions do not leak warnings into replay or reset.
- Adds a mission generation token to invalidate delayed mission-complete callbacks after a reset/menu/replay transition.
- Replay now starts from a clean runtime state and only raises the MSL AWAY cue when a recorded missile-launch event reaches that replay timestamp.
- MFD mouse/OSB input is ignored outside active flight so replay/menu screens cannot mutate cockpit state behind the overlay.

## Replay TGP visual stability patch

This build fixes replay-only TGP target mutation:

- TGP procedural target geometry is now deterministic from stable object identity instead of raw `Math.random()` during replay rendering.
- Static SAM/emitter footprints that are generated on the TGP now use deterministic seeded geometry.
- Replay snapshots now capture `_cluster` visual geometry for ground movers, HVTs, structures, buildings, and threats when available.
- Replay ID assignment now pre-initializes TGP visual geometry for replayable ground contacts when the TGP helpers are available.
- HARM/anti-radiation hits now mark the emitter object as destroyed, so killed emitters do not keep appearing as active TGP contacts in replay playback.

Validation added:

- `node --check js/*.js`
- deterministic TGP visual generation smoke test
- replay snapshot TGP visual capture smoke test

## Replay/TGP projectile visibility and station cleanup patch

- TGP now renders inbound missiles and bombs through the pod camera using the same replay/live state projection as the rest of the FLIR scene.
- Missiles and bombs draw a hot moving body plus a short projected trail so impacts are visible before the explosion.
- Bombs now carry short trail history; replay snapshots preserve missile and bomb trail points.
- Projectile impact events are recorded immediately before removal so replay playback captures the last approach frame near the target.
- The TGP pod remains visible as installed equipment on the SMS page, but it is no longer selectable as a weapon station.
- SMS R4 no longer presents TGP as a weapon-select OSB; X station cycling skips pod/tank stations.

## TGP impact-trail and SMS weapon-selection patch

- TGP now draws active bombs and missiles through the pod projection as hot moving bodies with short FLIR trails, including replay playback where projectile positions are interpolated from replay snapshots.
- Near line-of-sight arrivals get a small stable FLIR smear so the incoming weapon is still visible before impact instead of only showing the explosion.
- Bombs and missiles preserve compact trail samples in replay snapshots.
- TGP is no longer selectable as a weapon station: the pod remains visible on the SMS loadout as a dimmed SENSOR POD, but X-cycle and SMS OSB weapon selection skip it.

## TGP Ordnance Visibility + SMS Pod Cleanup Patch

- TGP video now draws live/replay projectile bodies and recent trail paths for bombs and blue guided missiles, so impacts show the munition entering the pod view before detonation instead of only the explosion.
- Bombs and missiles now keep short trail histories in live mission state; replay snapshots store those trail points and projectile origins for playback fidelity.
- Projectile impact events are recorded for replay timing/audio.
- Replay audio now handles projectile impact events.
- SMS weapon selection no longer exposes the TGP pod as a selectable weapon station. The TGP remains shown as a carried pod/sensor on the SMS page and remains accessible through the TGP MFD page.

## Replay optimization patch

This build includes a replay performance/storage optimization pass:

- IndexedDB replay storage now uses separate stores for compact metadata and full replay payloads.
- Scoreboard/list loading reads metadata only; full replay data is loaded only after Watch is selected.
- Existing v1 single-store replay records are migrated to metadata during IndexedDB upgrade while still remaining playable through the legacy store.
- Replay snapshots no longer force a full world snapshot for every cockpit event; cockpit/instrument actions are preserved through the replay event timeline.
- Static ground-object/TGP visual geometry is stored once and hydrated during playback instead of repeated in every snapshot.
- Static target/threat/structure snapshots are sampled at a lower rate and refreshed immediately after destructive events.
- Projectile trail history per snapshot was trimmed; TGP still renders ordnance streaks using stored trail + velocity fallback.
- Replay playback now uses a cached snapshot index instead of scanning from the beginning of the replay every frame.
- Replay cockpit application is cached so MFD refreshes happen only when the recorded cockpit state changes, not on every animation frame.
- Replay stop releases loaded replay arrays and caches to reduce memory retained after exiting playback.

## Help / Flight School polish

Updated after menu and training feedback:

- `Esc` is now the primary Help / Controls key.
- `H` remains dedicated to Scoreboard / Replays.
- F1 no longer opens the in-game help panel.
- Help and Flight School overlays now render above the main menu layer and hide stale menu modals before opening.
- Closing the Flight School selector from the main menu returns to the main menu instead of leaving a blank screen.
- The EW Strike / Attack Under Jamming lesson now uses a fixed-frequency two-band SA-6 training emitter. It does not frequency-hop in that beginner lesson.
- ECM lesson pointers now highlight the actual ECM spectrum peaks instead of the whole MFD screen.
- The datalink tuning lesson now points at the DED TUNE OSB instead of the entire DED display.
- Lesson startup now preserves lesson-specific MFD/page setup, such as opening the ECM page on the left MFD for EW Strike.
