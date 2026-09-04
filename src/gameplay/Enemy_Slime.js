/**
 * EnemySlime - 浮遊スライム敵
 * ============================================================
 * 目的:
 *   - 基本敵とは異なり、蛇行でプレイヤーの狙いを少し揺さぶる
 *   - 被弾時のリアクションを大きくして、撃った手応えを出す
 *   - プレイヤー直前では予告変形後に突進する
 *
 * 既存コードとの互換性:
 *   - EnemySpawner から渡される scene / spawnPosition / options を使用
 *   - Weapon が参照する position と hit() を維持
 *   - EnemySpawner が参照する isActive / update() / destroy() を維持
 *   - Config.js と EventBus.js の既存設定・イベントを使用
 *
 * 統合時の注意:
 *   - 現在の EnemySpawner.js は Enemy.js だけを生成しているため、
 *     このファイルを置くだけではゲーム内に出現しない
 *   - EventBus の payload は既存 Enemy.js と同じ形式か、統合担当が確認する
 * ============================================================
 */

import * as THREE from 'three';
import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

export class EnemySlime {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} spawnPosition
   * @param {{ hp?: number, speed?: number, wave?: number }} options
   */
  constructor(scene, spawnPosition, options = {}) {
    this.scene = scene;
    this.hp = options.hp ?? Config.ENEMY.BASE_HP;
    this.speed = (options.speed ?? Config.ENEMY.BASE_SPEED) * 0.85;
    this.wave = options.wave ?? 1;

    this.isActive = true;
    this.isDefeated = false;

    // 見た目の中心位置。上下の揺れを直接加算し続けないため、meshとは別に管理する。
    this._anchorPosition = spawnPosition.clone();

    // 個体ごとに動きのタイミングをずらす。
    this._age = 0;
    this._phase = Math.random() * Math.PI * 2;

    // 被弾リアクション。
    this._panicTimer = 0;
    this._panicSide = Math.random() < 0.5 ? -1 : 1;
    this._hitFlashTimer = 0;
    this._hitSquashTimer = 0;

    // 接近時の予告と突進。
    this._chargeState = 'normal'; // normal -> warning -> rushing
    this._chargeTimer = 0;

    // 毎フレームの一時オブジェクト生成を避ける。
    this._toPlayer = new THREE.Vector3();
    this._moveDirection = new THREE.Vector3();

    // GPUリソースの二重解放を防ぐ。
    this._isDisposed = false;

    this.mesh = this._createMesh();
    this.mesh.position.copy(spawnPosition);
    this.scene.add(this.mesh);
  }

  /**
   * 本体1 + 目2の合計3メッシュで構成する。
   * テクスチャは使わず、描画負荷とデータ容量を抑える。
   * @returns {THREE.Mesh}
   */
  _createMesh() {
    const bodyColor = new THREE.Color(0x35e3b4);

    this._baseEmissiveColor = bodyColor.clone().multiplyScalar(0.45);
    this._baseEmissiveIntensity = Math.min(
      0.65,
      0.35 + (this.wave - 1) * 0.02,
    );

    const bodyGeometry = new THREE.SphereGeometry(0.28, 12, 8);
    this._bodyMaterial = new THREE.MeshPhongMaterial({
      color: bodyColor,
      emissive: this._baseEmissiveColor,
      emissiveIntensity: this._baseEmissiveIntensity,
      shininess: 80,
      transparent: true,
      opacity: 0.9,
      depthWrite: true,
    });

    const body = new THREE.Mesh(bodyGeometry, this._bodyMaterial);
    body.scale.set(1.15, 0.8, 1.15);
    body.castShadow = true;
    body.userData.enemy = this;

    const eyeMaterial = new THREE.MeshPhongMaterial({
      color: 0x101820,
      shininess: 25,
    });

    // 左右非対称にして、動きがなくても少しコミカルに見せる。
    const leftEye = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 6, 4),
      eyeMaterial,
    );
    leftEye.position.set(-0.09, 0.04, 0.245);
    leftEye.userData.enemy = this;

    const rightEye = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 6, 4),
      eyeMaterial,
    );
    rightEye.position.set(0.085, 0.02, 0.25);
    rightEye.userData.enemy = this;

    body.add(leftEye, rightEye);
    return body;
  }

  /**
   * @param {number} delta - 前フレームからの経過時間（秒）
   * @param {THREE.Vector3} playerPosition
   */
  update(delta, playerPosition) {
    if (!this.isActive || this.isDefeated) return;

    this._age += delta;
    this._toPlayer.subVectors(playerPosition, this._anchorPosition);
    const distance = this._toPlayer.length();

    if (distance <= Config.ENEMY.REACH_RADIUS) {
      this._onReachPlayer();
      return;
    }

    this._updateChargeState(delta, distance);
    this._updateMovement(delta, distance);
    this._updateAppearance(delta);
  }

  /**
   * プレイヤーから1.5m以内で0.2秒の予告を入れ、その後は直進する。
   */
  _updateChargeState(delta, distance) {
    if (this._chargeState === 'normal' && distance <= 1.5) {
      this._chargeState = 'warning';
      this._chargeTimer = 0.2;
      return;
    }

    if (this._chargeState === 'warning') {
      this._chargeTimer -= delta;
      if (this._chargeTimer <= 0) {
        this._chargeState = 'rushing';
      }
    }
  }

  _updateMovement(delta, distance) {
    // 予告中はその場で縦に伸び、突進開始をプレイヤーへ知らせる。
    if (this._chargeState === 'warning' || distance <= 0.000001) return;

    this._toPlayer.multiplyScalar(1 / distance);
    this._moveDirection.copy(this._toPlayer);

    if (this._chargeState === 'normal') {
      // 進行方向と直角な水平ベクトルを加え、左右に蛇行させる。
      let wobble = Math.sin(this._age * 4 + this._phase) * 0.4;

      if (this._panicTimer > 0) {
        this._panicTimer = Math.max(0, this._panicTimer - delta);
        wobble += this._panicSide * 1.1;
      }

      const rightX = -this._toPlayer.z;
      const rightZ = this._toPlayer.x;
      const rightLength = Math.hypot(rightX, rightZ);

      if (rightLength > 0.000001) {
        this._moveDirection.x += (rightX / rightLength) * wobble;
        this._moveDirection.z += (rightZ / rightLength) * wobble;
        this._moveDirection.normalize();
      }
    }

    const speedMultiplier = this._chargeState === 'rushing' ? 1.3 : 1;
    this._anchorPosition.addScaledVector(
      this._moveDirection,
      this.speed * speedMultiplier * delta,
    );

    this.mesh.rotation.y = Math.atan2(
      this._moveDirection.x,
      this._moveDirection.z,
    );
  }

  _updateAppearance(delta) {
    let bounce = Math.sin(this._age * 6 + this._phase) * 0.07;
    let scaleX = 1.15;
    let scaleY = 0.8;
    let scaleZ = 1.15;

    if (this._chargeState === 'warning') {
      // 突進前の予告変形。
      const warningProgress = 1 - Math.max(0, this._chargeTimer) / 0.2;
      const stretch = Math.sin(warningProgress * Math.PI);
      scaleX -= stretch * 0.2;
      scaleY += stretch * 0.35;
      scaleZ -= stretch * 0.2;
      bounce = 0;
    } else {
      const squash = Math.sin(this._age * 6 + this._phase) * 0.07;
      scaleX += squash;
      scaleY -= squash * 0.7;
      scaleZ += squash;
    }

    if (this._hitSquashTimer > 0) {
      this._hitSquashTimer = Math.max(0, this._hitSquashTimer - delta);
      scaleX += 0.18;
      scaleY -= 0.22;
      scaleZ += 0.18;
    }

    this.mesh.position.copy(this._anchorPosition);
    this.mesh.position.y += bounce;
    this.mesh.scale.set(scaleX, scaleY, scaleZ);
    this.mesh.rotation.z =
      this._chargeState === 'rushing'
        ? 0
        : Math.sin(this._age * 4 + this._phase) * 0.1;

    if (this._hitFlashTimer > 0) {
      this._hitFlashTimer = Math.max(0, this._hitFlashTimer - delta);
      if (this._hitFlashTimer === 0) {
        this._bodyMaterial.emissive.copy(this._baseEmissiveColor);
        this._bodyMaterial.emissiveIntensity = this._baseEmissiveIntensity;
      }
    }
  }

  /**
   * @param {number} damage
   */
  hit(damage = 1) {
    if (!this.isActive || this.isDefeated) return;

    this.hp -= damage;

    this._panicTimer = 0.25;
    this._panicSide *= -1;
    this._hitFlashTimer = 0.1;
    this._hitSquashTimer = 0.12;

    this._bodyMaterial.emissive.set(0xffffff);
    this._bodyMaterial.emissiveIntensity = 1.8;

    EventBus.emit('enemy:hit', {
      enemy: this,
      hp: this.hp,
    });

    if (this.hp <= 0) {
      this._defeat();
    }
  }

  _defeat() {
    if (this.isDefeated) return;

    this.isDefeated = true;
    this.isActive = false;

    EventBus.emit('enemy:defeated', {
      enemy: this,
      score: Config.ENEMY.SCORE_PER_KILL,
    });

    this._disposeMesh();
  }

  _onReachPlayer() {
    if (!this.isActive || this.isDefeated) return;

    this.isActive = false;

    EventBus.emit('enemy:reached-player', {
      enemy: this,
      damage: Config.PLAYER.DAMAGE_PER_ENEMY,
    });

    this._disposeMesh();
  }

  /**
   * リセット時など、外部から強制破棄する。
   */
  destroy() {
    if (!this.isActive && this._isDisposed) return;

    this.isActive = false;
    this.isDefeated = true;
    this._disposeMesh();
  }

  /**
   * 本体だけでなく子メッシュのgeometry/materialも解放する。
   */
  _disposeMesh() {
    if (this._isDisposed) return;
    this._isDisposed = true;

    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }

    const geometries = new Set();
    const materials = new Set();

    this.mesh.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);

      if (Array.isArray(object.material)) {
        object.material.forEach((material) => materials.add(material));
      } else if (object.material) {
        materials.add(object.material);
      }
    });

    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }

  /**
   * Weapon.js の球形当たり判定が参照する位置。
   */
  get position() {
    return this.mesh.position;
  }
}
