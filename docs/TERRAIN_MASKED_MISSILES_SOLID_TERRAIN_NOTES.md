# Terrain-Masked Missiles / Solid Terrain Update

Implemented after the countermeasure tuning build.

## Gameplay changes

- Missile guidance now respects terrain line-of-sight.
- SAM missiles and RED_AAMs have finite travel envelopes and can no longer chase indefinitely through terrain or across the whole map.
- Enemy missiles lose seeker quality/energy when terrain blocks line-of-sight to the player and will self-destruct/fail if masked long enough.
- Player air-to-ground guided missiles and HARMs no longer magically hit designated targets through mountains.
  - If the target is behind terrain when the missile path is blocked, the missile guides into the terrain mask point instead.
  - The target is not credited as killed when the missile terrain-masks into a ridge.
- Player AAMs also respect terrain masking against low aircraft contacts.

## Renderer changes

- Horizon haze now draws behind terrain instead of over it.
- Removed the late terrain contour/wire pass that could make far terrain seams appear through nearer ridges.
- Terrain should read as a more solid surface during low-level ingress.

## Technical notes

- Added `terrainLineBlockPoint(...)` in `core.js`.
- Added missile range/terrain-mask logic in `hud_weapons.js`.
- Updated missile profiles with explicit `maxTravel` and `maskBreak` values.
- Updated render order and terrain post-pass in `render3d.js`.
