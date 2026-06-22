# LANTIRN Elevation Shading Update

## What changed
- Changed the LANTIRN MFD image from risk/clearance brightness to elevation-based brightness.
- Higher terrain, ridge walls, towers and bridge references read brighter.
- Lower channels, depressions, valleys and water read darker.
- Water remains visible as a darker/cool low-elevation reference instead of disappearing.
- B2 gain label now reflects elevation-style display behavior.

## Files updated
- `js/mfd.js`
