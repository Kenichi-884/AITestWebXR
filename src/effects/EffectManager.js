/**
 * EffectManager - 視覚エフェクト管理
 * ============================================================
 * 担当: エフェクト担当メンバー
 *
 * 作業ガイド:
 *   - マズルフラッシュ → _spawnMuzzleFlash()
 *   - ヒットスパーク   → _spawnHitSpark()
 *   - 撃破エフェクト   → _spawnDefeatBurst()
 *   - 新エフェクト追加 → このファイルにメソッドを追加し
 *                        EventBus.on() で購読する
 *
 * テクスチャ:
 *   - _texSoftCircle : ソフトサークル (発光・パーティクル用)
 *   - _texSoftRing   : ソフトリング  (衝撃波・リング用)
 *   ※ Canvas APIでプロシージャル生成するため外部ファイル不要
 * ============================================================
 */

import * as THREE from 'three';
import EventBus from '../common/EventBus.js';

export class EffectManager {

  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this._effects = [];

    // ── プロシージャルテクスチャ ──────────────────────────────
    this._texSoftCircle = this._makeSoftCircleTex();
    this._texSoftRing   = this._makeSoftRingTex();

    // ── ジオメトリ ────────────────────────────────────────────
    // billboard パーティクル用の単位平面 (scale で大きさを制御)
    this._geoPlane     = new THREE.PlaneGeometry(1, 1);
    // リング・衝撃波: RingGeometry はそのまま維持
    this._geoHitRing   = new THREE.RingGeometry(0.04, 0.08, 32);
    this._geoShockwave = new THREE.RingGeometry(0.12, 0.18, 32);
    // 破片: 3D オブジェクトとして回転させるため OctahedronGeometry を維持
    this._geoFragment  = new THREE.OctahedronGeometry(0.05, 0);

