# SAR Track-Up Geography Update

## What changed
- Reworked SAR/GMT into a track-up moving map with the aircraft fixed near the bottom of the display.
- Terrain, roads, water, infrastructure, and contacts now scroll and rotate around ownship as the aircraft moves.
- Added an ownship aircraft marker and short world-space trail so the pilot has a clear reference point.
- Replaced the older forward-cued patch frame with per-cell terrain returns anchored to the aircraft reference frame.
- Increased geography detail with slope/relief shading, subtle SAR edge flashes, river/lake traces, roads, bridges, and powerlines.
- Preserved clickable SAR/GMT designation for movers, TELs, buildings, HVTs, and underground facilities.
- Updated help and Flight School text for the new SAR workflow.

## Files updated
- `js/mfd.js`
- `js/main.js`
