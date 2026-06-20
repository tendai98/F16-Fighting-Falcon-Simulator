# F-16C Strike Mission Simulator

A browser-based F-16C cockpit + strike-mission demo. Full-screen solid-shaded
out-the-window view, procedural terrain, a full flight HUD, live instruments
(HSD / FCR with RWS & SAR, SMS, TGP, and a DED page), and a playable air-to-ground
mission. The client has no build step and no frontend dependencies — plain HTML, CSS, and JavaScript. The optional community replay backend is a separate Node.js service in `server/`.

## Run it

Open `index.html` in any modern browser for local/offline play. To use shared community replays, run the Node backend in `server/` or set `window.F16_API_BASE_URL` to your deployed API.

> If the neon F-16 silhouette on the SMS page doesn't appear under a strict
> `file://` security policy, serve the folder over HTTP instead:
> ```
> python3 -m http.server 8000      # then visit http://localhost:8000
> ```
> The sim still runs without the image (it falls back to a wireframe box).

## Layout

The out-the-window view is a **full-screen background** with the flight HUD
overlaid; the three MFDs float over it as individual displays docked along the
bottom. Because the view fills the whole window, zooming the browser out gives
you more of the world. The DED (up-front data) is a selectable **DED page** on
the MFDs rather than a separate panel.

Each MFD keeps a full set of 20 bezel buttons (OSBs) at all times. Buttons that
aren't used on the current page/mode stay physically present but are dimmed and
inert; only the relevant ones light up. The top row always switches page:
**FCR · HSD · SMS · TGP · DED**.

## Project structure

```
.
├── index.html               markup + canvas/MFD layout, loads css & js
├── css/
│   ├── cockpit.css           MFD frames, OSB buttons (+ disabled state), CRT effects
│   └── windscreen.css        wide view, HUD overlay, controls popup
├── js/
│   ├── config.js             runtime constants (silhouette asset path)
│   ├── core.js               math, value-noise terrain, world state, flight model
│   ├── game_state.js         menu/debrief/replay game state flow
│   ├── storage.js            IndexedDB/local storage + optional backend API replay store
│   ├── replay.js             replay recorder and interpolated playback
│   ├── scoring.js            mission score tracking
│   ├── render3d.js           R3 — software solid-shaded projection of the world
│   ├── hud_weapons.js        combat HUD overlay, CCIP, bombs/guns/AAM, threat AI
│   ├── flighthud.js          flight HUD (pitch ladder, FPM, tapes) — see credits
│   ├── mfd.js                MFD class + FCR(RWS/SAR/HAD) / HSD / SMS / TGP / DED pages
│   ├── menu_ui.js            main menu, debrief, scoreboard/replay UI
│   └── main.js               instances, keyboard input, game loop, mission flow
├── server/                   optional Node.js + Firestore replay API
├── assets/
│   └── f16_silhouette.png    neon top-down F-16 used on the SMS page
└── LICENSE-simple-hud.txt    MIT license for the flight HUD (see credits)
```

Script load order (set in `index.html`) is significant:
`tone → audio → config → core → game_state → storage → replay → scoring → render3d → hud_weapons → flighthud → mfd → menu_ui → main`.

## Controls

Keyboard flies the jet; mouse operates the MFDs. Press **Esc** in-sim for
this list as a popup. Press **H** for Scoreboard / Replays.

| Key | Action |
|-----|--------|
| `↑` / `↓` | throttle up / down (`↓` also brakes on the ground) |
| `S` / `W` | pitch — pull up / push down |
| `A` / `D` · `←` / `→` | roll left / right |
| `Q` / `E` | rudder yaw |
| `G` | gear up / down |
| `M` | cycle master mode (NAV → A-A → A-G → DGFT) |
| `B` | cycle master arm (SAFE → ARM → SIM) |
| `X` | cycle selected weapon station |
| `V` | designate target (A-A locks the boresight bandit; A-G designates the strike target) |
| `SPACE` | pickle the selected store — CCIP **bomb** (Mk-82), guided **AGM** (needs a ground lock), or **HARM** (needs an emitter). In **A-A/DGFT** the gun is **hold-to-fire**: hold `SPACE` to fire a continuous burst, release to stop |
| `L` | launch AAM (homes the nearest boresight bandit) |
| `C` | dispense flares |
| `N` | next steerpoint |
| `Esc` | show / hide the controls popup |
| `H` | open Scoreboard / Replays |
| `P` | pause |
| `R` | restart mission (after win/loss) |
| `1`/`2`/`3`/`4`/`5` | difficulty: EASY / NORMAL / HARD / ACE / AIR SUPER (resets the mission) |
| `F` | toggle the FPS / frame-time meter |
| `−` / `=` | graphics quality down / up (LOW / MED / HIGH) |
| `U` | sound on / off |

