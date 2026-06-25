# LANTIRN Projection / Clipping Fix

## Problem
The LANTIRN page could render terrain as a narrowing trapezoid or leave dark side gaps at the MFD edges. This was a geometry/projection coverage issue, not a color-palette issue.

## Fix
- Kept LANTIRN as a forward-looking camera page.
- Ensured every display cell is filled by a camera raycast result: terrain hit or horizon fill.
- Increased raycast grid density from 74x62 to 82x66.
- Added small cell overlap to remove browser-scale subpixel seams.
- Added generous overscan for projected overlays so route/road/reference lines do not get chopped at the edges.
- Slightly widened the usable sensor viewport.

## Files changed
- `js/mfd.js`

## Validation
- `node --check js/*.js`
- `node --check server/index.js`
- `node --check server/src/**/*.js`
