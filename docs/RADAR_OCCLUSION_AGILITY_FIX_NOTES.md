# Radar / Occlusion / Agility Fix

Changes in this build:

- Reverted the gun sound effect to the previous deeper one-shot BRRRT effect.
- Removed the newer continuous gun audio bed that sounded wrong during held fire.
- Raised SAM radar-horizon masking so aircraft below 1500 m AGL can terrain-mask outside close reacquisition range.
- SAM detection now ramps back in from roughly 1500 m to 2200 m AGL.
- Level 5 FCR terrain masking now treats aircraft below 1500 m AGL as low/terrain-masked until geometry opens up.
- Outside-world SAM rings, SAM boxes, ground target boxes, HVTs, movers, target buildings, and A-G HUD ground cues now respect terrain line-of-sight.
- HSD still shows the tactical picture; the outside-window view no longer draws ground overlays through mountains.
- Player aircraft dogfight agility increased with faster roll response, greater bank authority, stronger available lift, and slightly lower induced drag.
