/**
 * WorldHUD - XR空間に浮かぶ3D HUDパネル
 * ============================================================
 * 担当: HUD画面担当メンバー
 *
 * DOMオーバーレイはXR中でも表示されるが視野の端にあって見えにくい。
 * このクラスはカメラに追従するキャンバステクスチャ平面として
 * スコア・HP・弾数などをAR空間に直接表示する。
 *
 * show() / hide() / update(delta) を App.js から呼ぶ。
 * ============================================================
 */

import * as THREE from 'three';
import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

// キャンバスの描画解像度 (ピクセル)
const CW = 512;
const CH = 200;

// カメラからパネルへのオフセット (ローカル座標)
const OFFSET_X =  0.00;
const OFFSET_Y = -0.22;
const OFFSET_Z = -0.75;

// 3Dパネルのサイズ (メートル)
const PANEL_W = 0.64;
const PANEL_H = PANEL_W * (CH / CW);

export class WorldHUD {
  /**
   * @param {THREE.Scene}  scene
   * @param {THREE.Camera} camera
   */
  constructor(scene, camera) {
    this._scene  = scene;
    this._camera = camera;

    // ── HUD の状態 ──────────────────────────────────────────
    this._score     = 0;
    this._health    = Config.PLAYER.MAX_HEALTH;
    this._maxHealth = Config.PLAYER.MAX_HEALTH;
    this._wave      = 1;
    this._ammo      = Config.WEAPON.MAX_AMMO;
    this._maxAmmo   = Config.WEAPON.MAX_AMMO;
    this._reloading = false;
    this._powerUp   = null;
    this._powerUpDuration = 0; // パワーアップ残り時間
    this._dirty     = true;
    this._blinkT    = 0;       // リロード点滅用タイマー
    this._damageFlashT = 0;    // ダメージフラッシュタイマー (秒)

    // ── Canvas ──────────────────────────────────────────────
    this._canvas = document.createElement('canvas');
    this._canvas.width  = CW;
    this._canvas.height = CH;
    this._ctx = this._canvas.getContext('2d');

    // ── Three.js ────────────────────────────────────────────
    this._texture = new THREE.CanvasTexture(this._canvas);
    this._texture.minFilter = THREE.LinearFilter;
    this._texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
    const mat = new THREE.MeshBasicMaterial({
      map:         this._texture,
      transparent: true,
      depthTest:   false,   // 壁や敵の後ろに隠れないように
      depthWrite:  false,
      side:        THREE.FrontSide,
    });

    this._mesh = new THREE.Mesh(geo, mat);
    this._mesh.renderOrder = 999;
    this._mesh.visible     = false;
    this._scene.add(this._mesh);

    // GC回避用キャッシュ
    this._camPos  = new THREE.Vector3();
    this._camQuat = new THREE.Quaternion();
    this._tmp     = new THREE.Vector3();

    // ── EventBus ────────────────────────────────────────────
    EventBus.on('game:score-update',  ({ score })           => { this._score    = score; this._dirty = true; });
    EventBus.on('game:health-update', ({ health, maxHealth }) => {
      if (health < this._health) this._damageFlashT = 0.5; // 被弾フラッシュ
      this._health    = health;
      this._maxHealth = maxHealth;
      this._dirty = true;
    });
    EventBus.on('game:wave-update',   ({ wave })             => { this._wave    = wave;  this._dirty = true; });
    EventBus.on('weapon:ammo-update', ({ ammo, max })        => { this._ammo   = ammo;  this._maxAmmo = max; this._reloading = false; this._dirty = true; });
    EventBus.on('weapon:reloading',   ()                     => { this._reloading = true; this._dirty = true; });
    EventBus.on('powerup:activated',  ({ type, duration })   => { this._powerUp = type; this._powerUpDuration = duration ?? 0; this._dirty = true; });
    EventBus.on('powerup:ended',      ()                     => { this._powerUp = null; this._powerUpDuration = 0; this._dirty = true; });
    EventBus.on('game:start',         ()                     => { this._onGameStart(); });
  }

