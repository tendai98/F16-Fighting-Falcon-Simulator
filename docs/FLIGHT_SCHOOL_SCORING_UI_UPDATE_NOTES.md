# Flight School, Low-Level, Scoring, and UI Update

## Changes
- Flight School sessions are now treated as training only: no replay is recorded or saved.
- Low-level LANTIRN lesson now starts far from the SA-3 at safe altitude, giving the pilot time to descend.
- Low-level lesson no longer preselects the HARM or configures all MFD pages for the pilot.
- Added step-by-step prompts for opening LANTIRN, setting 10 NM look-ahead, opening SMS, selecting AGM-88 HARM, selecting A-G, arming, opening FCR, selecting HAD, locking SA-3, firing, and descending away.
- Altitude guidance now explicitly distinguishes HUD MSL feet from AGL meters and shows both in the live lesson readout.
- Removed player-facing level multiplier and penalties rows from the score breakdown and scoring total.
- Added `Tendai Bhebhe ©` copyright signature to the splash screen, main menu, help/manual, intro offer, and Flight School menu.
- Removed click-to-skip behavior from the splash/loading screen.

## Validation
- JavaScript syntax checked across all `js/*.js` files.
- Server JavaScript syntax checked.
- Feature checks verified Flight School replay suppression, low-level lesson wording, altitude readouts, copyright signature, splash skip removal, and scoreboard cleanup.
