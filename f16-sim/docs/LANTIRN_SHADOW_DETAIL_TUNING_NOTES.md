# LANTIRN Shadow Detail Tuning Update

## What changed
- Reduced overall monochrome FLIR contrast.
- Lifted the dark/shadow floor so channels, gaps, valleys, and depressions remain visible.
- Kept brighter forward-facing terrain readable for low-level route finding.
- Preserved water and cool terrain visibility without crushing them into near-black.
- Set the default LANTIRN gain to `NORM` for a softer baseline image.

## Files updated
- `js/mfd.js`
