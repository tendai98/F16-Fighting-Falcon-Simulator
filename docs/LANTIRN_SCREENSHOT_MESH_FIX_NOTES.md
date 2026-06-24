# LANTIRN Screenshot Mesh Fix

## What changed
- Repackaged the LANTIRN raycast-video renderer so the MFD no longer uses the older vertical terrain-wall / mesh-curtain look.
- Increased LANTIRN raycast sampling density to reduce visible grid/cell artifacts.
- Changed terrain/sky cells to fully opaque bright lime-green fills with overlap so black grid seams are minimized.
- Reduced the center reference line opacity so it does not look like a terrain grid.
- Preserved the forward-looking FLIR/LLTV camera style, LANTIRN MFD page, LANTIRN Flight School lesson, replay page-state fix, water removal, scoring cleanup, and copyright UI updates.

## Validation
- JavaScript syntax check across `js/*.js`.
- Server JavaScript syntax check.
- ZIP integrity check.
- TAR listing check.
