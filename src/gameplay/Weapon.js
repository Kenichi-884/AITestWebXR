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
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

const TRAIL_MAX = 16; // トレイルの最大点数

/** @typedef {{ mesh: THREE.Object3D, velocity: THREE.Vector3, lifetime: number, active: boolean, trail: THREE.Line, trailPos: Float32Array, trailLen: number }} Bullet */

export class Weapon {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Camera} camera
   */
  constructor(scene, renderer, camera) {
    this.scene    = scene;
    this.renderer = renderer;
    this.camera   = camera;

    /** @type {Bullet[]} */
    this._bullets = [];
    this._cooldown = 0;
    this._isActive = false;

    /** @type {THREE.BufferGeometry|null} */
    this._bulletGeo = null;
    /** @type {THREE.Material|null} */
    this._bulletMat = null;
    this._loadBulletModel();

    this._setupDesktopInput();
    this._setupXRInput();
  }

  // ─── ライフサイクル ───────────────────────────────────────

  start() {
    this._isActive = true;
    this._bullets  = [];
    this._cooldown = 0;
  }

  stop() {
    this._isActive = false;
  }

  reset() {
    for (const b of this._bullets) {
      if (b.mesh.parent) this.scene.remove(b.mesh);
      this._removeTrail(b);
    }
    this._bullets  = [];
    this._cooldown = 0;
    this._isActive = false;
  }

  // ─── 毎フレーム処理 ──────────────────────────────────────

  update(delta) {
    if (!this._isActive) return;

    if (this._cooldown > 0) this._cooldown -= delta;

    for (const bullet of this._bullets) {
      if (!bullet.active) continue;

      bullet.mesh.position.addScaledVector(bullet.velocity, delta);

      // トレイル: 先頭に現在位置を挿入、末尾を押し出す
      const tp = bullet.trailPos;
      for (let i = TRAIL_MAX - 1; i > 0; i--) {
        tp[i * 3]     = tp[(i - 1) * 3];
        tp[i * 3 + 1] = tp[(i - 1) * 3 + 1];
        tp[i * 3 + 2] = tp[(i - 1) * 3 + 2];
      }
      tp[0] = bullet.mesh.position.x;
      tp[1] = bullet.mesh.position.y;
      tp[2] = bullet.mesh.position.z;
      bullet.trailLen = Math.min(bullet.trailLen + 1, TRAIL_MAX);
      bullet.trailGeo.setDrawRange(0, bullet.trailLen);
      bullet.trailGeo.attributes.position.needsUpdate = true;

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
        const dist = bullet.mesh.position.distanceTo(enemy.position);
        if (dist < Config.ENEMY.HIT_RADIUS + Config.WEAPON.BULLET_RADIUS) {
          bullet.active = false;
          this.scene.remove(bullet.mesh);
          this._removeTrail(bullet);
          enemy.hit();
          EventBus.emit('weapon:hit', { bullet, enemy });
          break;
        }
      }
    }
  }

  cleanup() {
    this._bullets = this._bullets.filter((b) => b.active);
  }

  // ─── 弾モデルのロード ─────────────────────────────────────

  /**
   * 薬莢FBXを非同期ロードしてジオメトリ・マテリアルをキャッシュする
   * ロード完了後は _createBulletMesh() でFBXメッシュが使われる
   */
  async _loadBulletModel() {
    try {
      const model = await new Promise((resolve, reject) =>
        new FBXLoader().load('/assets/pistol/models/pistol-bullet-shell.fbx', resolve, undefined, reject),
      );

      let geo = null;
      model.traverse((child) => {
        if (child.isMesh && !geo) {
          geo = child.geometry;
          // FBX由来のマテリアルを確実に破棄
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => m?.dispose());
        }
      });
      if (!geo) throw new Error('No mesh in bullet FBX');

      // 真鍮/金色の薬莢マテリアル
      const mat = new THREE.MeshStandardMaterial({
        color: 0xc8930a,
        roughness: 0.25,
        metalness: 0.95,
        transparent: false,
        depthWrite: true,
      });
      const texLoader = new THREE.TextureLoader();
      texLoader.load('/assets/pistol/textures/pistol-bullet-tex.png', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex; mat.needsUpdate = true;
      });
      texLoader.load('/assets/pistol/textures/pistol-bullet-metallic.png', (tex) => {
        mat.metalnessMap = tex; mat.roughnessMap = tex; mat.needsUpdate = true;
      });

      this._bulletGeo = geo;
      this._bulletMat = mat;
      console.log('[Weapon] Bullet shell loaded.');
    } catch (e) {
      console.warn('[Weapon] Bullet shell load failed:', e);
    }
  }

  // ─── コントローラー入力 ──────────────────────────────────

  _setupXRInput() {
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      controller.addEventListener('selectstart', () => {
        if (!this._isActive) return;
        this._fireFromController(controller);
      });
    }
  }

  _fireFromController(controller) {
    if (this._cooldown > 0) return;
    const position  = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);
    controller.getWorldPosition(position);
    direction.applyQuaternion(controller.quaternion);
    this._spawnBullet(position, direction);
  }

  // ─── デスクトップ入力 ────────────────────────────────────

  _setupDesktopInput() {
    window.addEventListener('click', () => {
      if (!this._isActive) return;           // ゲームプレイ中のみ
      if (this.renderer.xr.isPresenting) return; // XR中はコントローラーで射撃

      const position  = new THREE.Vector3();
      const direction = new THREE.Vector3(0, 0, -1);
      this.camera.getWorldPosition(position);
      direction.applyQuaternion(this.camera.quaternion);
      this._spawnBullet(position, direction);
    });
  }

  // ─── 弾の生成 ────────────────────────────────────────────

  _spawnBullet(position, direction) {
    if (this._cooldown > 0) return;
    this._cooldown = Config.WEAPON.COOLDOWN;

    const mesh     = this._createBulletMesh();
    const velocity = direction.clone().normalize().multiplyScalar(Config.WEAPON.BULLET_SPEED);
    mesh.position.copy(position);
    this.scene.add(mesh);

    // トレイル: 明るいコアライン + 薄いアウターラインで輝き感を出す
    const trailPos = new Float32Array(TRAIL_MAX * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setDrawRange(0, 0);
    const trailCore = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.9 }),
    );
    // 同じジオメトリを共有するアウター（色違い・低opacity）
    const trailOuter = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.35 }),
    );
    const trail = new THREE.Group();
    trail.add(trailCore, trailOuter);
    this.scene.add(trail);

    this._bullets.push({
      mesh, velocity,
      lifetime: Config.WEAPON.BULLET_LIFETIME,
      active: true,
      trail, trailPos, trailLen: 0, trailGeo,
    });

    EventBus.emit('weapon:fired', { position: position.clone(), direction: direction.clone() });
    EventBus.emit('sound:play', { id: 'shoot' });
  }

  /**
   * 弾メッシュを生成する
   * FBX薬莢がロード済みであればそれを使用、未ロード時は黄金球にフォールバック
   */
  _createBulletMesh() {
    if (this._bulletGeo && this._bulletMat) {
      const mesh = new THREE.Mesh(this._bulletGeo, this._bulletMat);
      mesh.castShadow = false;
      // layout.json の weapon.scale (0.0002) と同じ倍率でピストルに揃える
      mesh.scale.setScalar(0.0002);
      return mesh;
    }

    // フォールバック: 金色の球
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xc8930a, roughness: 0.2, metalness: 0.9 }),
    );
    return mesh;
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
