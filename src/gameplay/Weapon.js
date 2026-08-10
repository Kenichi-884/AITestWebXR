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

/** @typedef {{ mesh: THREE.Object3D, velocity: THREE.Vector3, lifetime: number, active: boolean }} Bullet */

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

    // 薬莢モデルの共有ジオメトリ・マテリアル(非同期ロード)
    this._bulletGeo = null;
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
    }
    this._bullets  = [];
    this._cooldown = 0;
    this._isActive = false;
  }

  // ─── 毎フレーム処理 ──────────────────────────────────────

  update(delta) {
    if (!this._isActive) return;

    if (this._cooldown > 0) this._cooldown -= delta;

    // 弾の移動・寿命
    for (const bullet of this._bullets) {
      if (!bullet.active) continue;
      bullet.mesh.position.addScaledVector(bullet.velocity, delta);

      // 弾を進行方向に向ける
      bullet.mesh.lookAt(
        bullet.mesh.position.clone().add(bullet.velocity),
      );

      bullet.lifetime -= delta;
      if (bullet.lifetime <= 0) {
        bullet.active = false;
        this.scene.remove(bullet.mesh);
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
   * ロードが完了すると以降の弾がモデルを使用する
   * ロード失敗時は黄色い球のフォールバックを使用
   */
  async _loadBulletModel() {
    const modelUrl   = '/assets/pistol/models/pistol-bullet-shell.fbx';
    const diffuseUrl = '/assets/pistol/textures/pistol-bullet-tex.png';
    const metalUrl   = '/assets/pistol/textures/pistol-bullet-metallic.png';

    try {
      const model = await new Promise((resolve, reject) =>
        new FBXLoader().load(modelUrl, resolve, undefined, reject),
      );

      // 最初のメッシュからジオメトリを取得
      let geo = null;
      model.traverse((child) => {
        if (child.isMesh && !geo) {
          geo = child.geometry;
          // FBX由来の元マテリアルを破棄（透明/黒になることがある）
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => m.dispose());
          }
        }
      });
      if (!geo) throw new Error('No mesh found in bullet FBX');

      const mat = new THREE.MeshStandardMaterial({
        color: 0xc8a000,
        roughness: 0.3,
        metalness: 0.9,
        transparent: false,
        opacity: 1,
        depthWrite: true,
      });

      const texLoader = new THREE.TextureLoader();
      texLoader.load(diffuseUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.needsUpdate = true;
      });
      texLoader.load(metalUrl, (tex) => {
        mat.metalnessMap = tex;
        mat.roughnessMap = tex;
        mat.needsUpdate = true;
      });

      this._bulletGeo = geo;
      this._bulletMat = mat;
      console.log('[Weapon] Bullet shell model loaded.');
    } catch (e) {
      console.warn('[Weapon] Bullet shell load failed, using sphere fallback:', e);
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

    this._bullets.push({ mesh, velocity, lifetime: Config.WEAPON.BULLET_LIFETIME, active: true });

    EventBus.emit('weapon:fired', { position: position.clone(), direction: direction.clone() });
    EventBus.emit('sound:play', { id: 'shoot' });
  }

  /**
   * 弾メッシュを生成する
   * 薬莢FBXがロード済みならそれを使用、未ロード時は黄球にフォールバック
   */
  _createBulletMesh() {
    if (this._bulletGeo && this._bulletMat) {
      const mesh = new THREE.Mesh(this._bulletGeo, this._bulletMat);
      // FBX(Unity cm単位)なのでスケールを合わせる (0.003 ≈ 視認しやすいサイズ)
      mesh.scale.setScalar(0.003);
      return mesh;
    }

    // フォールバック: 黄色い球
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(Config.WEAPON.BULLET_RADIUS, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffdd00 }),
    );
    mesh.add(new THREE.PointLight(0xffdd00, 0.8, 1.0));
    return mesh;
  }
}