    // ── Mesh プール ────────────────────────────────────────────
    // 第4引数 billboard=true にするとカメラに向く onBeforeRender を自動設定
    this._pools = {
      // マズルフラッシュ
      muzzleSphere: this._createPool(this._geoPlane,     2,  { map: this._texSoftCircle, blending: THREE.AdditiveBlending, depthWrite: false }, true),
      muzzleRing:   this._createPool(this._geoHitRing,   2,  { map: this._texSoftRing,   side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      // ヒットスパーク
      flash:        this._createPool(this._geoPlane,     4,  { map: this._texSoftCircle, blending: THREE.AdditiveBlending, depthWrite: false }, true),
      spark:        this._createPool(this._geoPlane,     40, { map: this._texSoftCircle, blending: THREE.AdditiveBlending, depthWrite: false }, true),
      hitRing:      this._createPool(this._geoHitRing,   4,  { map: this._texSoftRing,   side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      // 撃破バースト
      burst:        this._createPool(this._geoPlane,     4,  { map: this._texSoftCircle, blending: THREE.AdditiveBlending, depthWrite: false }, true),
      shockwave:    this._createPool(this._geoShockwave, 4,  { map: this._texSoftRing,   side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      fragment:     this._createPool(this._geoFragment,  40, { blending: THREE.AdditiveBlending, depthWrite: false }),
    };

    // ── EventBus ─────────────────────────────────────────────
    EventBus.on('weapon:fired',    ({ position }) => this._spawnMuzzleFlash(position));
    EventBus.on('weapon:hit',      ({ enemy })    => this._spawnHitSpark(enemy.position));
    EventBus.on('enemy:defeated',  ({ enemy })    => this._spawnDefeatBurst(enemy.position));
  }


  // ============================================================
  // 毎フレーム更新
  // ============================================================

  update(delta) {
    for (const fx of this._effects) {
      fx.lifetime -= delta;
      const t = 1 - Math.max(0, fx.lifetime / fx.maxLifetime);
      fx.onUpdate(t, fx.mesh, delta);
      if (fx.lifetime <= 0) {
        if (fx.poolName) {
          fx.mesh.visible = false;
        } else {
          this.scene.remove(fx.mesh);
        }
      }
    }
    this._effects = this._effects.filter((fx) => fx.lifetime > 0);
  }


  // ============================================================
  // 🔫 マズルフラッシュ
  // ============================================================

  _spawnMuzzleFlash(position) {
    // 発光球: ソフトサークルのビルボード
    const sphere = this._acquire('muzzleSphere');
    if (sphere) {
      sphere.material.color.setHex(0xffee88);
      sphere.material.opacity = 1.0;
      sphere.position.copy(position);
      sphere.scale.setScalar(0.16); // SphereGeometry(0.08) の直径相当
      this._add(sphere, 0.10, (t, mesh) => {
        mesh.material.opacity = 1 - t;
        mesh.scale.setScalar(0.16 * (1 + t * 4));
      }, 'muzzleSphere');
    }

    // エネルギーリング
    const ring = this._acquire('muzzleRing');
    if (ring) {
      ring.material.color.setHex(0xff8800);
      ring.material.opacity = 0.9;
      ring.position.copy(position);
      ring.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      ring.scale.setScalar(0.5);
      this._add(ring, 0.12, (t, mesh) => {
        mesh.material.opacity = (1 - t) * 0.9;
        mesh.scale.setScalar(0.5 + t * 5);
      }, 'muzzleRing');
    }
  }


  // ============================================================
  // 💥 命中エフェクト
  // ============================================================

  _spawnHitSpark(position) {
    // ① 白い閃光
    const flash = this._acquire('flash');
    if (flash) {
      flash.material.color.setHex(0xffffff);
      flash.material.opacity = 1.0;
      flash.position.copy(position);
      flash.scale.setScalar(0.16);
      this._add(flash, 0.12, (t, mesh) => {
        mesh.material.opacity = 1 - t;
        mesh.scale.setScalar(0.16 * (1 + t * 5));
      }, 'flash');
    }

    // ② 火花パーティクル (ソフトサークルのビルボード)
    const COUNT = 18;
    for (let i = 0; i < COUNT; i++) {
      const sparkScale = 0.03 * (1 + Math.random()); // 0.03〜0.06 m
      const mesh = this._acquire('spark');
      if (!mesh) continue;
      mesh.material.color.setHex(Math.random() > 0.3 ? 0xffcc00 : 0xff4400);
      mesh.material.opacity = 1.0;
      mesh.position.copy(position);
      mesh.scale.setScalar(sparkScale);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 7,
        Math.random() * 7,
        (Math.random() - 0.5) * 7,
      );
      const lifetime = 0.2 + Math.random() * 0.3;

      this._add(mesh, lifetime, (t, mesh, delta) => {
        velocity.y -= 7 * delta;
        mesh.position.addScaledVector(velocity, delta);
        mesh.material.opacity = 1 - t;
        mesh.scale.setScalar(sparkScale * (1 - t * 0.7));
      }, 'spark');
    }

    // ③ 衝撃波リング
    const ring = this._acquire('hitRing');
    if (ring) {
      ring.material.color.setHex(0xffaa00);
      ring.material.opacity = 0.8;
      ring.position.copy(position);
      ring.rotation.x = Math.PI / 2;
      ring.scale.setScalar(1.0);
      this._add(ring, 0.22, (t, mesh) => {
        mesh.scale.setScalar(1 + t * 5);
        mesh.material.opacity = (1 - t) * 0.8;
      }, 'hitRing');
    }
  }


  // ============================================================
  // ☠️ 撃破エフェクト
  // ============================================================

  _spawnDefeatBurst(position) {
    // ① 大爆発フラッシュ
    const burst = this._acquire('burst');
    if (burst) {
      burst.material.color.setHex(0xffffff);
      burst.material.opacity = 1.0;
      burst.position.copy(position);
      burst.scale.setScalar(0.36); // SphereGeometry(0.18) 直径相当
      this._add(burst, 0.30, (t, mesh) => {
        mesh.scale.setScalar(0.36 * (1 + t * 8));
        mesh.material.opacity = (1 - t) * (1 - t);
      }, 'burst');
    }

    // ② 中心グロー (オレンジ)
    const glow = this._acquire('flash');
    if (glow) {
      glow.material.color.setHex(0xff6600);
      glow.material.opacity = 0.9;
      glow.position.copy(position);
      glow.scale.setScalar(0.25);
      this._add(glow, 0.45, (t, mesh) => {
        mesh.scale.setScalar(0.25 * (1 + t * 5));
        mesh.material.opacity = (1 - t) * 0.9;
      }, 'flash');
    }

    // ③ 衝撃波
    const shockwave = this._acquire('shockwave');
    if (shockwave) {
      shockwave.material.color.setHex(0xff6600);
      shockwave.material.opacity = 0.8;
      shockwave.position.copy(position);
      shockwave.rotation.x = Math.PI / 2;
      shockwave.scale.setScalar(1.0);
      this._add(shockwave, 0.4, (t, mesh) => {
        mesh.scale.setScalar(1 + t * 12);
        mesh.material.opacity = (1 - t) * 0.8;
      }, 'shockwave');
    }

    // ④ 破片
    const COUNT = 20;
    for (let i = 0; i < COUNT; i++) {
      const hue = Math.random();
      const fragScale = 0.8 + Math.random() * 1.2;
      const mesh = this._acquire('fragment');
      if (!mesh) continue;
      mesh.material.color.setHSL(hue, 1, 0.7);
      mesh.material.opacity = 1.0;
      mesh.position.copy(position);
      mesh.scale.setScalar(fragScale);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 6 + 1,
        (Math.random() - 0.5) * 8,
      );
      const spin = new THREE.Vector3(
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
      );
      const lifetime = 0.5 + Math.random() * 0.5;

      this._add(mesh, lifetime, (t, mesh, delta) => {
        velocity.y -= 9.8 * delta;
        mesh.position.addScaledVector(velocity, delta);
        mesh.rotation.x += spin.x * delta;
        mesh.rotation.y += spin.y * delta;
        mesh.rotation.z += spin.z * delta;
        mesh.material.opacity = 1 - t;
      }, 'fragment');
    }
  }


  // ============================================================
  // テクスチャ生成
  // ============================================================

  /**
   * ソフトサークルテクスチャ: 中央が白く外側に向かって透明になる
   * 発光パーティクル・フラッシュ・バーストに使用
   */
  _makeSoftCircleTex() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    grad.addColorStop(0.0,  'rgba(255,255,255,1.0)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.65, 'rgba(255,255,255,0.3)');
    grad.addColorStop(1.0,  'rgba(255,255,255,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  /**
   * ソフトリングテクスチャ: RingGeometry の U方向(内→外)にグラデーション
   * 衝撃波・エネルギーリングに使用
   */
  _makeSoftRingTex() {
    const w = 64, h = 4;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0.00, 'rgba(255,255,255,0.0)');
    grad.addColorStop(0.30, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.70, 'rgba(255,255,255,1.0)');
    grad.addColorStop(1.00, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    return new THREE.CanvasTexture(canvas);
  }


  // ============================================================
  // 内部処理
  // ============================================================

  _add(mesh, lifetime, onUpdate, poolName = null) {
    this._effects.push({ mesh, lifetime, maxLifetime: lifetime, onUpdate, poolName });
  }

  /**
   * @param {THREE.BufferGeometry} geo
   * @param {number} count
   * @param {object} matOpts THREE.MeshBasicMaterial に渡すオプション
   * @param {boolean} billboard trueでカメラに常時向く (PlaneGeometry パーティクル用)
   */
  _createPool(geo, count, matOpts = {}, billboard = false) {
    return Array.from({ length: count }, () => {
      const mat  = new THREE.MeshBasicMaterial({ transparent: true, ...matOpts });
      const mesh = new THREE.Mesh(geo, mat);
      if (billboard) {
        // onBeforeRender でカメラの向きをコピー → 常にカメラを向く
        mesh.onBeforeRender = (renderer, scene, camera) => {
          mesh.quaternion.copy(camera.quaternion);
        };
      }
      mesh.visible = false;
      this.scene.add(mesh);
      return mesh;
    });
  }

  _acquire(poolName) {
    for (const mesh of this._pools[poolName]) {
      if (!mesh.visible) {
        mesh.visible = true;
        return mesh;
      }
    }
    return null;
  }
}