  // ── ライフサイクル ─────────────────────────────────────────

  show() {
    this._mesh.visible = true;
    this._dirty        = true;
  }

  hide() {
    this._mesh.visible = false;
  }

  /** @param {number} delta */
  update(delta) {
    if (!this._mesh.visible) return;

    // カメラに追従 (毎フレーム位置・向きを同期)
    this._camera.getWorldPosition(this._camPos);
    this._camera.getWorldQuaternion(this._camQuat);

    this._tmp.set(OFFSET_X, OFFSET_Y, OFFSET_Z).applyQuaternion(this._camQuat);
    this._mesh.position.copy(this._camPos).add(this._tmp);
    this._mesh.quaternion.copy(this._camQuat);

    // リロード点滅タイマー
    if (this._reloading) {
      this._blinkT += delta;
      this._dirty   = true;
    } else {
      this._blinkT = 0;
    }

    // ダメージフラッシュタイマー
    if (this._damageFlashT > 0) {
      this._damageFlashT -= delta;
      this._dirty = true;
    }

    // パワーアップ残り時間カウントダウン
    if (this._powerUp && this._powerUpDuration > 0) {
      this._powerUpDuration -= delta;
      this._dirty = true;
    }

    if (this._dirty) {
      this._dirty = false;
      this._draw();
    }
  }

  // ── 描画 ───────────────────────────────────────────────────

