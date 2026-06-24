# LANTIRN Low-Level Update

Added a LANTIRN terrain-navigation MFD page for low-level ingress and terrain-following.

## Features

- New `LANT` MFD page.
- Access from HSD with bottom OSB `B3 LANT`.
- Access from TGP with bottom OSB `B5 LANT`.
- LANTIRN page controls:
  - `B1` toggles pod power `ON/STBY`.
  - `B2` cycles highlight mode `CLEAR / PEAK / SLOPE`.
  - `L1-L4` set terrain view range `4 / 8 / 12 / 16 NM`.
  - `B5` returns to TGP.
- Forward terrain display highlights terrain clearance:
  - green = safer clearance
  - yellow = rising / caution terrain
  - red = dangerous terrain ahead
- Includes a clearance strip at the bottom for forward AGL trend.
- LANTIRN state is included in replay cockpit state.
- Flight School low-level lesson now teaches LANTIRN setup and use.

## Validation

- `node --check js/*.js`
- `node --check server/**/*.js`
- Archive integrity checks
