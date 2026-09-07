/**
 * Weapon - 射撃・弾の生成と管理・コントローラー入力
 * ============================================================
 * 担当: 武器・射撃担当メンバー
 *
 * 作業ガイド:
 *   - コントローラーのトリガー入力 → _setupXRInput() (selectstart イベント)
 *   - デスクトップではクリックで射撃 → _setupDesktopInput()
 *   - 弾の見た目変更 → _createBulletMesh()
 *   - 当たり判定は App.js から checkCollisions() を呼んで行う
 *
 * このファイルで触るもの: このファイルのみ
 * ============================================================
 */

import * as THREE from 'three';
import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

const TRAIL_MAX      = 16;    // トレイルの最大点数
const TILT_THRESHOLD = -0.65; // コントローラーの前方向Y成分がこれ以下でリロード傾き判定
const TILT_HOLD_TIME = 0.4;   // 傾きを何秒維持したらリロード開始
// ゲームバランス値は Config.WEAPON で管理 (src/common/Config.js)

// 弾(マジックミサイル)の色。パワーアップ種別ごとに変化する
const BULLET_COLORS = {
  default: 0x8a4bff, // 通常: アルケインパープル
  power:   0xff2200,
  rapid:   0x00ffcc,
  shotgun: 0xffaa00,
};

/** @typedef {{ mesh: THREE.Object3D, velocity: THREE.Vector3, lifetime: number, active: boolean, trail: THREE.Line, trailPos: Float32Array, trailLen: number }} Bullet */

