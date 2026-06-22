# HUD Restore / LANTIRN MFD Revert

This patch reverts the experimental physical HUD/HMD/LANTIRN-HUD design.

- Restored the full-screen legacy FlightHUD symbology.
- Removed the physical HUD frame and clipped/squashed HUD rendering.
- Restored LANTIRN as an MFD page opened from HSD/TGP OSBs.
- Restored the LANTIRN low-level Flight School lesson to use the MFD page.
- Preserved the later gameplay/backend/replay/terrain-masked missile changes from the current build.
