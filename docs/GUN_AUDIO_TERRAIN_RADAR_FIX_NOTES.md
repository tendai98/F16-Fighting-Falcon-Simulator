# Gun Audio / Terrain / Radar Horizon Fix

This patch addresses feedback from the Level 5/radar training build.

## Gun audio

- Reworked the cannon SFX so held fire uses a continuous audio bed rather than relying only on repeated one-shot samples.
- Added a continuous brown-noise body, white-noise buzz layer, and sawtooth rotor layer that ramp on while the gun is held.
- Raised the buzz pitch and tightened one-shot transients so the result is a faster A-10-style BRRRT without being harsh.
- Live audio state now receives a `gun` flag while the cannon is being held/fired.

## Terrain height

- Terrain height now scales by selected level:
  - Level 1: x2
  - Level 2: x3
  - Level 3: x4
  - Level 4: x5
  - Level 5: x6
- Terrain cache invalidates when the level/terrain scale changes so the visual terrain updates instead of keeping stale heightfields.

## Radar horizon / masking

- SAM radar-horizon masking now treats anything below 1500 m AGL as masked outside close-range reacquisition.
- Between 1500 m and 2200 m AGL, SAM detection ramps back in gradually.
- Level 5 FCR terrain masking now also uses the 1500 m AGL low-altitude threshold.
- Low-Level Flight School lesson text and completion gates were updated from 300-400 m to below 1500 m AGL.
