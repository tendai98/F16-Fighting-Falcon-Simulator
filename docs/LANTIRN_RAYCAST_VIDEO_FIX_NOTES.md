# LANTIRN Raycast Video Fix

## What changed
- Replaced the previous forward-looking LANTIRN terrain-strip mesh with a per-cell raycast video renderer.
- The LANTIRN page now behaves more like the TGP camera: every cell casts a forward camera ray and hits actual terrain.
- Removed the visual artifact where terrain appeared as a 90-degree clipped vertical surface when the aircraft pitched down.
- Expanded the LANTIRN video window to full-bleed inside the MFD glass with only a minimal CRT border.
- Empty camera rays now draw a dark green sky/horizon return instead of side gaps.
- Roads, bridges, powerlines and dry valley/channel references still project through the same camera frame.

## Validation
- `node --check js/*.js`
- `node --check server/index.js`
- `node --check server/src/**/*.js`
