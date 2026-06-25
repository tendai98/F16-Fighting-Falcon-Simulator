# LANTIRN Hybrid Route-FLIR Update

## Purpose
The LANTIRN MFD display now prioritizes route readability for low-level flight instead of simple monochrome contrast or elevation-only shading.

## Display model
Each terrain cell is shaded independently using a hybrid score:
- elevation: higher ridges and peaks are brighter
- slope/edge strength: cliff walls, ridge edges and gorge walls are highlighted
- path clearance: rising terrain in the forward flight path gets extra brightness
- water/channel state: rivers and water remain dark/cool but readable

## Gameplay effect
- Valleys, gaps, channels and depressions remain darker as route options.
- Ridges, walls and obstacles stand out brighter.
- Water and river corridors remain visible as dark navigation references.
- Infrastructure still appears as subtle route/context markers.
- The display stays lime-green monochrome and avoids red/orange heat-map colors.

## Files updated
- js/mfd.js
