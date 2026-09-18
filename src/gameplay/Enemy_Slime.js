/**
 * EnemySlime - 共鳴エネルギーをまとった浮遊スライム
 * ============================================================
 * ゲーム上の役割:
 *   - 蛇行で狙いを少し揺さぶる軽量な雑魚敵
 *   - 接近後は予告を出して突進する
 *   - 非致死の被弾で突進を中断できる
 *
 * 安定性の方針:
 *   - 物理演算、外部モデル、テクスチャ、分裂、飛び道具を使わない
 *   - 状態を approach / warning / charge / stagger の4つに限定
 *   - 1フレームのdeltaを制限し、処理落ち後のワープを抑える
 *   - 毎フレームVector3を生成せず、GPUリソースも確実に解放する
 *
 * 既存コードとの互換性:
 *   - EnemySpawner: scene / spawnPosition / options / isActive / update() / destroy()
 *   - Weapon: position / hit()
 *   - Config.js、EventBus.jsの既存設定・イベントを使用
 *
 * 統合時の注意:
 *   - EnemySpawner.js側でEnemySlimeを生成対象に追加する必要がある
 *   - EventBusのpayload形式は既存Enemy.jsと最終確認すること
 * ============================================================
 */

import * as THREE from 'three';
import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

const STATE = Object.freeze({
  APPROACH: 'approach',
  WARNING: 'warning',
  CHARGE: 'charge',
  STAGGER: 'stagger',
});

// この敵だけの調整値。まずはConfig.jsを変更せず、担当競合を避ける。
const SLIME = Object.freeze({
  SPEED_MULTIPLIER: 0.82,
  SWAY_STRENGTH: 0.32,
  SWAY_FREQUENCY: 3.2,
  FLOAT_AMPLITUDE: 0.06,
  FLOAT_FREQUENCY: 5.5,
  CHARGE_DISTANCE: 1.6,
  WARNING_DURATION: 0.45,
  CHARGE_SPEED_MULTIPLIER: 1.45,
  STAGGER_DURATION: 0.25,
  STAGGER_SPEED_MULTIPLIER: 0.7,
  CHARGE_COOLDOWN_AFTER_HIT: 0.7,
  HIT_FLASH_DURATION: 0.1,
  HIT_SQUASH_DURATION: 0.12,
  MAX_DELTA: 0.05,
});