Mouse: click an MFD's OSB buttons to change page / range / store / mode; click
an FCR contact to lock it (RWS). The DED page's ▲/▼ OSBs cycle steerpoints; the
TGP page's OSBs toggle designation, FOV (WIDE/NARO), track (AREA/POINT), the
laser, and thermal polarity (**WHOT** white-hot / **BHOT** black-hot); the FCR's
bottom-left OSB cycles **RWS** (air search), **SAR** (ground map), and **HAD**
(the EW / HARM display — radar emitters by bearing and lethality; click one to
hand it to a HARM). HAD honours the **range OSBs (L1–L4 = 10/20/40/80 NM)** just like the FCR and HSD, so you can zoom the emitter picture in or out. The FCR and TGP are **domain-filtered** by master mode: in
**A-A** they show only air tracks (chevrons, red hostile / yellow unknown); in
**A-G** only ground targets (□ movers, ◆ HVTs, ★ the strike target) — so you
always know whether you're working an air or a surface picture. In **A-A** the TGP renders the locked aircraft as a hot thermal silhouette (with type and altitude), the same way it shows buildings and vehicles in **A-G**.

Stick response is smoothed (a short control lag, `CTRL_TAU` in `core.js`) so
inputs aren't twitchy. You change heading by **rolling** — bank the jet and pull;
the harder you pull while banked, the faster it turns. Speed matters: the wing
can only pull so many g for a given airspeed, so you turn hard when fast and go
mushy when slow. Pulling g costs energy, so a sustained hard turn bleeds speed.
Drop the throttle and you decelerate toward the **stall** — below ~140 kt the
wing can't hold you up and the nose falls through; feed in power and unload to
recover. The air also **thins with altitude**: thrust and the wing's lift both
fade as you climb, so the jet has a **service ceiling** — keep hauling the nose
up and you'll run out of lift, get a flashing **STALL** caption (and a stall
beep), and mush over. A deliberate push-over to low/negative g is *not* a stall
and won't trigger the warning. On the runway you only get airborne once you're
fast enough to rotate (~150 kt) with the nose up — you can't yank it off the
deck early. A parking brake holds the jet at idle so it won't creep on the ramp;
spool up past idle to roll.

## Loadout & weapons

You carry, in addition to the gun and the centreline TGP pod:

