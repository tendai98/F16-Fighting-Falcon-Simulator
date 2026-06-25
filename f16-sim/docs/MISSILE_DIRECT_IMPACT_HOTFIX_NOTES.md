# Missile Direct-Impact Hotfix

## What changed
- Ground-guided missiles now keep a shallow mid-course loft but transition back to the exact stored designation point for terminal guidance.
- The terminal impact point now uses the original designation (`groundPos`) instead of the lifted line-of-sight aim point.
- Removed the wide near-target snap kill that allowed a missile to impact visibly off target and still destroy the target.
- Terrain hits close to, but not directly on, the designation now show as terrain impacts instead of automatic target kills.
- HARM/AGM kills now require a direct terminal hit or very tight closest pass at the designated point.

## Files updated
- `js/hud_weapons.js`
