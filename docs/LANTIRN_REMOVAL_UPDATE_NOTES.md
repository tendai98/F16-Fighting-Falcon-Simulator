# LANTIRN Removal Update

## Summary
The experimental LANTIRN terrain-navigation display has been removed from the simulator UI because it did not improve low-level route finding.

## Removed
- HSD `B3 LANT` entry point.
- TGP `B5 LANT` entry point.
- `PAGES.LANT` MFD renderer and associated terrain-display controls.
- LANTIRN Flight School workflow steps.
- LANTIRN replay capture fields for new recordings.

## Preserved
- Restored full-screen legacy HUD.
- HSD, TGP, HAD/FCR and ECM workflows.
- SAM radar-horizon masking for low-level ingress.
- Terrain-masked missile behavior.
- Backend sync and replay compatibility.

## Compatibility
Legacy replay records or stale cockpit states that reference the old `LANT` page are redirected to HSD.
