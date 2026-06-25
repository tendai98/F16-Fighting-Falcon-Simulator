# LANTIRN Lesson, Replay, Water Removal, and Low-Level Flight Update

## Flight School
- Reworked the low-level lesson into a dedicated LANTIRN low-level SA-3 attack lesson.
- The lesson now guides the pilot through:
  - opening LANTIRN from HSD B3
  - setting a 10 NM look-ahead range
  - descending below the radar horizon (~400 m AGL)
  - using LANTIRN for terrain masking and low-level route following
  - selecting AGM-88 HARM on SMS
  - setting A-G and Master Arm
  - locking the SA-3 on HAD
  - firing MAGNUM and descending away
- The lesson uses a single SA-3 site and highlights HUD altitude, LANTIRN, SMS, HAD, and weapon employment steps.

## Replay
- Replay cockpit state now records and restores LANTIRN page selection.
- Replay cockpit state now carries LANTIRN range and FOV.
- Removed the legacy replay redirect that forced old/new LANTIRN page states back to HSD.

## Water removal
- Water-body rendering is disabled.
- Terrain no longer flattens river/lake cells as water.
- SAR/LANTIRN keep dry valley/channel references for terrain navigation without rendering water bodies.

## Flight controls and low-level feel
- Softer pitch response curve for small corrections.
- Smoother roll rate and stronger roll self-centering.
- Added low-level bank assist to reduce unwanted altitude loss while turning near terrain.
- Increased max thrust and speed ceiling.
- Widened and lowered the outside-view camera to make low-level speed and terrain rush more immersive.

## Validation
- JavaScript syntax validation passed for all files in `js/`.
- Backend syntax validation passed.
- Static feature checks confirmed LANTIRN lesson steps, replay LANTIRN state fields, water-disable path, flight-control constants, and low-level FOV updates.
