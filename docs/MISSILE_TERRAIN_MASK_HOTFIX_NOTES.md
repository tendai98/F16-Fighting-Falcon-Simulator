# Missile Terrain Mask Hotfix

## What changed
- Fixed guided ground-attack missile false terrain masking.
- HARM / AGM shots now guide through a shallow loft profile instead of aiming at the terrain surface for the whole flight.
- Terrain masking is still active, but the mask test now ignores near-terminal grazing at the target point.
- Genuine ridges between missile and target still block the weapon and produce a terrain-mask impact.
- Terminal ground contact near the designated target now resolves as a valid impact instead of being treated as a miss.

## Files changed
- `js/hud_weapons.js`

## Validation
- `node --check js/hud_weapons.js`
- `node --check js/*.js`
