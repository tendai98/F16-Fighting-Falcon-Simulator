# LANTIRN Forward-Look FLIR Update

## What changed
- Reintroduced LANTIRN as a dedicated MFD page.
- Added an HSD-to-LANT handoff on **B3** so the low-level terrain page is reachable from the tactical nav display.
- Implemented a **forward-looking FLIR / LLTV-style terrain renderer** that uses the same procedural terrain, water, roads, bridges, powerlines, and low-level route features already feeding the SAR page.
- The LANTIRN page renders in a **single bright lime-green display space** for strong readability on the MFD.
- Added ownship reference cues and a fixed boresight/flight-reference overlay so pilots can understand motion while the image updates.
- Added **WIDE / NAR** field-of-view switching on **R1** and dedicated look-ahead ranges on **L1-L4** (2 / 5 / 10 / 20 NM).
- Updated the low-level Flight School lesson text to teach use of the LANTIRN page.

## MFD controls
- From **HSD**, press **B3** to open **LANT**.
- On **LANT**:
  - **L1-L4** = 2 / 5 / 10 / 20 NM look-ahead range
  - **R1** = toggle **WIDE / NAR**
  - **B1** = return to **HSD**

## Validation performed
- Ran `node --check` across all JavaScript files in `js/`.
- Verified syntax is clean after the MFD/page changes and low-level lesson updates.