  _draw() {
    const ctx = this._ctx;
    ctx.clearRect(0, 0, CW, CH);

    // ── 背景 ──────────────────────────────────────────────
    ctx.fillStyle = 'rgba(2, 8, 24, 0.90)';
    this._rrect(ctx, 2, 2, CW - 4, CH - 4, 12);
    ctx.fill();

    // ダメージフラッシュ: 被弾時に赤く点滅
    if (this._damageFlashT > 0) {
      const flashAlpha = Math.min(1, this._damageFlashT * 2) * 0.45;
      ctx.fillStyle = `rgba(220,30,30,${flashAlpha})`;
      this._rrect(ctx, 2, 2, CW - 4, CH - 4, 12);
      ctx.fill();
    }

    // 外枠ボーダー (ダメージ中は赤に変化)
    const flashRatio = Math.min(1, this._damageFlashT * 2);
    const borderR = Math.round(0 + 220 * flashRatio);
    const borderG = Math.round(200 * (1 - flashRatio));
    const borderB = Math.round(255 * (1 - flashRatio));
    ctx.strokeStyle = `rgba(${borderR},${borderG},${borderB},${0.35 + flashRatio * 0.5})`;
    ctx.lineWidth = 1.5 + flashRatio * 2;
    this._rrect(ctx, 2, 2, CW - 4, CH - 4, 12);
    ctx.stroke();

    // 上部グロウライン
    this._glowLine(ctx, 0, 3, CW, 3, 3, 'rgba(0,200,255,0.80)');
    // 下部グロウライン
    this._glowLine(ctx, 0, CH - 5, CW, CH - 5, 2, 'rgba(0,200,255,0.40)');

    ctx.textBaseline = 'top';

    // ── Row 1: WAVE (左) | SCORE (中) | AMMO数値 (右) ─────
    const ROW1_Y = 10;

    // WAVE
    this._label(ctx, 'WAVE', 16, ROW1_Y, 'left');
    this._value(ctx, this._wave, 16, ROW1_Y + 12, 'left', '#00e5ff', 36);

    // SCORE
    this._label(ctx, 'SCORE', CW / 2, ROW1_Y, 'center');
    this._value(ctx, this._score.toLocaleString(), CW / 2, ROW1_Y + 14, 'center', '#ffffff', 30);

    // AMMO
    this._label(ctx, 'AMMO', CW - 16, ROW1_Y, 'right');
    if (this._reloading) {
      const blink = Math.sin(this._blinkT * 9) > 0;
      if (blink) {
        ctx.font        = 'bold 15px monospace';
        ctx.fillStyle   = '#ffd60a';
        ctx.textAlign   = 'right';
        ctx.shadowColor = '#ffd60a';
        ctx.shadowBlur  = 10;
        ctx.fillText('RELOADING', CW - 16, ROW1_Y + 16);
        ctx.shadowBlur  = 0;
      }
    } else {
      const col = this._ammo === 0 ? '#ff2d55'
                : this._ammo <= 3  ? '#ff9500'
                                   : '#ffd60a';
      this._value(ctx, this._ammo, CW - 16, ROW1_Y + 12, 'right', col, 38);
    }

    // ── 区切り線 ──────────────────────────────────────────
    const DIV_Y = 78;
    ctx.strokeStyle = 'rgba(0,200,255,0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(14, DIV_Y);
    ctx.lineTo(CW - 14, DIV_Y);
    ctx.stroke();

    // ── Row 2: HP バー (左2/3) | 弾薬ドット (右1/3) ──────
    const ROW2_Y = DIV_Y + 8;
    const pct  = Math.max(0, Math.min(1, this._health / this._maxHealth));
    const hCol = pct > 0.6 ? '#30d158' : pct > 0.3 ? '#ffd60a' : '#ff2d55';

    // HP ラベル
    ctx.font         = 'bold 10px monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = 'rgba(150,180,200,0.70)';
    ctx.textAlign    = 'left';
    ctx.fillText('HP', 16, ROW2_Y);

    ctx.fillStyle   = hCol;
    ctx.shadowColor = hCol;
    ctx.shadowBlur  = 4;
    ctx.textAlign   = 'left';
    ctx.fillText(`${Math.round(pct * 100)}%`, 40, ROW2_Y);
    ctx.shadowBlur  = 0;

    // HP バー
    const HP_X = 16;
    const HP_Y = ROW2_Y + 16;
    const HP_W = 300;
    const HP_H = 16;

    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.rect(HP_X, HP_Y, HP_W, HP_H); ctx.fill();

    if (pct > 0) {
      ctx.fillStyle   = hCol;
      ctx.shadowColor = hCol;
      ctx.shadowBlur  = pct <= 0.3 ? 12 : 5;
      ctx.beginPath(); ctx.rect(HP_X, HP_Y, Math.max(6, HP_W * pct), HP_H); ctx.fill();
      ctx.shadowBlur  = 0;
    }

    // HP バー区切り
    ctx.strokeStyle = 'rgba(0,0,0,0.40)';
    ctx.lineWidth   = 1;
    for (let i = 1; i < 4; i++) {
      const x = HP_X + HP_W * i * 0.25;
      ctx.beginPath(); ctx.moveTo(x, HP_Y); ctx.lineTo(x, HP_Y + HP_H); ctx.stroke();
    }

    // 弾薬ドット (右側)
    if (!this._reloading) {
      const DOT_W  = 8;
      const DOT_H  = 18;
      const DOT_GAP = 3;
      const COLS   = 6;
      const ROWS   = Math.ceil(this._maxAmmo / COLS);
      const startX = CW - 16 - (COLS * (DOT_W + DOT_GAP) - DOT_GAP);
      const startY = ROW2_Y + 2;

      for (let i = 0; i < this._maxAmmo; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x   = startX + col * (DOT_W + DOT_GAP);
        const y   = startY + row * (DOT_H + 3);
        const loaded = i < this._ammo;
        const dotCol = loaded
          ? (this._ammo <= 3 ? '#ff9500' : '#ffd60a')
          : 'rgba(255,255,255,0.12)';

        ctx.fillStyle   = dotCol;
        ctx.shadowColor = dotCol;
        ctx.shadowBlur  = loaded ? 5 : 0;
        ctx.beginPath(); ctx.roundRect(x, y, DOT_W, DOT_H, 2); ctx.fill();
        ctx.shadowBlur  = 0;
      }
    }

    // ── パワーアップ ──────────────────────────────────────
    if (this._powerUp) {
      const labels = { power: 'POWER ×5', rapid: 'RAPID FIRE', shotgun: 'SHOTGUN' };
      const colors  = { power: '#ff4422',  rapid: '#00ffcc',    shotgun: '#ffd60a'  };
      const col   = colors[this._powerUp] ?? '#ffffff';
      const label = labels[this._powerUp] ?? this._powerUp;

      // 背景帯
      // 背景帯 (rgba形式で確実に動作させる)
      const r = parseInt(col.slice(1,3),16), g = parseInt(col.slice(3,5),16), b = parseInt(col.slice(5,7),16);
      ctx.fillStyle = `rgba(${r},${g},${b},0.15)`;
      ctx.beginPath(); ctx.rect(14, CH - 30, CW - 28, 24); ctx.fill();

      // タイムバー (残り時間の割合)
      const totalDur = Config.POWERUP.DURATION;
      const barPct = totalDur > 0 ? Math.max(0, Math.min(1, this._powerUpDuration / totalDur)) : 1;
      const BAR_X = 14; const BAR_W = CW - 28; const BAR_H = 3;
      ctx.fillStyle = `rgba(${r},${g},${b},0.25)`;
      ctx.beginPath(); ctx.rect(BAR_X, CH - 32, BAR_W, BAR_H); ctx.fill();
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.rect(BAR_X, CH - 32, Math.max(0, BAR_W * barPct), BAR_H); ctx.fill();
      ctx.shadowBlur = 0;

      ctx.font         = 'bold 13px monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle    = col;
      ctx.shadowColor  = col;
      ctx.shadowBlur   = 12;
      ctx.fillText(`◆ ${label}`, CW / 2, CH - 10);
      ctx.shadowBlur   = 0;
    }

    this._texture.needsUpdate = true;
  }

