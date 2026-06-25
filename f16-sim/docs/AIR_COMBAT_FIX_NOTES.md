# Air Combat Dynamics Follow-up

This patch tightens the air-to-air / gun combat behavior after playtest feedback.

## Fixed

- A-A/DGFT cannon trigger now works regardless of the currently selected SMS station.
  - SPACE is cannon in A-A/DGFT.
  - L remains A-A missile launch.
  - A stale bomb/AGM station can no longer block the gun or drop ordnance while in A-A.
- LCOS/gun reticle visibility increased and clarified.
  - Shows a working LCOS cue earlier while the pilot closes.
  - Shows a clear `GUN — NO LCOS` fallback when no target solution exists.
  - Red cue only appears when the target is in a credible gun solution.
- Gun rounds now render from the actual ballistic bullets on the HUD instead of fake straight centerline streaks.
- Gun rounds inherit ownship velocity and smear more under hard maneuvering / stick input.
- Gun projectile hit bubble and damage tuned so valid tracking bursts damage aircraft reliably.
- Strafing can damage soft ground targets/SAM hardware when bullet paths intersect the target footprint.
- A-A missile guidance is now stricter after overshoot.
  - Added seeker gimbal / no-reacquire behavior.
  - Added diverging-after-closest-approach kill logic.
  - Reduced turn authority and increased energy loss for AIM-9X, AIM-120, RED_AAM, and SAMs.
  - Missiles no longer count an overshoot as a hit.
  - Missiles self-destruct instead of orbiting/boomeranging around a maneuvering target.
- A-A missile launch now requires a believable shot window.
  - AIM-9X and AIM-120 have different min/max range and cone constraints.
- Enemy defensive countermeasures are more reliable and visible.
  - HARD/ACE bandits drop defensive flares/chaff against incoming missiles.
  - Cockpit/world rendering draws larger flare/chaff particles with visible streaks/blooms.
  - TGP rendering now shows enemy flares and chaff as thermal/sensor returns.

## Validation

- `node --check js/*.js server/**/*.js`
- Smoke test: A-A gun fires with Mk-82 station selected.
- Smoke test: LCOS solution is generated for a target ahead.
- Smoke test: constrained AIM-120 profile is active.
- Smoke test: HARD/ACE bandit deploys defensive countermeasures.
- Smoke test: overshooting missile terminates instead of persisting/orbiting.
