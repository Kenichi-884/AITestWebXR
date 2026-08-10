# MR Shooter - WebXR

A Mixed Reality shooting game for Meta Quest, built with Three.js + WebXR.
Developed collaboratively by a team using AI assistance.

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
├── index.html             ← Game HTML & CSS styles
│
├── public/                ─────────────────────────────────
│   └── assets/
│       ├── layout.json    ← Scene & weapon placement (no code needed)
│       └── pistol/
│           ├── models/    ← 3D models (.fbx / .glb)
│           └── textures/  ← Texture images (.png)
│
└── src/                   ─────────────────────────────────
    ├── engine/            ← XR session, game loop
    │   ├── App.js
    │   └── SceneManager.js
    ├── gameplay/          ← Enemy & weapon logic
    │   ├── Enemy.js
    │   ├── EnemySpawner.js
    │   └── Weapon.js
    ├── effects/           ← Visual effects (muzzle flash, sparks, bursts)
    │   └── EffectManager.js
    ├── screens/           ← HUD, menus, score display
    │   ├── HUD.js
    │   └── MenuScreen.js
    ├── sounds/            ← Sound effects & BGM
    │   └── SoundManager.js
    └── common/            ← Shared config & events (discuss before editing)
        ├── Config.js
        └── EventBus.js
```

---

## Who Works Where

| Folder / File | Role | What to edit |
|---|---|---|
| `public/assets/layout.json` | Asset / Scene | Weapon position, size, rotation |
| `public/assets/pistol/` | Asset | Replace 3D models & textures |
| `src/effects/EffectManager.js` | Effects | Muzzle flash, sparks, defeat burst |
| `src/screens/HUD.js` + `index.html` | UI / Screen | HUD, menus, score display |
| `src/sounds/SoundManager.js` | Sound | Sound effects & BGM |
| `src/gameplay/Weapon.js` | Gameplay | Shooting, ammo, reload logic |
| `src/gameplay/Enemy.js` | Gameplay | Enemy behavior & appearance |
| `src/gameplay/EnemySpawner.js` | Gameplay | Wave spawning logic |
| `src/engine/` | Engine | XR session, game loop |
| `src/common/Config.js` | All (discuss first) | Game balance values |
| `src/common/EventBus.js` | **Do not edit** | Module communication bus |

---

## Git Workflow

### Daily flow

```bash
# 1. Pull latest changes before starting work
git pull origin main

# 2. Create your own branch
git checkout -b feature/your-feature-name

# 3. Edit only your assigned files

# 4. Commit and push
git add .
git commit -m "Brief description of what you changed"
git push origin feature/your-feature-name

# 5. Open a Pull Request on GitHub
```

### Branch naming examples

| Role | Branch name |
|---|---|
| UI / Screen | `feature/hud-score-animation` |
| Sound | `feature/shoot-sound-update` |
| Gameplay | `feature/enemy-wave-pattern` |
| Effects | `feature/defeat-particle-effect` |
| Asset | `feature/pistol-model-update` |
| Engine | `feature/xr-session-fix` |

### Conflict prevention rules

1. **Each person edits only their assigned files** — most important rule
2. Edit `src/common/Config.js` only after discussing with the team
3. Never edit `src/common/EventBus.js`
4. Pull from `main` every morning before starting work

---

## Module Communication (EventBus)

Modules communicate via events — they do **not** import each other directly.

```
Player fires weapon
  → Weapon.js        emits  "weapon:fired"
  → SoundManager.js  receives → plays shoot sound
  → EffectManager.js receives → spawns muzzle flash

Enemy defeated
  → Enemy.js         emits  "enemy:defeated"
  → App.js           receives → adds score
  → HUD.js           receives → updates score display
  → SoundManager.js  receives → plays defeat sound
  → EffectManager.js receives → spawns defeat burst
```

### Full event list

| Event | Emitted by | Received by |
|---|---|---|
| `game:start` | App.js | SoundManager |
| `game:over` | App.js | MenuScreen, SoundManager |
| `game:score-update` | App.js | HUD |
| `game:health-update` | App.js | HUD |
| `game:wave-update` | EnemySpawner | HUD |
| `enemy:defeated` | Enemy | App, HUD, SoundManager, EffectManager |
| `enemy:reached-player` | Enemy | App, SoundManager |
| `weapon:fired` | Weapon | SoundManager, EffectManager |
| `weapon:hit` | Weapon | SoundManager, EffectManager |
| `weapon:ammo-update` | Weapon | HUD |
| `weapon:reloading` | Weapon | HUD, SoundManager |
| `sound:play` | Any module | SoundManager |

---

## Game Balance

All tunable values are in **`src/common/Config.js`**.
No code knowledge required — just change the numbers.

```js
WEAPON: {
  COOLDOWN:       0.3,   // Time between shots (seconds)
  BULLET_SPEED:   15.0,  // Bullet speed (m/s)
  MAX_AMMO:       12,    // Magazine size
  RELOAD_TIME:    1.8,   // Reload duration (seconds)
  BULLET_GRAVITY: 0.8,   // Bullet drop (m/s²) — set 0 for laser-straight
},
ENEMY: {
  BASE_SPEED:     0.4,   // Enemy speed (m/s)
  SCORE_PER_KILL: 100,   // Score per enemy
},
```

---

## Weapon & Scene Layout

Edit **`public/assets/layout.json`** to adjust without any code:

```json
"weapon": {
  "modelFile":    "pistol-92.fbx",
  "slideNodeName":"Cube001",
  "slideAxis":    "x",
  "hand":         "right",
  "xr": {
    "position": [0.0, 0.03, 0.0],
    "rotation": [-45, 290, 0],
    "scale":    [0.0002, 0.0002, 0.0002]
  },
  "desktop": {
    "position": [0.12, -0.08, -0.33],
    "rotation": [-40, 265, -5],
    "scale":    [0.0002, 0.0002, 0.0002]
  }
}
```

| Field | Description |
|---|---|
| `slideNodeName` | Mesh node name of the gun slide for animation |
| `slideAxis` | Axis the slide moves along: `x` / `-x` / `y` / `z` |
| `position` | `[X, Y, Z]` offset from controller grip |
| `rotation` | `[X, Y, Z]` rotation in degrees |
| `scale` | Size multiplier (0.0002 = Unity FBX default) |

---

## Controls

| Action | XR (Meta Quest) | Desktop |
|---|---|---|
| Fire | Trigger button | Left click |
| Reload | Tilt muzzle down (hold 0.4s) | `R` key |

