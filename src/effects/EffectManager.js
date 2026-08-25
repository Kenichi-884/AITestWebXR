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
 * このファイルで触るもの: このファイルのみ
 * ============================================================
 */

import * as THREE from 'three';
import EventBus from '../common/EventBus.js';

export class EffectManager {

  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;

    // 現在表示されているエフェクト
    this._effects = [];

    // 共有ジオメトリ（毎フレーム/毎エフェクトで生成するとGPUアップロードが走るためキャッシュ）
    this._geoFlash      = new THREE.SphereGeometry(0.08, 8, 8);
    this._geoHitRing    = new THREE.RingGeometry(0.04, 0.08, 32);
    this._geoBurst      = new THREE.SphereGeometry(0.18, 12, 12);
    this._geoShockwave  = new THREE.RingGeometry(0.12, 0.18, 32);
    this._geoSpark      = new THREE.SphereGeometry(0.015, 4, 4);   // 火花: スケールで大きさを変える
    this._geoFragment   = new THREE.OctahedronGeometry(0.05, 0);   // 破片: スケールで大きさを変える

    // ── Mesh プール（事前確保・visibility 切替で GC を回避）──────────
    // ※ _createPool は _add/_acquire より後に定義されているが、
    //   コンストラクタ内の呼び出し時点でクラスメソッドとして解決される
    this._pools = {
      // マズルフラッシュ用 (射撃: ~0.3s ごと、同時1本)
      muzzleSphere: this._createPool(this._geoFlash,     2,  { blending: THREE.AdditiveBlending, depthWrite: false }),
      muzzleRing:   this._createPool(this._geoHitRing,   2,  { side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      // ヒットスパーク用 (弾命中: 18火花 + flash + ring)
      flash:        this._createPool(this._geoFlash,     4,  { blending: THREE.AdditiveBlending, depthWrite: false }),
      spark:        this._createPool(this._geoSpark,     40, { blending: THREE.AdditiveBlending, depthWrite: false }),
      hitRing:      this._createPool(this._geoHitRing,   4,  { side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      // 撃破バースト用 (撃破: 20破片 + burst + shockwave)
      burst:        this._createPool(this._geoBurst,     4,  { blending: THREE.AdditiveBlending, depthWrite: false }),
      shockwave:    this._createPool(this._geoShockwave, 4,  { side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      fragment:     this._createPool(this._geoFragment,  40, { blending: THREE.AdditiveBlending, depthWrite: false }),
    };

    // ─────────────────────────────
    // イベントを受け取る
    // ─────────────────────────────

    // 銃を撃った
    EventBus.on('weapon:fired', ({ position }) => {
      this._spawnMuzzleFlash(position);
    });

    // 敵に弾が当たった
    EventBus.on('weapon:hit', ({ enemy }) => {
      this._spawnHitSpark(enemy.position);
    });

    // 敵を倒した
    EventBus.on('enemy:defeated', ({ enemy }) => {
      this._spawnDefeatBurst(enemy.position);
    });
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
          fx.mesh.visible = false; // プールに返却（scene.remove 不要）
        } else {
          this.scene.remove(fx.mesh); // 非プール（PointLight 等）は通常除去
        }
      }
    }
    this._effects = this._effects.filter((fx) => fx.lifetime > 0);
  }


  // ============================================================
  // 🔫 マズルフラッシュ (pool 利用)
  // ============================================================

  _spawnMuzzleFlash(position) {
    const sphere = this._acquire('muzzleSphere');
    if (sphere) {
      sphere.material.color.setHex(0xffee88);
      sphere.material.opacity = 1.0;
      sphere.position.copy(position);
      sphere.scale.setScalar(1.0);
      this._add(sphere, 0.10, (t, mesh) => {
        mesh.material.opacity = 1 - t;
        mesh.scale.setScalar(1 + t * 4);
      }, 'muzzleSphere');
    }

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
  // 💥 敵に弾が当たった
  // ============================================================

  _spawnHitSpark(position) {

    const COUNT = 18;

    const VELOCITY_SCALE = 7;


    // ----------------------------------------------------------
    // ① 命中した瞬間の白い光
    // ----------------------------------------------------------

    const flash = this._acquire('flash');
    if (flash) {
      flash.material.color.setHex(0xffffff);
      flash.material.opacity = 1.0;
      flash.position.copy(position);
      flash.scale.setScalar(1.0);
      this._add(flash, 0.12, (t, mesh) => {
        mesh.material.opacity = 1 - t;
        mesh.scale.setScalar(1 + t * 5);
      }, 'flash');
    }


    // ----------------------------------------------------------
    // ② 火花
    // ----------------------------------------------------------

    for (
      let i = 0;
      i < COUNT;
      i++
    ) {

      const sparkScale = 1 + Math.random();
      const mesh = this._acquire('spark');
      if (!mesh) continue;
      mesh.material.color.setHex(Math.random() > 0.3 ? 0xffcc00 : 0xff4400);
      mesh.material.opacity = 1.0;
      mesh.position.copy(position);
      mesh.scale.setScalar(sparkScale);


      const velocity =
        new THREE.Vector3(

          (Math.random() - 0.5)
            * VELOCITY_SCALE,

          Math.random()
            * VELOCITY_SCALE,

          (Math.random() - 0.5)
            * VELOCITY_SCALE
        );


      const lifetime =
        0.2 +
        Math.random() * 0.3;


      this._add(mesh, lifetime, (t, mesh, delta) => {
        velocity.y -= 7 * delta;
        mesh.position.addScaledVector(velocity, delta);
        mesh.material.opacity = 1 - t;
        mesh.scale.setScalar(sparkScale * (1 - t * 0.7));
      }, 'spark');
    }

    // ----------------------------------------------------------
    // ③ 衝撃波
    // ----------------------------------------------------------

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
  // ☠️ 敵を倒した
  // ============================================================

  _spawnDefeatBurst(position) {

    // ----------------------------------------------------------
    // ① 大きい爆発
    // ----------------------------------------------------------

    const burst = this._acquire('burst');
    if (burst) {
      burst.material.color.setHex(0xffffff);
      burst.material.opacity = 1.0;
      burst.position.copy(position);
      burst.scale.setScalar(1.0);
      this._add(burst, 0.25, (t, mesh) => {
        mesh.scale.setScalar(1 + t * 8);
        mesh.material.opacity = (1 - t) * (1 - t);
      }, 'burst');
    }


    // ----------------------------------------------------------
    // ② 衝撃波
    // ----------------------------------------------------------

    const shockwave = this._acquire('shockwave');
    if (shockwave) {
      shockwave.material.color.setHex(0xff6600);
      shockwave.material.opacity = 0.8;
      shockwave.position.copy(position);
      shockwave.rotation.x = Math.PI / 2;
      shockwave.scale.setScalar(1.0);
      this._add(shockwave, 0.4, (t, mesh) => {
        mesh.scale.setScalar(1 + t * 10);
        mesh.material.opacity = (1 - t) * 0.8;
      }, 'shockwave');
    }


    // ----------------------------------------------------------
    // ③ 飛び散る破片
    // ----------------------------------------------------------

    const COUNT = 20;


    for (
      let i = 0;
      i < COUNT;
      i++
    ) {

      const hue = Math.random();
      const fragScale = 0.8 + Math.random() * 1.2;

      const mesh = this._acquire('fragment');
      if (!mesh) continue;
      mesh.material.color.setHSL(hue, 1, 0.6);
      mesh.material.opacity = 1.0;
      mesh.position.copy(position);
      mesh.scale.setScalar(fragScale);

      const velocity =
        new THREE.Vector3(

          (Math.random() - 0.5)
            * 8,

          Math.random() * 6 + 1,

          (Math.random() - 0.5)
            * 8
        );


      const spin =
        new THREE.Vector3(

          (Math.random() - 0.5)
            * 15,

          (Math.random() - 0.5)
            * 15,

          (Math.random() - 0.5)
            * 15
        );


      const lifetime =
        0.5 +
        Math.random() * 0.5;


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
  // 内部処理
  // ============================================================

  /**
   * @param {THREE.Object3D} mesh
   * @param {number} lifetime
   * @param {Function} onUpdate
   * @param {string|null} poolName - プール名(nullなら通常の scene.remove)
   */
  _add(mesh, lifetime, onUpdate, poolName = null) {
    this._effects.push({ mesh, lifetime, maxLifetime: lifetime, onUpdate, poolName });
  }

  // ── プール管理 ────────────────────────────────────────────

  /**
   * 指定ジオメトリ・マテリアル設定で mesh を count 個プール生成しシーンに追加する
   * @param {THREE.BufferGeometry} geo
   * @param {number} count
   * @param {object} matOpts THREE.MeshBasicMaterial に渡すオプション
   * @returns {THREE.Mesh[]}
   */
  _createPool(geo, count, matOpts = {}) {
    return Array.from({ length: count }, () => {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, ...matOpts });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      return mesh;
    });
  }

  /**
   * プールから未使用メッシュを取り出す（visible=true にして返す）
   * 全て使用中のときは null を返す（エフェクトをスキップ）
   * @param {string} poolName
   * @returns {THREE.Mesh|null}
   */
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
