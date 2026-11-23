# LifeSim Online

Plain HTML + JavaScript, no build step. Keep all files in the same folder:

index.html, world.js, vehicles.js, game.js, net.js, systems.js, fx.js, drive.js, physics.js, props.js, traffic.js, avatars.js, main.js

## Play locally
Open index.html in a browser (needs internet for Three.js / PeerJS from CDNs).

## Host on GitHub Pages
Repo > Settings > Pages > Deploy from a branch > main / (root). Your game goes live at
https://YOUR-USERNAME.github.io/YOUR-REPO/

## After updating files
In index.html change `const V = '2'` to `'3'` (then `'3'`...) so browsers don't use cached copies.

## What is in each file
- world.js: scene, lighting, sky, materials, city grid, chunk builder
- vehicles.js: player character model, particles, car models
- game.js: input, camera, enter/exit cars, collisions, player + vehicle updates, HUD, radar
- net.js: PeerJS multiplayer
- systems.js: audio, day/night, paint, damage, traffic, pedestrians, performance merging, settings
- fx.js: skid marks and bloom
- drive.js: gearbox, RPM, dials, steering wheel
- main.js: startup and main loop

- physics.js: NEW - stable collision physics (fixed sub-stepping, SAT contacts, impulses, safe-pose recovery, on-foot circle resolver)
- props.js: NEW - night glow halos, traffic-signal heads, crosswalks/stop lines, bus stops, parked cars, hydrants/bins/benches/mailboxes/signs
- traffic.js: NEW - lane-following solid AI traffic, signals, buses, pedestrians, reactions, police + wanted level, host-synced traffic
- avatars.js: NEW - citizen avatar + outfit picker, walking animations, emotes (G then 1-6)

## New controls / settings
G emotes, V cycles third-person / cockpit / hood camera (mirrors show in cockpit + hood). Settings: Police chases, Working mirrors.

## Multiplayer rules
Player names are unique (case-insensitive); the host asks a duplicate to pick another. Leaving players are detected instantly (BYE / HOST_BYE) or after 15 s of silence.
