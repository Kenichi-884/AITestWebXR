/**
 * Enemy - 敵1体の挙動・見た目・当たり判定
 * ============================================================
 * 担当: 敵挙動担当メンバー
 *
 * 作業ガイド:
 *   - createMesh() で見た目を変更できる(形・色・サイズ)
 *   - update() で動き方を変えられる(今は直線移動)
 *   - hit() でヒット時の演出を追加できる
 *   - Config.ENEMY の値でパラメータ調整
 *
 * このファイルで触るもの: このファイルのみ
 * このファイルで触らないもの: EventBus, Config(値は変更OK), App.js
 * ============================================================
 */

import * as THREE from 'three';
import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

export class Enemy {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} spawnPosition
   * @param {object} options
   * @param {number} options.hp
   * @param {number} options.speed
   * @param {number} options.wave
   */
  constructor(scene, spawnPosition, options = {}) {
    this.scene = scene;
    this.hp = options.hp ?? Config.ENEMY.BASE_HP;
    this.speed = options.speed ?? Config.ENEMY.BASE_SPEED;
    this.wave = options.wave ?? 1;

    this.isDefeated = false;
    this.isActive = true;

    // ヒット時のフラッシュ演出用タイマー
    this._hitFlashTimer = 0;

    this.mesh = this._createMesh();
    this.mesh.position.copy(spawnPosition);
    this.scene.add(this.mesh);
  }

  /**
   * 敵のメッシュを生成する
   * TODO: ここを変更して見た目をカスタマイズしよう
   *   - 形: BoxGeometry, ConeGeometry, OctahedronGeometry など
   *   - 色: MeshPhongMaterial の color プロパティ
   *   - サイズ: new THREE.SphereGeometry(半径, 分割数, 分割数)
   * @returns {THREE.Mesh}
   */
  _createMesh() {
    // ウェーブが進むごとに色が変わる(難易度の視覚フィードバック)
    const hue = (this.wave * 0.15) % 1.0;
    const color = new THREE.Color().setHSL(hue, 1.0, 0.5);

    const geometry = new THREE.OctahedronGeometry(0.25, 0);
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      shininess: 80,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;

    return mesh;
  }

  /**
   * 毎フレーム呼ばれる更新処理
   * @param {number} delta - 前フレームからの経過時間(秒)
   * @param {THREE.Vector3} playerPosition - プレイヤーの現在位置
   */
  update(delta, playerPosition) {
    if (!this.isActive || this.isDefeated) return;

    // ---- 移動: プレイヤーに向かって直進 ----
    const direction = new THREE.Vector3()
      .subVectors(playerPosition, this.mesh.position)
      .normalize();

    this.mesh.position.addScaledVector(direction, this.speed * delta);

    // ---- 回転演出 ----
    this.mesh.rotation.x += delta * 1.5;
    this.mesh.rotation.y += delta * 2.0;

    // ---- ヒットフラッシュ解除 ----
    if (this._hitFlashTimer > 0) {
      this._hitFlashTimer -= delta;
      if (this._hitFlashTimer <= 0) {
        this.mesh.material.emissiveIntensity = 0.3;
      }
    }

    // ---- プレイヤーへの到達判定 ----
    const distToPlayer = this.mesh.position.distanceTo(playerPosition);
    if (distToPlayer < Config.ENEMY.REACH_RADIUS) {
      this._onReachPlayer();
    }
  }

  /**
   * 弾に当たったときの処理
   * @param {number} damage - ダメージ量(デフォルト1)
   */
  hit(damage = 1) {
    if (!this.isActive || this.isDefeated) return;

    this.hp -= damage;
    EventBus.emit('sound:play', { id: 'hit' });

    // ヒットフラッシュ
    this.mesh.material.emissiveIntensity = 1.0;
    this._hitFlashTimer = 0.1;

    if (this.hp <= 0) {
      this._defeat();
    }
  }

  /**
   * 撃破時の処理
   */
  _defeat() {
    this.isDefeated = true;
    this.isActive = false;

    EventBus.emit('enemy:defeated', {
      enemy: this,
      score: Config.ENEMY.SCORE_PER_KILL * this.wave,
    });
    EventBus.emit('sound:play', { id: 'defeat' });

    // TODO: 撃破エフェクト(パーティクルなど)をここに追加できる

    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  /**
   * プレイヤーへの到達時の処理
   */
  _onReachPlayer() {
    this.isActive = false;
    this.scene.remove(this.mesh);

    EventBus.emit('enemy:reached-player', {
      enemy: this,
      damage: Config.PLAYER.DAMAGE_PER_ENEMY,
    });
    EventBus.emit('sound:play', { id: 'player-hit' });
  }

  /**
   * 敵の現在位置を返す
   * @returns {THREE.Vector3}
   */
  get position() {
    return this.mesh.position;
  }

  /**
   * 手動で敵を除去する(ゲームリセット時など)
   */
  destroy() {
    if (this.mesh.parent) this.scene.remove(this.mesh);
    this.isActive = false;
    this.isDefeated = true;
  }
}
