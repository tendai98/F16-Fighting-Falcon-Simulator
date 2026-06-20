# Sensor Designator / SAM Tracking / Overlay Occlusion Restore

This patch restores three gameplay behaviors after the previous radar-horizon experiment:

- SAMs no longer use a low-altitude AGL radar-horizon gate. A live SAM can track/fire normally once the player enters its threat ring, subject to the existing safe-base, jamming, tutorial, and dwell-time checks.
- Outside-window ground overlays remain terrain-occluded and no longer use the close-range bypass that allowed boxes/labels to shine through hills.
- Sensor-designated targets now get a HUD/POV designator symbol when visible:
  - ground/TGP/FCR/HAD designation: diamond + DESIG label
  - active TGP laser: larger red LZR cue
  - air designation: A-A DESIG box

The HSD and sensor pages still provide the tactical picture even when outside-view markers are hidden by terrain.