  // ── 描画ヘルパー ───────────────────────────────────────────

  _label(ctx, text, x, y, align) {
    ctx.font      = '600 9px monospace';
    ctx.fillStyle = 'rgba(180,210,230,0.45)';
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillText(text, x, y);
  }

  _value(ctx, text, x, y, align, color, size = 28) {
    ctx.font        = `bold ${size}px monospace`;
    ctx.fillStyle   = color;
    ctx.textAlign   = align;
    ctx.textBaseline = 'top';
    ctx.shadowColor = color;
    ctx.shadowBlur  = 7;
    ctx.fillText(text, x, y);
    ctx.shadowBlur  = 0;
  }

  _glowLine(ctx, x1, y1, x2, y2, thickness, color) {
    const g = ctx.createLinearGradient(x1, 0, x2, 0);
    g.addColorStop(0,    'rgba(0,0,0,0)');
    g.addColorStop(0.12, color);
    g.addColorStop(0.88, color);
    g.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y1, CW, thickness);
  }

  _rrect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y,     x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x,     y + h, r);
      ctx.arcTo(x,     y + h, x,     y,     r);
      ctx.arcTo(x,     y,     x + w, y,     r);
      ctx.closePath();
    }
  }

  _onGameStart() {
    this._score          = 0;
    this._health         = Config.PLAYER.MAX_HEALTH;
    this._maxHealth      = Config.PLAYER.MAX_HEALTH;
    this._wave           = 1;
    this._ammo           = Config.WEAPON.MAX_AMMO;
    this._maxAmmo        = Config.WEAPON.MAX_AMMO;
    this._reloading      = false;
    this._powerUp        = null;
    this._powerUpDuration = 0;
    this._damageFlashT   = 0;
    this._dirty          = true;
  }
}
