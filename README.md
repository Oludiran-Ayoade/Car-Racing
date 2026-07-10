# Web Kart Racer

A lightweight, browser-based 3D kart racing game built with [Three.js](https://threejs.org/). It runs entirely in the browser and can be hosted on Netlify for free.

## Features

- 3D kart driving with acceleration, braking, reverse, drifting, and boost pads
- A custom-built loop track with curbs and a start/finish line
- Lap timer and lap counter
- Procedural trees and rocks for scenery
- Dynamic follow camera
- Responsive HUD

## Controls

- **W / Arrow Up** — Accelerate
- **S / Arrow Down** — Brake / Reverse
- **A / D** or **Arrow Left / Arrow Right** — Steer
- **Space** — Drift
- **R** — Reset kart

## Run locally

You need a simple static server because the game uses ES modules.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

## Deploy to Netlify

### Option 1: Drag and drop

1. Go to [netlify.com](https://netlify.com) and log in.
2. From the dashboard, click **Add new site** → **Deploy manually**.
3. Drag the `web-kart-racer` folder into the upload area.
4. Netlify will give you a public URL.

### Option 2: Netlify CLI

```bash
npm install -g netlify-cli
netlify deploy --dir=/Users/Gracegold/Desktop/Games/racing/web-kart-racer --prod
```

Replace the path with the actual folder path on your machine.

## Project structure

- `index.html` — Main page
- `style.css` — HUD styling
- `game.js` — Game logic, scene, physics, and rendering
- `README.md` — This file

## Notes

This is a standalone browser game, separate from SuperTuxKart. It was created so the project can be played directly on the web and hosted on Netlify without porting the native C++ codebase to WebAssembly.
# Car-Racing
