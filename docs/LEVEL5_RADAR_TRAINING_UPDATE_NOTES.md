# Level 5 / Radar Horizon / Training Update

This update adds the requested air-combat and training refinements:

- Added Level 5: `AIR SUPER`, an air-to-air-only mission with aggressive hostile aircraft and no SAM/ground objective layer.
- Score multipliers are now level-weighted as requested: Level 1 x2, Level 2 x3, Level 3 x4, Level 4 x5, Level 5 x6.
- Backend validation/scoring now accepts and verifies Level 5.
- Gun SFX is slightly higher-pitched and faster-buzzing while keeping the deeper BRRRT body.
- Enemy fighters now have finite flares/chaff, delayed reactions, and a chance to fail to deploy countermeasures, making missile kills achievable.
- Player aircraft roll/control authority is increased for tighter dogfight maneuvering without making the flight model totally unconstrained.
- SAMs now use a gameplay radar-horizon / terrain-masking check: low-level ingress below 1500 m AGL can delay SAM tracking until close range or line-of-sight opens.
- Level 5 FCR now applies terrain/low-altitude masking to air contacts, so aircraft using valleys/mountains may not appear until geometry opens.
- Help menu now documents gun reticle colors, gun behavior, enemy finite countermeasures, Level 5, and FCR masking.
- Flight School adds two new lessons plus a low-level attack lesson:
  - Air-to-Air Gun Employment
  - Low-Level Radar Horizon Attack
  - Air-to-Air missile lesson remains available as a dedicated missile engagement lesson.

Validation performed:

```text
node --check js/*.js
node --check server/src/**/*.js server/*.js
server Level 5 validation/scoring smoke test
core radar-horizon smoke test
```
