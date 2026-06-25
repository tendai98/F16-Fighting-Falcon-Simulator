# Countermeasure / Defense Tuning Update

This update reduces enemy countermeasure spam while preserving intelligent missile defense.

## Changes

- Added finite per-level enemy flare/chaff inventories:
  - Level 1: 3 flares / 2 chaff
  - Level 2: 5 flares / 3 chaff
  - Level 3: 7 flares / 4 chaff
  - Level 4: 9 flares / 5 chaff
  - Level 5: 11 flares / 6 chaff
- Added delayed reaction scheduling so enemies no longer defend instantly every time.
- Added per-level reaction chance so enemies may react late or miss a missile cue.
- Added short countermeasure bursts of 1-2 flares/chaff instead of long continuous dumps.
- Added 2.2-4.0 second quiet intervals after defensive bursts.
- Added post-defense vulnerability windows to make second-shot tactics more viable.
- Reduced flare/chaff spoof probability so countermeasures help but do not guarantee survival.
- Enemy aircraft still maneuver defensively even when low on expendables.

## Gameplay intent

The desired rhythm is:

1. Player fires a missile.
2. Enemy may react, but not always instantly or perfectly.
3. Enemy maneuvers hard and may use a short countermeasure burst.
4. Enemy enters a quiet interval.
5. A follow-up shot or gun attack becomes more practical.
