# LANTIRN Contrast / Radar Horizon Fix

- Reduced LANTIRN monochrome contrast so dark/cool terrain remains visible instead of crushing to black.
- Kept bright/front-facing/rising terrain readable, but softened the brightest values.
- Added visible dark/cool monochrome water rendering to the LANTIRN page so rivers/lakes help reveal channels and depressions.
- Added subtle infrastructure rendering on the LANTIRN page for roads, bridges and powerline references.
- Made water surfaces flat in terrain generation so water sits on the ground/channel floor instead of reading like raised terrain.
- Restored SAM low-altitude radar-horizon behavior: below roughly 400 m AGL the aircraft is masked until it is dangerously close to the SAM site.
- SAMs still reacquire/fire at close range and terrain line-of-sight still matters outside close reacquisition.
