# Uploaded Base Missile / SAM / Roll Fix

Applied to the uploaded `f16-strike-sim-flight.zip` codebase.

## Fixes
- Ground-guided missiles now use a shallow mid-course loft so visible, designated targets are not falsely treated as terrain-masked.
- Terminal guidance returns to the exact stored designation point so HARM/AGM impacts visually hit the selected location.
- Wide off-target proximity kills were removed for ground-guided weapons. A target kill now requires a tight direct terminal hit or very tight closest pass at the designated point.
- Terrain masking still works: if a ridge genuinely blocks the shot, the missile flies into the terrain mask and does not kill the target.
- SAMs now track immediately inside their detection ring when not jammed, not near base, not terrain-masked, and not below radar horizon.
- SAM launch reaction time was reduced to a quick first-shot window, while retaining a short re-shot gap to prevent spam.
- Aircraft roll auto-centering was reduced heavily. Shallow/medium bank angles now hold better; only very near-level flight gets a light wing-leveler.

## Files changed
- `js/hud_weapons.js`
- `js/core.js`
