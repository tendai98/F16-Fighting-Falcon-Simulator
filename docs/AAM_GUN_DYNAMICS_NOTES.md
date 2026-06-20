# Air-to-Air Missile / Gun Dynamics Update

This build adds an energy-aware air-to-air missile model, defensive AI countermeasures, visible flare/chaff decoys, ballistic gun rounds, and a computed A-A gun reticle.

## Highlights

- AAM/SAM guidance now uses turn-rate limits, burn/coast energy loss, turn drag, seeker break-lock logic, and self-destruct behavior after impossible reversals or closest-approach overshoots.
- AIM-9X, AIM-120, RED_AAM, SAM, AGM, and HARM profiles now differ in speed, turn authority, burn time, and seeker/countermeasure behavior.
- Radar missiles are affected by notching/chaff; IR missiles are affected by flares.
- HARD/ACE bandits detect incoming AIM-9X/AIM-120 shots, beam/notch radar missiles, drag IR missiles, and dispense visible flares/chaff.
- Player countermeasure key now deploys both flare and chaff bundles.
- Gun fire now spawns ballistic rounds that inherit aircraft velocity and widen dispersion under high-G maneuvering.
- Gun damage is based on bullet path intersection rather than a simple boresight cone.
- A-A/DGFT HUD now shows an LCOS-style computed gun reticle; it turns red when the solution is in range and close to the sight line.
- CCIP HUD cue now appears only for Mk-82 bombing without laser designation.
- Replay snapshots now include short-lived bullets and flare/chaff decoys.
