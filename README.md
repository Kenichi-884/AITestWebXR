# MR Shooter - WebXR

A Mixed Reality shooting game for Meta Quest, built with Three.js + WebXR.
Developed collaboratively by a 5-person team using AI assistance.

---

## How to Start

### Windows
Double-click **`START-Windows.bat`**

### macOS
Double-click **`START-Mac.command`**

> First launch automatically runs `npm install`. Subsequent launches go straight to the server.

Once the server starts, you will see:
```
  Local:   https://localhost:5173
  Network: https://192.168.x.x:5173  ← Open this on Meta Quest
```

**Note:** If the browser shows "Connection not private", click **Advanced → Proceed**. This is expected with the self-signed certificate.

---

## Requirements

- [Node.js](https://nodejs.org/) LTS version (v18 or later)
- Meta Quest (browser must be on the same Wi-Fi as your PC/Mac)

---

## Folder Structure

```
AITestWebXR/
│
├── START-Windows.bat      ← Windows: double-click to launch
├── START-Mac.command      ← macOS:   double-click to launch
├── index.html             ← Game HTML & UI layout
│
├── public/                ─────────────────────────────────
│   └── assets/            ← Assets (no code knowledge needed)
│       ├── layout.json    ← Scene object placement settings
│       └── pistol/
│           ├── models/    ← 3D models (.fbx / .glb)
│           └── textures/  ← Texture images (.png)
│
└── src/                   ─────────────────────────────────
    │                      ← Source code
    ├── engine/            ← XR session, game loop (core system)
    │   ├── App.js
    │   └── SceneManager.js
    ├── gameplay/          ← Enemy & weapon logic
    │   ├── Enemy.js
    │   ├── EnemySpawner.js
    │   └── Weapon.js
    ├── screens/           ← HUD, menus, score display
    │   ├── HUD.js
    │   └── MenuScreen.js
    ├── sounds/            ← Sound effects & BGM
    │   └── SoundManager.js
    └── common/            ← Shared config & events (ask team before editing)
        ├── Config.js
        └── EventBus.js
```

---

## Who Works Where

| Folder / File | Owner | What to edit |
|---|---|---|
| `public/assets/layout.json` | Scene layout member | Object positions, sizes, colors |
| `public/assets/pistol/` | Asset member | Replace 3D models & textures |
| `src/screens/` | UI/Screen member | HUD, menus, score display |
| `src/sounds/` | Sound member | Sound effects & BGM |
| `src/gameplay/` | Gameplay member | Enemy behavior, shooting logic |
| `src/engine/` | Engine member | XR session, game loop |
| `src/common/Config.js` | All (discuss first) | Game balance values |
| `src/common/EventBus.js` | Do not edit | Module communication bus |
| `index.html` | UI/Screen member | HTML structure & CSS styles |

---

## Git Workflow (Team of 5)

### Daily flow

```bash
# 1. Pull latest changes before starting work
git pull origin main

# 2. Create your own branch
git checkout -b feature/your-feature-name

# 3. Edit only your assigned files

# 4. Commit your changes
git add .
git commit -m "Brief description of what you changed"

# 5. Push and open a Pull Request
git push origin feature/your-feature-name
```

### Branch naming examples

| Member | Branch name |
|---|---|
| Screen/UI | `feature/hud-score-animation` |
| Sound | `feature/shoot-sound-update` |
| Gameplay | `feature/enemy-wave-pattern` |
| Asset | `feature/pistol-model-update` |
| Engine | `feature/xr-session-fix` |

### Conflict prevention rules

1. **Each person edits only their assigned files** — this is the most important rule
2. Edit `src/common/Config.js` only after discussing with the team
3. Never edit `src/common/EventBus.js`
4. Pull from `main` every morning before starting work

---

## Module Communication (EventBus)

Modules communicate via events — they do **not** call each other directly.
This prevents conflicts between files.

```
Enemy defeated
  → Enemy.js         emits  "enemy:defeated"
  → HUD.js           receives → updates score display
  → SoundManager.js  receives → plays defeat sound
```

### Event list

| Event | Emitted by | Received by |
|---|---|---|
| `game:start` | App.js | SoundManager, HUD |
| `game:over` | App.js | MenuScreen, SoundManager |
| `game:score-update` | App.js | HUD |
| `game:health-update` | App.js | HUD |
| `game:wave-update` | EnemySpawner | HUD |
| `enemy:defeated` | Enemy | App, HUD, SoundManager |
| `enemy:reached-player` | Enemy | App, SoundManager |
| `weapon:fired` | Weapon | SoundManager |
| `weapon:hit` | Weapon | SoundManager |
| `sound:play` | Any module | SoundManager |

---

## Game Balance

All game parameters are in **`src/common/Config.js`**.
No code knowledge required — just change the numbers.

```js
ENEMY: {
  BASE_SPEED: 0.4,       // Enemy movement speed (m/s)
  SCORE_PER_KILL: 100,   // Score per enemy defeated
  SPAWN_RADIUS_MIN: 3.0, // Minimum spawn distance (m)
},
WEAPON: {
  COOLDOWN: 0.3,         // Time between shots (seconds)
  BULLET_SPEED: 15.0,    // Bullet speed (m/s)
},
```

---

## Weapon Model

The pistol model is located at:
```
public/assets/pistol/models/Pistol 92.fbx
public/assets/pistol/textures/
```

To swap the model, replace the `.fbx` file and update `public/assets/layout.json`:
```json
"weapon": {
  "modelFile": "YourModel.fbx",
  "scale": [0.003, 0.003, 0.003]
}
```

> **Tip:** Converting FBX to GLB (via Blender: File → Export → glTF 2.0) results in faster loading and automatic texture bundling.