export class Weapon {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Camera} camera
   * @param {import('../engine/SceneManager.js').SceneManager} [sceneManager] 銃口レーザーと弾の弾道を一致させるために使用
   */
  constructor(scene, renderer, camera, sceneManager = null) {
    this.scene        = scene;
    this.renderer     = renderer;
    this.camera       = camera;
    this.sceneManager = sceneManager;

    /** @type {Bullet[]} */
    this._bullets = [];
    this._cooldown = 0;
    this._isActive = false;

    // 弾数管理
    this._ammo        = Config.WEAPON.MAX_AMMO;
    this._isReloading = false;
    this._reloadTimer = 0;
    this._tiltTimer   = 0; // コントローラー傾き持続時間

    // パワーアップ管理
    this._powerUp      = null; // 'power' | 'rapid' | 'shotgun' | null
    this._powerUpTimer = 0;

    // 長押し連射管理
    this._heldControllers = new Set(); // XR: 押しっぱなしのコントローラー
    this._mouseHeld       = false;     // Desktop: マウス押しっぱなし

    // 弾の見た目: マジックミサイル風の発光オーブ(コア+グロウシェル)
    // ジオメトリは全弾で共有、マテリアルは色ごとにキャッシュして再利用する
    this._bulletCoreGeo = new THREE.IcosahedronGeometry(0.045, 1);
    this._bulletGlowGeo = new THREE.IcosahedronGeometry(0.09, 1);
    /** @type {Map<number, {core: THREE.Material, glow: THREE.Material}>} */
    this._bulletMatCache = new Map();
    this._bulletTime = 0; // 発光パルス・回転アニメーション用の経過時間

    // フレームごとに再利用するオブジェクト（GCを避けるためキャッシュ）
    this._reloadQuat = new THREE.Quaternion();
    this._reloadForward = new THREE.Vector3();
    this._hitRadiusSq = (Config.ENEMY.HIT_RADIUS + Config.WEAPON.BULLET_RADIUS) ** 2;

    this._setupDesktopInput();
    this._setupXRInput();
  }

  // ─── ライフサイクル ───────────────────────────────────────

  start() {
    this._isActive    = true;
    this._bullets     = [];
    this._cooldown    = 0;
    this._ammo        = Config.WEAPON.MAX_AMMO;
    this._isReloading = false;
    this._reloadTimer = 0;
    this._tiltTimer   = 0;
    this._powerUp      = null;
    this._powerUpTimer = 0;
    this._emitAmmo();
  }

  stop() {
    this._isActive = false;
    this._heldControllers.clear();
    this._mouseHeld = false;
  }

  reset() {
    for (const b of this._bullets) {
      if (b.mesh.parent) this.scene.remove(b.mesh);
      this._removeTrail(b);
    }
    this._bullets     = [];
    this._cooldown    = 0;
    this._isActive    = false;
    this._ammo        = Config.WEAPON.MAX_AMMO;
    this._isReloading = false;
    this._reloadTimer = 0;
    this._tiltTimer   = 0;
    this._powerUp      = null;
    this._powerUpTimer = 0;
    this._heldControllers.clear();
    this._mouseHeld = false;
  }

  // ─── 毎フレーム処理 ──────────────────────────────────────

  update(delta) {
    if (!this._isActive) return;

    if (this._cooldown > 0) this._cooldown -= delta;

    // 長押し連射: XR コントローラー
    for (const ctrl of this._heldControllers) {
      this._fireFromController(ctrl);
    }
    // 長押し連射: デスクトップ マウス
    if (this._mouseHeld && !this.renderer.xr.isPresenting) {
      this._fireFromCamera();
    }

    // リロード処理
    if (this._isReloading) {
      this._reloadTimer -= delta;
      if (this._reloadTimer <= 0) {
        this._ammo        = Config.WEAPON.MAX_AMMO;
        this._isReloading = false;
        this._emitAmmo();
      }
    }

    // パワーアップタイマー
    if (this._powerUpTimer > 0) {
      this._powerUpTimer -= delta;
      if (this._powerUpTimer <= 0) {
        this._powerUp      = null;
        this._powerUpTimer = 0;
        EventBus.emit('powerup:ended', {});
      }
    }

    // XR: コントローラー傾きでリロード
    if (this.renderer.xr.isPresenting) {
      this._checkReloadTilt(delta);
    }

    this._bulletTime += delta;
    // 発光パルス: 色ごとに共有しているマテリアルへまとめて反映
    const pulse = 1.1 + Math.sin(this._bulletTime * 12) * 0.5;
    for (const mats of this._bulletMatCache.values()) {
      mats.core.emissiveIntensity = pulse;
    }

    for (const bullet of this._bullets) {
      if (!bullet.active) continue;

      // 重力で弾道を弧にする
      bullet.velocity.y -= Config.WEAPON.BULLET_GRAVITY * delta;
      bullet.mesh.position.addScaledVector(bullet.velocity, delta);
      // オーブを回転させて魔力の渦感を出す
      bullet.mesh.rotation.x += delta * 6;
      bullet.mesh.rotation.y += delta * 9;

      // トレイル: 先頭に現在位置を挿入、末尾を押し出す
      const tp = bullet.trailPos;
      tp.copyWithin(3, 0, (TRAIL_MAX - 1) * 3);
      tp[0] = bullet.mesh.position.x;
      tp[1] = bullet.mesh.position.y;
      tp[2] = bullet.mesh.position.z;
      bullet.trailLen = Math.min(bullet.trailLen + 1, TRAIL_MAX);
      if (bullet.trailGeo) {
        bullet.trailGeo.setDrawRange(0, bullet.trailLen);
        bullet.trailGeo.attributes.position.needsUpdate = true;
      }

      bullet.lifetime -= delta;
      if (bullet.lifetime <= 0) {
        bullet.active = false;
        this.scene.remove(bullet.mesh);
        this._removeTrail(bullet);
      }
    }
  }

  checkCollisions(enemies) {
    for (const bullet of this._bullets) {
      if (!bullet.active) continue;
      for (const enemy of enemies) {
        if (!enemy.isActive) continue;
        if (bullet.mesh.position.distanceToSquared(enemy.position) < this._hitRadiusSq) {
          bullet.active = false;
          this.scene.remove(bullet.mesh);
          this._removeTrail(bullet);
          enemy.hit(bullet.damage ?? 1);
          EventBus.emit('weapon:hit', { bullet, enemy });
          break;
        }
      }
    }
  }

  /**
   * アイテムとの当たり判定
   * @param {import('./ItemDrop.js').ItemDrop[]} items
   */
  checkItemCollisions(items) {
    const RADIUS_SQ = 0.22 * 0.22;
    for (const bullet of this._bullets) {
      if (!bullet.active) continue;
      for (const item of items) {
        if (!item.isActive) continue;
        if (bullet.mesh.position.distanceToSquared(item.position) < RADIUS_SQ) {
          bullet.active = false;
          this.scene.remove(bullet.mesh);
          this._removeTrail(bullet);
          item.collect();
          break;
        }
      }
    }
  }

  /**
   * パワーアップを有効化する
   * @param {'power'|'rapid'|'shotgun'} type
   * @param {number} duration
   */
  activatePowerUp(type, duration) {
    this._powerUp      = type;
    this._powerUpTimer = duration;
    EventBus.emit('powerup:activated', { type, duration });
    EventBus.emit('sound:play', { id: 'powerup' });
  }

  cleanup() {
    this._bullets = this._bullets.filter((b) => b.active);
  }

  // ─── コントローラー入力 ──────────────────────────────────

  _setupXRInput() {
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);

      // inputSource を取得して振動に使う
      controller.addEventListener('connected', (e) => {
        controller.userData.inputSource = e.data;
      });
      controller.addEventListener('disconnected', () => {
        controller.userData.inputSource = null;
        this._heldControllers.delete(controller);
      });

      controller.addEventListener('selectstart', () => {
        if (!this._isActive) return;
        this._heldControllers.add(controller);
      });
      controller.addEventListener('selectend', () => {
        this._heldControllers.delete(controller);
      });
    }
  }

  _fireFromController(controller) {
    if (this._cooldown > 0) return;
    // 赤いレーザーと弾の弾道を一致させるため、まず銃口の実座標/向きを使う。
    // 取得できない場合(モデル未ロード等)はコントローラーの向きにフォールバックする。
    const muzzle = this.sceneManager?.getMuzzleTransform();
    let position, direction;
    if (muzzle) {
      position  = muzzle.position;
      direction = muzzle.direction;
    } else {
      position  = new THREE.Vector3();
      direction = new THREE.Vector3(0, 0, -1);
      controller.getWorldPosition(position);
      direction.applyQuaternion(controller.quaternion);
    }
    this._spawnBullet(position, direction);
    this._pulseHaptic(controller, 0.5, 40);
  }

  /**
   * XRコントローラーのハプティクス振動
   * @param {THREE.XRTargetRaySpace} controller
   * @param {number} intensity 0〜1
   * @param {number} durationMs ミリ秒
   */
  _pulseHaptic(controller, intensity = 0.5, durationMs = 40) {
    try {
      const actuators = controller.userData.inputSource?.gamepad?.hapticActuators;
      if (actuators?.length > 0) actuators[0].pulse(intensity, durationMs);
    } catch (_) { /* 対応していない端末では無視 */ }
  }

  // ─── デスクトップ入力 ────────────────────────────────────

  _setupDesktopInput() {
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this._isActive || this.renderer.xr.isPresenting) return;
      this._mouseHeld = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._mouseHeld = false;
    });

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyR' || !this._isActive || this.renderer.xr.isPresenting) return;
      this._startReload();
    });
  }

  _fireFromCamera() {
    if (this._cooldown > 0) return;
    // 赤いレーザーと弾の弾道を一致させるため、まず銃口の実座標/向きを使う。
    // 取得できない場合(モデル未ロード等)はカメラの向きにフォールバックする。
    const muzzle = this.sceneManager?.getMuzzleTransform();
    let position, direction;
    if (muzzle) {
      position  = muzzle.position;
      direction = muzzle.direction;
    } else {
      position  = new THREE.Vector3();
      direction = new THREE.Vector3(0, 0, -1);
      this.camera.getWorldPosition(position);
      direction.applyQuaternion(this.camera.quaternion);
    }
    this._spawnBullet(position, direction);
  }

  /**
   * XR: 右コントローラーを下に向けたままにするとリロード開始
   */
  _checkReloadTilt(delta) {
    const controller = this.renderer.xr.getController(1); // 右手
    controller.getWorldQuaternion(this._reloadQuat);
    this._reloadForward.set(0, 0, -1).applyQuaternion(this._reloadQuat);

    if (this._reloadForward.y < TILT_THRESHOLD) {
      this._tiltTimer += delta;
      if (this._tiltTimer >= TILT_HOLD_TIME) {
        this._tiltTimer = 0;
        this._startReload();
      }
    } else {
      this._tiltTimer = 0;
    }
  }

  _startReload() {
    if (this._isReloading || this._ammo === Config.WEAPON.MAX_AMMO) return;
    this._isReloading = true;
    this._reloadTimer = Config.WEAPON.RELOAD_TIME;
    EventBus.emit('weapon:reloading', { reloadTime: Config.WEAPON.RELOAD_TIME });
    EventBus.emit('sound:play', { id: 'reload' });
  }

  _emitAmmo() {
    EventBus.emit('weapon:ammo-update', { ammo: this._ammo, max: Config.WEAPON.MAX_AMMO, reloading: this._isReloading });
  }

  // ─── 弾の生成 ────────────────────────────────────────────

  _spawnBullet(position, direction) {
    if (this._cooldown > 0) return;
    if (this._isReloading) return;
    if (this._ammo <= 0) {
      EventBus.emit('sound:play', { id: 'empty' });
      this._startReload();
      return;
    }

    // パワーアップに応じたクールダウン・ダメージ
    const cooldown = this._powerUp === 'rapid'
      ? Config.POWERUP.RAPID_COOLDOWN
      : Config.WEAPON.COOLDOWN;
    const damage = this._powerUp === 'power'
      ? Config.POWERUP.POWER_DAMAGE
      : 1;
    const color = BULLET_COLORS[this._powerUp] ?? BULLET_COLORS.default;

    this._cooldown = cooldown;
    this._ammo--;
    this._emitAmmo();

    // 弾切れになったら自動リロード
    if (this._ammo === 0) this._startReload();

    if (this._powerUp === 'shotgun') {
      // ショットガン: 複数方向に拡散
      const PELLETS = Config.POWERUP.SHOTGUN_PELLETS;
      const SPREAD  = Config.POWERUP.SHOTGUN_SPREAD;
      for (let i = 0; i < PELLETS; i++) {
        const spreadDir = direction.clone().add(
          new THREE.Vector3(
            (Math.random() - 0.5) * SPREAD * 2,
            (Math.random() - 0.5) * SPREAD,
            (Math.random() - 0.5) * SPREAD * 2,
          ),
        ).normalize();
        this._addBullet(position, spreadDir, damage, color);
      }
    } else {
      this._addBullet(position, direction, damage, color);
    }

    EventBus.emit('weapon:fired', { position: position.clone(), direction: direction.clone() });
    EventBus.emit('sound:play', { id: 'shoot' });
  }

  /**
   * 弾を1発シーンに追加する内部ヘルパー
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} direction
   * @param {number} damage
   * @param {number} color 弾の発光色 (BULLET_COLORS 参照)
   */
  _addBullet(position, direction, damage = 1, color = BULLET_COLORS.default) {
    const mesh     = this._createBulletMesh(color);
    const velocity = direction.clone().normalize().multiplyScalar(Config.WEAPON.BULLET_SPEED);
    mesh.position.copy(position);
    this.scene.add(mesh);

    // トレイル: 加算合成の魔力光跡(明るいコア + 薄いグロウ)
    const trailPos = new Float32Array(TRAIL_MAX * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setDrawRange(0, 0);
    const trailCore = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({
        color, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    const trailOuter = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({
        color, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    const trail = new THREE.Group();
    trail.add(trailCore, trailOuter);
    this.scene.add(trail);

    this._bullets.push({
      mesh, velocity, damage,
      lifetime: Config.WEAPON.BULLET_LIFETIME,
      active: true,
      trail, trailPos, trailLen: 0, trailGeo,
    });
  }

  /**
   * 弾マテリアルを色ごとにキャッシュして取得する(共有・再利用)
   * @param {number} color
   */
  _getBulletMaterials(color) {
    let mats = this._bulletMatCache.get(color);
    if (!mats) {
      mats = {
        // コア: 発光する魔力の芯
        core: new THREE.MeshPhongMaterial({
          color,
          emissive: new THREE.Color(color),
          emissiveIntensity: 1.2,
          shininess: 200,
        }),
        // グロウ: 加算合成の外殻でハロー効果を出す
        glow: new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      };
      this._bulletMatCache.set(color, mats);
    }
    return mats;
  }

  /**
   * 弾メッシュを生成する: マジックミサイル風の発光オーブ(コア+グロウシェル)
   * @param {number} color
   */
  _createBulletMesh(color) {
    const { core, glow } = this._getBulletMaterials(color);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(this._bulletCoreGeo, core));
    group.add(new THREE.Mesh(this._bulletGlowGeo, glow));
    return group;
  }

  /** トレイルをシーンから削除してリソースを解放する */
  _removeTrail(bullet) {
    if (!bullet.trail) return;
    this.scene.remove(bullet.trail);
    // trail は Group。ジオメトリは共有なので1回だけ dispose
    bullet.trailGeo?.dispose();
    bullet.trail.children.forEach((line) => line.material.dispose());
    bullet.trail = null;
    bullet.trailGeo = null;
  }
}