| Stores | Type | How to employ |
|--------|------|---------------|
| 6 × Mk-82 | gravity bombs (unguided) | A-G, fly the **CCIP** pipper onto the aim point and `SPACE`. No lock needed. |
| 4 × AGM-65 | guided air-to-ground | Lock a ground target with the **FCR** (A-G) or **TGP**, or designate the strike target with `V`, then `SPACE` — the missile flies itself to the designated point. |
| 4 × AIM-9X / AIM-120 | air-to-air | A-A, `L` launches at the nearest boresight bandit (FOX-2 / FOX-3). |
| 4 × AGM-88 | HARM (anti-radiation) | On the **HAD** display (FCR's 3rd mode) click a radar emitter to hand it off — or just `SPACE` with the HARM selected while inside a live SAM ring — and it homes on the radar, killing the site. |

Cycle the selected store with `X`, or click stations directly on the **SMS**
page — the left OSBs (L1–L4) select stations 1–4 (9X, 120, AGM, AGM) and the
right OSBs select weapon stations 5–7 (82, 82, HARM). The TGP pod is displayed as a carried sensor pod but is not selectable as a weapon; the selected button
highlights its label and hardpoint on the silhouette (and the OSB button itself
lights up the moment you pick it), so you can see exactly what's armed. The
faint connector lines that used to point from each label to its hardpoint have
been removed to reduce clutter. The SMS page shows quantities,
and master arm (`B`) must be **ARM** (or **SIM** to practise) to release anything.

## The mission

Every load **randomises**: the target location, the enroute steerpoints, the
strike complex, the SAM sites (one of them a jammer) and the terrain all change
run-to-run, so you're never flying the same sortie twice. Take off from the
runway, navigate the steerpoints to the defended command-bunker complex, then in
A-G mode with master arm set, put a bomb or AGM on the bunker — the CCIP HUD
reads **IN RNG — PICKLE** when the gravity solution is good. Destroying the
primary building is a **SHACK** (win). The target sits inside a **layered air
defence** — a long-range SA-10 ring, a medium SA-6, and short-range point-defence
SAMs, plus a corridor jammer on the run-in (more layers at higher difficulty).
Each ring gives RWR warnings and launches missiles you defeat with hard turns or
flares, or pre-empt with a HARM. Bandits can be gunned or hit with an AAM — and
at **HARD/ACE they shoot back**, turning to intercept and firing their own
air-to-air missiles at you (ACE more aggressively than HARD). Losing all integrity ends the mission — press
`R` to restart (which rolls a fresh randomised mission).

**Difficulty (`1`–`4`)** scales how much is out there: airborne bandits, moving
ground targets (convoys / mobile TELs that crawl along the deck), high-value
stationary assets (EW radar, SAM HQ, fuel depot), and friendly **AWACS** data
assets (E-3 / E-2) that orbit behind the lines. HARD and ACE also add an enemy
high-value air target, and only HARD/ACE bandits employ weapons. Bombs kill the
moving targets and HVTs too, not just the bunker. The gun streams visible tracers
that converge on the pipper when you fire. Terrain and every enemy/asset position are **randomised each run** (and
on restart), so no two sorties are laid out the same — only the runway, the
strike target, and your steerpoints stay fixed.

The friendly AWACS act as off-board sensors: whenever one is alive and within
its datalink range, an **AWACS LINK** picture appears on the HSD — cyan track
rings on every known enemy (bandits, movers, HVTs), so you get the tactical
picture without your own radar. EASY spawns two AWACS; ACE gives you none.

## Randomized targets, exclusion zone & the kill on the TGP

Every ground contact now spawns with **randomized geometry** — type (truck, tank,
SAM, radar, fuel, bunker), size and orientation — so when you designate one target
on the TGP and then re-designate another, they read as visibly different objects
at a different spot on the ground (the pod genuinely slews; before, identical boxes
made it look static). Movers point along their heading; static HVTs sit at a random
yaw.

When you kill a ground target the **explosion now plays on the TGP**, not just out
the window: the pod **lingers on the spot for ~3 seconds** after the target dies
(the readout shows `— DESTROYED —`) so you actually see the hit before it slews
back to the strike target.

There's a **base exclusion zone** (a 9 km safe radius over the home runway): no
hostile emitter spawns inside it, and SAMs hold their fire while you're still over
the field — so selecting HARD/ACE no longer means you're shot at on the runway.
Fly out of the zone and the threats engage normally.

Underground caverns, underground launchers, mobile **TELs** and the GMT picture are
now **present and armed at every difficulty**, not just HARD/ACE — but **aggression
scales** with level: SAM fire cadence runs ~16 s between shots at EASY and tightens
to ~7 s at ACE (`world._aggr` in `core.js`, used by `updateThreats`). EASY still
feels gentle; ACE is relentless.

## Designation, laser-guided bombs & CCIP

The TGP no longer auto-snaps to the strike target. With nothing designated it shows
a **ground-stabilized boresight** (a dim cross over the live ground ahead) — point
the nose to bring a target into view, then **designate** it (press **V**, or tap a
contact on the FCR/SAR). Once locked it **holds that point until you re-designate**,
tracking a mover as it drives and, when the target is destroyed, **staying on the
spot so the explosion plays out on the FLIR** (air or ground — the kill flash now
shows on the TGP instead of the pod jumping away).

The six **Mk-82s** now have two release modes, picked automatically:

* **Laser-guided (LGB)** — arm the TGP **laser** (TGP page, `LZR` OSB) on a
  designated ground target and the bomb **guides to the laser spot**. The HUD shows a
  red diamond on the spot with slant range. Guidance is physical: the bomb has a
  limited turn rate and gravity is never cancelled, so it only makes the target if
  you release inside its glide footprint — roughly *above* the target or running in
  **high and close**. Release short, low, or fast and it falls away.
* **CCIP (manual)** — with the laser off, the HUD shows the **CCIP pipper**; fly to
  walk the pipper onto the target and pickle, and the bomb drops ballistically to
  that point.

## Threat balance + a living, procedural battlefield

**SAM mix.** Air defences are now **basic-heavy**. SA-2 / SA-3 / SA-8 (single-band, no
frequency-hop) make up the bulk of the threats at every level. **Advanced SAMs (SA-6,
SA-15, SA-10) only appear at HARD and ACE**, and only a few of them — the target's
advanced rings layer on at HARD (SA-6) and ACE (SA-10 + SA-15), and a small number of
advanced sites scatter in. EASY and NORMAL are basic-only. Mobile SA-15 TELs are likewise
reserved for HARD/ACE.

**Procedural streaming.** Instead of one hotspot around the objective, the theatre now
populates **as you fly out**. The map is divided into grid cells; basic SAMs and ground
movers (and, at HARD/ACE, the occasional advanced site) are seeded deterministically into
the cells around the jet as you enter them, so wherever you roam there's activity. Far
procedural objects are culled to keep the count modest on slower machines — cells whose
site you destroyed stay clear, while untouched cells re-stream the same layout if you
double back. Streaming is suppressed during Flight School lessons so training airspace
stays controlled.

## Flight School (interactive lessons)

First launch opens **Flight School** — a set of short, guided lessons that *point* at the
exact button or instrument to use and **advance only when you do the action** (no clicking
"next" through the important parts). A green ring + arrow highlights the target; some steps
pause the sim to call out an instrument. SAMs hold fire during training.

Lessons:

1. **Basics** — takeoff, gear, climb, follow a steerpoint, then master mode → arm → weapon → sensor → range → designate → release.
2. **TGP** — targeting-pod find/zoom/designate/laser drop.
3. **SAR** — ground-map radar to lock and kill a moving vehicle.
4. **SEAD** — find a live SA-6 on the HAD scope, lock it and kill it with a HARM (start outside the ring, lock as you fly in).
5. **Defence** — fly into a SAM, bring up the **THREAT/EWS page** to read who’s shooting and the inbound missile, then defeat it with **flares + a hard break**.
6. **Air-to-Air** — A-A mode, AIM-120, radar lock, launch.
7. **Datalink** — tune the DED to an AWACS frequency and read the shared picture.
8. **ECM** — read the spectrum analyzer, lock the **SA-3**’s frequency from stand-off (8 jam slots), and feel the burn-through as you close in.
9. **EW Strike** — jam a **2-band SA-6** (cover BOTH peaks), penetrate its ring under cover while it can’t fire, and HARM it from inside — the offensive use of ECM. This SAM *will* shoot if you fail to jam it.

The **targeting lessons (Basics, TGP, SAR, A-A) run in clear airspace** — no SAM rings, so a
first-timer isn't distracted by the RWR. Attacking, surviving and jamming SAMs are taught in the dedicated **SEAD**, **Defence**, **ECM**
and **EW Strike** lessons, each set up around a single isolated SAM that you start well *outside*
its firing ring — with room to configure the jet (pod on, lock frequencies, arm) as you fly in.
The hint panel sits at the top of the screen (clear of the MFDs), and its pointer ring anchors
to the real on-screen position of each button / HUD readout.

Skip the offer and you can reopen Flight School any time from the **▸ FLIGHT SCHOOL** button
at the top of the **H** manual. Live range/altitude/status read-outs appear in the hint panel
where useful, and exiting (or pressing **R**) cleanly tears the lesson down.

## Automatic rearm (FARPs removed)

The land-to-rearm FARP pads are gone — landing is hard enough. Instead, any weapon
station that runs **WINCHESTER** (counter hits 0) **auto-reloads after a 10-second
cooldown**. The SMS page shows the countdown on that station (`RLD 7s`) and in the
selected-weapon box (`REARM 7s`), then a **RELOADED** banner when it restocks. The TGP
pod and tanks never reload. This keeps the hard levels (3–4) playable without forcing a
risky landing.

## Electronic Warfare (EW) pod + ECM spectrum page

The **ECM page** (open from **HSD → B4**, or toggle the pod with **J**) is a **spectrum
analyzer** for radar jamming:

* **Spectrum + peaks.** The page sweeps a 0–100 frequency scale. Every SAM within
  detection range (well beyond its firing ring) shows a **peak** at each radar frequency it
  radiates on — basic sites (SA-2 / SA-3 / SA-8) have one peak, mid-tier (SA-6 / SA-15) two,
  the SA-10 three. **Taller peak = closer / stronger SAM**, so the picture builds as you
  approach.
* **Lock jam slots.** Slide the **◄ ► cursor** across the spectrum (or tap a peak directly)
  and press **SEL** to lock that frequency into a **jam slot — up to 8**. **AUTO** fills the
  slots from the strongest peaks; **CLR** empties them. A locked frequency shades a small
  coverage band (± tolerance) and turns its peak blue.
* **All bands, or nothing.** A SAM is suppressed only when **every one of its peaks** is
  covered. Jamming one band of a two-band SA-6 does nothing — you must cover both. This is
  the fix for jamming that used to "not kick in": coverage is continuous, not a band that
  cycles in and out.
* **Burn-through (inner ring).** Each SAM has its lethal ring (drawn on the HSD) **and** an
  inner **burn-through radius** (not drawn, to avoid clutter). While you jam every band and
  stay outside burn-through, the SAM can't track or launch — you can cross into its ring
  unbothered. Once you pass the burn-through radius its return overpowers the jam and it
  reacquires (peak goes red, status **BURN-THRU**). Jamming buys stand-off, not
  invulnerability.
* **Not a cheat code.** Spreading the pod across more slots **weakens each**, pushing
  burn-through farther out — so blanket-jamming the whole battlefield is self-defeating; jam
  only what you need. Capable SAMs (SA-6 / SA-15 / SA-10) **frequency-hop**: a peak jumps to
  a new frequency you must find and re-lock (**FREQ HOP — REACQUIRE**). With 8 slots you can
  pre-load a whole defended network's frequencies before pushing in.

The Threat/EWS page and HUD reflect all of this: a jammed emitter stops tracking, burns
through up close, and announces hops. When a SAM is destroyed, hops a band away, or you simply
fly out of its detection range, its peak drops off the spectrum and any jam slot that was covering it
**frees itself automatically** — so the slots and the trace always reflect what is actually radiating.

## Threat / EWS page (inbound-missile tracking)

A new MFD page (open it from **HSD → B5**, top OSBs jump back) plots the air-defence
picture: every live SAM emitter with its lethal ring, all bandits, and — the point of
it — **inbound RED missiles**. Each missile shows its **track** (trail), its **launch
point** ("LP") marking where it was fired from, and a time-to-intercept readout, with a
flashing **▲ INBOUND n / TTI** banner. **Tap a launch point or emitter** to designate
that launcher (sets the ground lock + HARM lock) and slew the TGP onto it — so a SAM
fired from a mobile track on the ground can be found, then killed with SAR/HARM/bombs.

## Grander terrain, hard ground, and TGP target-follow

> **TGP upgrades:** ground targets now render as a **2-5 box compound** (a main
> structure + satellites), each box projected through the live camera so the whole
> installation shifts perspective as look-angle and range change. The pod has **4
> zoom stages** on the L1-L4 OSBs (8°/5°/3°/1.5° FOV), and the footer shows slant
> range **SR** and look-down angle **DEP**. Designation is automatic: tapping a
> contact on **FCR / SAR / HAD** slews the pod onto it (the **V** key is now just an
> optional boresight designate).

> **TGP ground targets:** the targeting pod now draws *all* ground threats — the
> strike buildings, HVTs, mobile TELs, **static SAM sites/launchers** and **ground
> structures** — each as a hot, outlined footprint, and bombs destroy SAM sites and
> structures (not just movers/HVTs) with a kill flash on the FLIR, so you can see
> them and see them blow up.

The terrain relief uses the original **1850 m** ceiling (`TERRAIN_VSCALE = 1` in
`core.js`). Taller scaling looked dramatic but let ridgelines occlude the TGP's
line of sight to ground targets, so it was dialled back. Because every consumer
reads the same `terrainH()` — the 3D view, collision, radar masking, AGL/RWR gating, the SAR
clutter map and the TGP relief — the whole sim stays consistent automatically. The
shading reference (`TERRAIN_PEAK`), the mission/spawn/AWACS altitudes and the
en-route waypoint heights were all raised to match, the service ceiling sits at
~16 km so you can still climb over the ridges, and the home runway and target
complex remain flat, sea-level pads so you can take off and recover normally.

The out-the-window view got a pass too: the near terrain mesh uses **smaller, denser
polygons** for smoother ridgelines, and a **coarse distant ring** now extends the
landscape out to ~25 km, fading into the horizon haze so the far ground is never a
blank wall — detail simply sharpens as you close on it. The sky carries a field of
**faint fixed stars** (they stay put on the celestial sphere as you manoeuvre) and a
**soft haze glow** rides the horizon line. The distant ring's resolution scales with
the graphics quality (`−`/`=`) so it stays light on slower machines.

**Hitting the ground is now fatal.** Fly into terrain — gear up, banked, fast, or a
hard sink rate anywhere off a prepared surface — and the jet is destroyed
(`TERRAIN IMPACT`), with the wreck explosion on the deck. A *clean* touchdown still
counts as a landing, but only on the home runway or a FARP with **gear down, wings
roughly level, under ~160 kt and a gentle sink** (< 6 m/s). Anything else wrecks you
(`CRASH ON LANDING`).

The **TGP follows a moving SAR contact**: designate a vehicle or mobile TEL on the
SAR/GMT page and the pod slews to it and **stays locked on as it drives** — the aim
point reads the contact's live position every frame, so a convoy or launcher stays
centred in the FLIR while you set up the attack.

## Splash, favicon & link previews

* A **7-second splash** (`assets/splash.jpg`, the neon "Fighting Falcon" art) plays on load
  with an animated progress bar; the game initialises behind it. Click the splash to skip.
* **Favicons** are wired (`assets/favicon-32.png`, `favicon.png`, `apple-touch-icon.png`).
* **Link-preview / social meta** (Open Graph + Twitter card) are in `<head>` so the page
  unfurls a title, description and image on WhatsApp, X, Instagram, Facebook and Discord.

  > **One edit required for previews to work:** those scrapers need *absolute* `https` URLs.
  > Open `index.html` and replace every `https://YOUR-DOMAIN.example` with the real URL where
  > you host this build (e.g. `https://tendaibhebhe.com/f16`). The `og:image`/`twitter:image`
  > must point at a publicly reachable `assets/splash.jpg`.

## Two datalink channels (E-3 / E-2)

There are **two AWACS radios**, each its own channel:

* **E-3 Sentry** — `124.85` (longer-ranged link)
* **E-2 Hawkeye** — `126.50`

Tune the DED (TUNE keypad) to one of them — the **CH M** key cycles between the two
preset frequencies, or type one in. When the link comes up the DATALINK page header
reads **E3-DATALINK** or **E2-DATALINK** depending on which jet is feeding you, and
the source aircraft is marked on the picture. The `NO LINK` screen lists both
channels with each jet's range so you know which to dial. EASY/NORMAL launch both
AWACS; HARD has only the E-3; ACE has none.

## DATALINK (E-3 / E-2) sensor + the DED keypad

The **DED** has a new **TUNE** sub-page (top OSB **DED**, then bottom OSB **TUNE**)
laid out as a **touch keypad**: a numeric pad (`1`–`9`, `0`, `CLR`, `ENT`) plus the
function keys `GSPD / TGT / TOT / INSERT / DELETE / GRID / CNI / CH M`. Tap digits to
build a frequency in the scratchpad (it auto-formats to `NNN.NN`), then `ENT` or
`INSERT` to tune. `CH M` recalls the AWACS broadcast (**124.85**), `DELETE`
backspaces, `CLR` wipes, `CNI` returns to the CNI page.

Once you tune **124.85** *and* an E-3/E-2 is within link range, the **DATALINK**
page comes alive (from the DED, bottom OSB **DLNK**). It's a sensor in its own
right — but the data comes from the **AWACS**, not your jet — so it shows the full
**80 NM enemy picture** (emitters with rings, TELs/convoys, underground facilities,
HVTs, bandits, the strike target, bullseye and the source aircraft) regardless of
your own radar's range, plus a readout panel with **targeting** (designated BRG/RNG),
**air/emitter/GMT counts** and **bullseye** reference. Tune the wrong frequency or
fly out of range and it reads `NO LINK` with a reminder of what to dial in.

## A living map & rearming

Threats aren't piled onto one hot spot. On top of the layered rings around the
objective, `scatterScenario()` seeds **SAM sites across the whole playable area**
(more, and hostile, as difficulty rises), and convoys / mobile TELs / underground
facilities are spread wide — so flying anywhere turns up activity.

Two friendly **FARPs (reload strips)** are placed procedurally each mission (cyan
markers on the HSD and a cyan strip with a `◈ RELOAD` cross out-the-window). Put
the jet **on the deck and stopped** (gear down, throttle to idle so the parking
brake holds you) within ~240 m of the pad marker and your stores refill to full,
flares top off, and the HUD reads **WEAPONS LOADED**. There's a short cooldown so
one pass reloads once.

## Sound

Audio is generated live with **Tone.js** (`js/tone.js`, the standard UMD build)
through a small standalone wrapper, `js/audio.js` — it exposes `F16Audio` and
nothing in the wrapper is required by the rest of the sim (every call is guarded,
so if the library is missing the game runs silently). Browsers only allow audio
after a user gesture, so it starts on your first key press; toggle it with `U`.

You get an RWR-style warble when a missile is inbound, a steady tone under a SAM
lock, a ground-proximity "whoop" and a repeating **stall beep** (a clear two-tone
alert, not the old AoA tick), master-caution beeps on
damage, gun and missile/bomb-release effects, instrument beeps on
weapon/mode/steerpoint selections, and short win/loss cues. There is **no engine
sound** — by design it's all instrument, radar/RWR and warning audio. It's wired
by feeding per-frame state to `F16Audio.update(...)` from the main loop plus
one-shot `F16Audio.event(...)` calls at the weapon/damage hooks. Web Audio runs
on its own thread, so it costs effectively nothing on the render side.

## Credits

The flight HUD in `js/flighthud.js` is adapted from **simple-hud** by Ibrahim
Bendebka (SB3NDER), used under the MIT License — see `LICENSE-simple-hud.txt`.
It was modified to take a fixed canvas resolution, render one frame per call
from this sim's main loop (instead of its own animation loop), be fed from the
simulator's `world` state, and align its pitch-ladder scale to the 3D view.

## Notes

Everything the instruments show is read from the same `world` state the 3D view
draws, so the HSD map, FCR contacts, and out-the-window markers stay in sync.
The flight model is a simple **load-factor aero model**: available g scales with
airspeed (`AERO.N_K`), capped at `AERO.NMAX`; lift below 1g makes the jet sink
(stall); induced drag (`AERO.IND`) bleeds energy when you pull. It's all easy to
retune in `core.js`: the `AERO` block, `FM` (thrust / rotate speed / roll rate),
`CTRL_TAU` (input smoothing), and `PITCH_SIGN` — pull-up sense.
`PITCH_SIGN` is `+1` so **S pulls the nose up** (verified: S → climb); if pitch
ever feels inverted on your hardware, set it to `-1` and the sense flips.

Terrain is procedural and **endless** — the mesh recenters on the jet every
frame and the heightfield (`terrainH` in `core.js`) is a 5-octave ridged
fractal scaled to tall peaks (`TERRAIN_PEAK`); tune it for higher/lower relief;
the `FLAT_SITES` list keeps pads flat under the runway and target so they stay
playable. Terrain now renders as **solid shaded polygons** painted far-to-near,
so hills properly occlude what's behind them; shading comes from height, slope,
and distance fog.

The **TGP** is a real sensor view, not a fake texture: it renders the world from
the jet toward the designated point as a single-scale grayscale **FLIR** image —
terrain is drawn as **shaded polygons** painted far-to-near (like the
out-the-window view) so hills read as a continuous surface and occlude what's
behind them, plus a line-of-sight check that flags the target **MASKED** when a
ridge blocks it. The patch widens with slant range, so even when you're high or
directly **overhead** the target you still see a sensible spread of ground.
Hot returns (the bunker, HVTs, vehicles, and — in A-A — the locked aircraft,
drawn as the **same solid dart** as the out-the-window view and projected through
the sensor, so its aspect changes as it manoeuvres and as your look-angle moves)
read bright in white-hot and dark in black-hot (R4 OSB). FOV (WIDE/NARO) sets the zoom. Each detected object
gets an **ID box** (red = strike target / HVT / hostile air, orange = vehicle,
yellow = unknown air) so you can tell them apart, target hits flash on the FLIR,
and a **gimbal limit** kicks in when the
jet's attitude swings the look-angle out of reach (it reads **GIMBAL LIMIT**).
The **SAR / GMT** ground map (FCR bottom-left OSB, 2nd mode) is a forward-looking
synthetic-aperture + ground-moving-target scope. The patch is **cued ahead of the
jet**, so you map the ground as you fly; a **range sweep bar** runs through it and
the band it just crossed brightens, so the picture *refreshes each scan* like a
real radar. Terrain paints as **signal return** (brighter = stronger/higher
clutter). On top of that:

* **Moving vehicles & convoys** show as orange blips, each trailing its recent
  **track history** and a short **velocity leader**; mobile **TEL** launchers are
  flagged in red.
* **Underground facilities (UGF)** are too deep to see out-the-window or on the
  TGP, but the SAR finds them — hollow diamonds (red when their launcher is
  armed). They're **inert at EASY/NORMAL** and **live at HARD/ACE**.
* **Tap any contact** on the SAR to designate it — that sets the ground lock, and
  the **TGP immediately slews to it** (the SAR→TGP hand-off), so you can identify
  and laze a mover the radar found. The designated contact gets a `DESIG` box.

Some convoys/TELs **drive into the caverns** and disappear underground (they drop
off the SAR, HSD, TGP and out-the-window view, and stop emitting). Mobile TELs and
armed UGFs are **dual-listed as radar emitters**, so they also appear on the
**HAD**, can be **HARM'd**, and will **shoot back** (HARD/ACE). Tunables live in
`mfd.js` (`renderSAR`: patch quantisation, sweep rate, recency fade) and `core.js`
(`spawnGroundMovers`/`spawnStructures`/`scatterScenario`).

The layout is **full-viewport**: the out-the-window view fills the screen and the
MFDs sit in a band beneath it. The canvases size their buffers to the displayed
area (DPR-aware, in `resizeView` in `main.js`), so when you **zoom the browser
out** the MFDs shrink and the view grows to use the freed space — no wasted room.

Firing an A-A missile (`L`) gives a launch flash and a **MSL AWAY** cue (FOX-2
for the AIM-9, FOX-3 for the AIM-120); the weapon then shows on the HSD as a
friendly track running out to its target, with a smoke trail in the world view.
Killing a target spawns an explosion (visible on the TGP) and removes it from
the world.

Performance: the expensive part used to be terrain noise — the out-the-window
mesh, the SAR patch, and the TGP relief were each re-sampling thousands of
`terrainH` points every frame (the SAR also built a formatted colour string per
cell). Those heightfields are now **cached** (they're fixed in world space and
only rebuild when the grid origin or the sensor centre moves), the SAR uses a
small colour palette instead of per-cell strings, and the three MFDs render
**round-robin** (one per frame) so no single frame pays for all of them. Steady
near-target frames went from thousands of noise evals to a few dozen. Press `F`
for an FPS / frame-time meter (it also shows live entity counts) if you want to
see where a machine stands — profiling showed the cost was terrain noise, not
the Canvas2D drawing itself.

The remaining cost is pixel fill: the view is full-screen and renders at up to 2x
device pixels, which a modest GPU feels. Use `−` / `=` to set graphics quality —
it scales the **internal render resolution** (the biggest lever) plus terrain mesh
density and draw distance. It defaults to **MED**; drop to **LOW** on weaker
hardware (it renders far fewer pixels). The perf meter shows the live render
resolution so you can see the effect. The frame
loop is also guarded so a transient error can't freeze the sim. If a dense area
still chugs, drop the terrain grid (`R`/`step` in `render3d.js`) or difficulty.

On performance: the renderer is still Canvas2D. Moving the environment to
**WebGL** is the right next step for a big leap (it would let the terrain be far
denser at high frame rates), but it's a focused rewrite that needs to be
iterated against a real browser/GPU — see the build notes for the proposed
architecture. The Canvas2D path above is the interim optimization.


## Optional community replay backend

The client now uses a hybrid replay store:

- if `/api/health` responds, it saves and loads community replays through the backend;
- if the backend is unavailable, it falls back to local IndexedDB;
- local pending replays are retried when the backend comes back online.

Run the backend:

```bash
cd server
cp .env.example .env
npm install
npm start
```

For same-origin deployment set `SERVE_CLIENT=true` and open the backend URL. For split frontend/API hosting, define this before `js/storage.js` loads:

```html
<script>window.F16_API_BASE_URL = 'https://your-api.example.com';</script>
```

Firestore writes should only go through the backend. The game client never receives Firebase Admin SDK credentials.


## Recent update: Level 5 / radar horizon / gun training

Level 5 `AIR SUPER` is an air-to-air-only mission. Score multipliers are now Level 1 x2, Level 2 x3, Level 3 x4, Level 4 x5, Level 5 x6. SAMs and Level 5 FCR now model low-altitude/terrain masking. Flight School includes A-A gun and low-level radar-horizon attack lessons.
