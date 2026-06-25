# Gun Reticle / Audio Follow-up

This patch focuses on the A-A cannon experience.

## Changes

- Reworked the gun SFX into a deeper BRRRT-style burst using a bass sawtooth layer, brown-noise cannon body, and controlled high buzz.
- Increased cannon lethality when rounds actually cross a bandit path.
- Added a tight LCOS solution damage assist so a held burst inside a valid red gun solution reliably damages/kills the target.
- Kept aircraft-physics behavior: bullets still inherit ownship velocity and high-G maneuvering still increases dispersion.
- Replaced the confusing moving-only lead reticle with a target-tracking gun circle:
  - target tracking circle follows the bandit
  - yellow means in gun range
  - red means valid shoot solution
  - small lead/impact cue remains visible so the player can understand the ballistic solution
- Gun kill events still use the existing replay/scoring hooks.

## Validation

- `node --check js/*.js`
- `node --check server/**/*.js`
- static verification for new gun SFX layers
- static verification for target-tracking reticle and gun solution damage path
