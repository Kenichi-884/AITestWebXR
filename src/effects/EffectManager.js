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

    /**
     * アクティブなエフェクト一覧
     * @type {Array<{ mesh: THREE.Object3D, lifetime: number, maxLifetime: number, onUpdate: Function }>}
     */
    this._effects = [];

    EventBus.on('weapon:fired',   ({ position })       => this._spawnMuzzleFlash(position));
    EventBus.on('weapon:hit',     ({ enemy })           => this._spawnHitSpark(enemy.position));
    EventBus.on('enemy:defeated', ({ enemy })           => this._spawnDefeatBurst(enemy.position));
  }

  // ─── 毎フレーム処理 ─────────────────────────────────────────

  /** App.js から毎フレーム呼ばれる */
  update(delta) {
    for (const fx of this._effects) {
      fx.lifetime -= delta;
      const t = 1 - Math.max(0, fx.lifetime / fx.maxLifetime); // 0(開始)→1(終了)
      fx.onUpdate(t, fx.mesh, delta);
      if (fx.lifetime <= 0) this.scene.remove(fx.mesh);
    }
    this._effects = this._effects.filter((fx) => fx.lifetime > 0);
  }

  // ─── エフェクト生成 ──────────────────────────────────────────

  /**
   * マズルフラッシュ: 発射時に瞬間的な閃光を出す
   * ここの色・サイズ・時間を変えるだけで見た目が変わる
   * @param {THREE.Vector3} position
   */
  _spawnMuzzleFlash(position) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true }),
    );
    mesh.position.copy(position);

    const light = new THREE.PointLight(0xffaa00, 4.0, 2.0);
    mesh.add(light);
    this.scene.add(mesh);

    this._add(mesh, 0.07, (t, m) => {
      m.material.opacity = 1 - t;
      m.scale.setScalar(1 + t * 3);
    });
  }

  /**
   * ヒットスパーク: 弾が敵に命中したときの火花
   * count・velocityScale を変えると火花の量・広がりが変わる
   * @param {THREE.Vector3} position
   */
  _spawnHitSpark(position) {
    const COUNT          = 8;
    const VELOCITY_SCALE = 4;

    for (let i = 0; i < COUNT; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true }),
      );
      mesh.position.copy(position);
      this.scene.add(mesh);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * VELOCITY_SCALE,
        Math.random() * VELOCITY_SCALE,
        (Math.random() - 0.5) * VELOCITY_SCALE,
      );
      const lifetime = 0.25 + Math.random() * 0.2;
      this._add(mesh, lifetime, (t, m, dt) => {
        vel.y -= 9.8 * dt;
        m.position.addScaledVector(vel, dt);
        m.material.opacity = 1 - t;
      });
    }
  }

  /**
   * 撃破エフェクト: 敵を倒したときの破片爆発
   * COUNT・スケールを変えると迫力が変わる
   * @param {THREE.Vector3} position
   */
  _spawnDefeatBurst(position) {
    const COUNT = 12;

    for (let i = 0; i < COUNT; i++) {
      const hue  = Math.random();
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.05 + Math.random() * 0.07, 0),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(hue, 1, 0.6),
          transparent: true,
        }),
      );
      mesh.position.copy(position);
      this.scene.add(mesh);

      const vel  = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 5 + 1,
        (Math.random() - 0.5) * 6,
      );
      const spin = new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
      );
      const lifetime = 0.5 + Math.random() * 0.5;
      this._add(mesh, lifetime, (t, m, dt) => {
        vel.y -= 9.8 * dt;
        m.position.addScaledVector(vel, dt);
        m.rotation.x += spin.x * dt;
        m.rotation.y += spin.y * dt;
        m.material.opacity = 1 - t;
      });
    }
  }

  // ─── 内部ヘルパー ────────────────────────────────────────────

  _add(mesh, lifetime, onUpdate) {
    this._effects.push({ mesh, lifetime, maxLifetime: lifetime, onUpdate });
  }
}