export class EnemySlime {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} spawnPosition
   * @param {{ hp?: number, speed?: number, wave?: number }} options
   */
  constructor(scene, spawnPosition, options = {}) {
    this.scene = scene;
    this.hp = options.hp ?? Config.ENEMY.BASE_HP;
    this.speed =
      (options.speed ?? Config.ENEMY.BASE_SPEED) * SLIME.SPEED_MULTIPLIER;
    this.wave = options.wave ?? 1;

    this.isActive = true;
    this.isDefeated = false;
    this._anchorPosition = spawnPosition.clone();
    this._lastPlayerPosition = new THREE.Vector3();
    this._hasPlayerPosition = false;
    this._age = 0;
    this._phase = Math.random() * Math.PI * 2;
    this._state = STATE.APPROACH;
    this._stateTimer = 0;
    this._chargeCooldown = 0;
    this._hitFlashTimer = 0;
    this._hitSquashTimer = 0;
    this._staggerSide = Math.random() < 0.5 ? -1 : 1;
    this._toPlayer = new THREE.Vector3();
    this._moveDirection = new THREE.Vector3();
    this._staggerDirection = new THREE.Vector3(1, 0, 0);
    this._isDisposed = false;

    this.mesh = this._createMesh();
    this.mesh.position.copy(spawnPosition);
    this.scene.add(this.mesh);
  }

  /**
   * 本体 + 発光コア + 共鳴リングの3メッシュ。
   * 外部アセットなしで、ファンタジー寄りの見た目にする。
   */
  _createMesh() {
    const bodyColor = new THREE.Color(0x36cfc1);
    this._baseEmissiveColor = bodyColor.clone().multiplyScalar(0.4);
    this._baseEmissiveIntensity = Math.min(
      0.65,
      0.32 + (this.wave - 1) * 0.02,
    );

    const bodyGeometry = new THREE.SphereGeometry(0.28, 12, 8);
    this._bodyMaterial = new THREE.MeshPhongMaterial({
      color: bodyColor,
      emissive: this._baseEmissiveColor,
      emissiveIntensity: this._baseEmissiveIntensity,
      shininess: 90,
    });

    const body = new THREE.Mesh(bodyGeometry, this._bodyMaterial);
    body.scale.set(1.12, 0.82, 1.12);
    body.castShadow = true;
    body.userData.enemy = this;

    this._coreMaterial = new THREE.MeshBasicMaterial({ color: 0xcffffa });
    this._core = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 8, 6),
      this._coreMaterial,
    );
    this._core.position.set(0, 0.015, 0.27);
    this._core.userData.enemy = this;

    this._ringMaterial = new THREE.MeshBasicMaterial({ color: 0x73f7ff });
    this._ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.014, 4, 12),
      this._ringMaterial,
    );
    this._ring.rotation.x = 0.2;
    this._ring.userData.enemy = this;

    body.add(this._core, this._ring);
    return body;
  }

  update(delta, playerPosition) {
    if (!this.isActive || this.isDefeated) return;

    const safeDelta = Math.min(Math.max(delta, 0), SLIME.MAX_DELTA);
    if (safeDelta === 0) return;

    this._age += safeDelta;
    this._chargeCooldown = Math.max(0, this._chargeCooldown - safeDelta);
    this._lastPlayerPosition.copy(playerPosition);
    this._hasPlayerPosition = true;

    this._toPlayer.subVectors(playerPosition, this._anchorPosition);
    const distance = this._toPlayer.length();

    if (distance <= Config.ENEMY.REACH_RADIUS) {
      this._onReachPlayer();
      return;
    }

    this._updateState(safeDelta, distance);
    this._updateMovement(safeDelta, distance);

    if (
      this._anchorPosition.distanceToSquared(playerPosition) <=
      Config.ENEMY.REACH_RADIUS * Config.ENEMY.REACH_RADIUS
    ) {
      this._onReachPlayer();
      return;
    }

    this._updateAppearance(safeDelta);
  }

  _updateState(delta, distance) {
    if (this._state === STATE.APPROACH) {
      if (
        this._chargeCooldown === 0 &&
        distance <= SLIME.CHARGE_DISTANCE
      ) {
        this._state = STATE.WARNING;
        this._stateTimer = SLIME.WARNING_DURATION;
      }
      return;
    }

    if (this._state === STATE.WARNING) {
      this._stateTimer = Math.max(0, this._stateTimer - delta);
      if (this._stateTimer === 0) this._state = STATE.CHARGE;
      return;
    }

    if (this._state === STATE.STAGGER) {
      this._stateTimer = Math.max(0, this._stateTimer - delta);
      if (this._stateTimer === 0) this._state = STATE.APPROACH;
    }
  }

  _updateMovement(delta, distance) {
    if (this._state === STATE.WARNING || distance <= 0.000001) return;

    let speedMultiplier = 1;

    if (this._state === STATE.STAGGER) {
      this._moveDirection.copy(this._staggerDirection);
      speedMultiplier = SLIME.STAGGER_SPEED_MULTIPLIER;
    } else {
      this._toPlayer.multiplyScalar(1 / distance);
      this._moveDirection.copy(this._toPlayer);

      if (this._state === STATE.APPROACH) {
        const sway =
          Math.sin(this._age * SLIME.SWAY_FREQUENCY + this._phase) *
          SLIME.SWAY_STRENGTH;
        const rightX = -this._toPlayer.z;
        const rightZ = this._toPlayer.x;
        const rightLength = Math.hypot(rightX, rightZ);

        if (rightLength > 0.000001) {
          this._moveDirection.x += (rightX / rightLength) * sway;
          this._moveDirection.z += (rightZ / rightLength) * sway;
          this._moveDirection.normalize();
        }
      } else if (this._state === STATE.CHARGE) {
        speedMultiplier = SLIME.CHARGE_SPEED_MULTIPLIER;
      }
    }

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
    let bounce =
      Math.sin(this._age * SLIME.FLOAT_FREQUENCY + this._phase) *
      SLIME.FLOAT_AMPLITUDE;
    let scaleX = 1.12;
    let scaleY = 0.82;
    let scaleZ = 1.12;

    const squash =
      Math.sin(this._age * SLIME.FLOAT_FREQUENCY + this._phase) * 0.06;
    scaleX += squash;
    scaleY -= squash * 0.7;
    scaleZ += squash;

    if (this._state === STATE.WARNING) {
      const progress = 1 - this._stateTimer / SLIME.WARNING_DURATION;
      const stretch = Math.sin(progress * Math.PI);
      scaleX -= stretch * 0.18;
      scaleY += stretch * 0.32;
      scaleZ -= stretch * 0.18;
      bounce = 0;
      this._ringMaterial.color.set(0xffb34d);
    } else if (this._state === STATE.CHARGE) {
      scaleX = 0.96;
      scaleY = 0.74;
      scaleZ = 1.35;
      this._ringMaterial.color.set(0xff5f8f);
    } else if (this._state === STATE.STAGGER) {
      scaleX += 0.16;
      scaleY -= 0.18;
      this._ringMaterial.color.set(0xffffff);
    } else {
      this._ringMaterial.color.set(0x73f7ff);
    }

    if (this._hitSquashTimer > 0) {
      this._hitSquashTimer = Math.max(0, this._hitSquashTimer - delta);
      scaleX += 0.12;
      scaleY -= 0.15;
    }

    this.mesh.position.copy(this._anchorPosition);
    this.mesh.position.y += bounce;
    this.mesh.scale.set(scaleX, scaleY, scaleZ);
    this.mesh.rotation.z =
      this._state === STATE.CHARGE
        ? 0
        : Math.sin(this._age * 3.5 + this._phase) * 0.08;

    const ringSpeed =
      this._state === STATE.WARNING
        ? 6
        : this._state === STATE.CHARGE
          ? 8
          : 1.5;
    this._ring.rotation.z += ringSpeed * delta;
    this._core.scale.setScalar(1 + Math.sin(this._age * 7) * 0.12);

    if (this._hitFlashTimer > 0) {
      this._hitFlashTimer = Math.max(0, this._hitFlashTimer - delta);
      if (this._hitFlashTimer === 0) {
        this._bodyMaterial.emissive.copy(this._baseEmissiveColor);
        this._bodyMaterial.emissiveIntensity = this._baseEmissiveIntensity;
        this._coreMaterial.color.set(0xcffffa);
      }
    }
  }

  hit(damage = 1) {
    if (!this.isActive || this.isDefeated) return;

    this.hp -= damage;
    EventBus.emit('enemy:hit', { enemy: this, hp: this.hp });

    if (this.hp <= 0) {
      this._defeat();
      return;
    }

    this._state = STATE.STAGGER;
    this._stateTimer = SLIME.STAGGER_DURATION;
    this._chargeCooldown = SLIME.CHARGE_COOLDOWN_AFTER_HIT;
    this._hitFlashTimer = SLIME.HIT_FLASH_DURATION;
    this._hitSquashTimer = SLIME.HIT_SQUASH_DURATION;
    this._staggerSide *= -1;
    this._calculateStaggerDirection();

    this._bodyMaterial.emissive.set(0xffffff);
    this._bodyMaterial.emissiveIntensity = 1.8;
    this._coreMaterial.color.set(0xffffff);
  }

  _calculateStaggerDirection() {
    if (!this._hasPlayerPosition) {
      this._staggerDirection.set(this._staggerSide, 0, 0);
      return;
    }

    this._toPlayer.subVectors(
      this._lastPlayerPosition,
      this._anchorPosition,
    );

    if (this._toPlayer.lengthSq() <= 0.000001) {
      this._staggerDirection.set(this._staggerSide, 0, 0);
      return;
    }

    this._toPlayer.normalize();
    const rightX = -this._toPlayer.z;
    const rightZ = this._toPlayer.x;
    this._staggerDirection.set(
      -this._toPlayer.x + rightX * this._staggerSide * 0.8,
      -this._toPlayer.y * 0.2,
      -this._toPlayer.z + rightZ * this._staggerSide * 0.8,
    );
    this._staggerDirection.normalize();
  }

  _defeat() {
    if (this.isDefeated) return;
    this.isDefeated = true;
    this.isActive = false;
    EventBus.emit('enemy:defeated', {
      enemy: this,
      score: Config.ENEMY.SCORE_PER_KILL,
    });
    EventBus.emit('sound:play', { id: 'slime-defeat' });
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

  destroy() {
    if (!this.isActive && this._isDisposed) return;
    this.isActive = false;
    this.isDefeated = true;
    this._disposeMesh();
  }

  _disposeMesh() {
    if (this._isDisposed) return;
    this._isDisposed = true;

    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);

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

  get position() {
    return this.mesh.position;
  }
}
