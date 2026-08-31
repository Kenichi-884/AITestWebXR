/**
 * Enemy - 敵の共通ロジック(移動・HP・当たり判定・撃破処理)を持つ基底クラス
 * ============================================================
 * 担当: 敵挙動担当メンバー
 *
 * 見た目・敵タイプごとの挙動は、このクラスを継承したサブクラスで実装する。
 * (例: EnemyDrone.js ─ ドローン型の敵。銃口をプレイヤーへ向ける)
 * 敵タイプを追加するメンバーは、このファイルを直接編集せず、
 * 新しいサブクラスファイルを作って _createMesh() / _updateVisual() をオーバーライドすること。
 * これにより複数人が同時に別の敵タイプを作ってもファイルが競合しない。
 *
 * 作業ガイド:
 *   - _createMesh() で見た目を変更できる(デフォルトは発光する多面体)
 *   - _updateVisual() で見た目の更新(回転演出・照準など)を変えられる
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
    // ヒットフラッシュ・撃破処理で操作するマテリアル一覧
    // (サブクラスが複数メッシュ構成のモデルを使う場合も、ここに積めば共通処理が効く)
    this._materials = [];

    this.mesh = this._createMesh();
    this.mesh.position.copy(spawnPosition);
    this.scene.add(this.mesh);
  }

  /**
   * 敵のメッシュを生成する
   * デフォルトは発光する八面体。敵タイプ固有の見た目にしたい場合は
   * サブクラスでオーバーライドすること(_materials に使用マテリアルを積むこと)。
   * @returns {THREE.Object3D}
   */
  _createMesh() {
    const hue = (this.wave * 0.15) % 1.0;
    this._color = new THREE.Color().setHSL(hue, 1.0, 0.5);

    const geometry = new THREE.OctahedronGeometry(0.25, 0);
    const material = new THREE.MeshPhongMaterial({
      color: this._color,
      emissive: this._color,
      emissiveIntensity: 0.6,
      shininess: 80,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    this._materials.push(material);

    return mesh;
  }

  /**
   * 毎フレーム呼ばれる更新処理
   * @param {number} delta - 前フレームからの経過時間(秒)
   * @param {THREE.Vector3} playerPosition - プレイヤーの現在位置
   */
  update(delta, playerPosition) {
    if (!this.isActive || this.isDefeated) return;

    // ---- 移動(サブクラスでオーバーライド可能) ----
    this._updateMovement(delta, playerPosition);

    // ---- 見た目の更新(回転演出・照準など。サブクラスでオーバーライド可能) ----
    this._updateVisual(delta, playerPosition);

    // ---- ヒットフラッシュ解除 ----
    if (this._hitFlashTimer > 0) {
      this._hitFlashTimer -= delta;
      if (this._hitFlashTimer <= 0) {
        for (const mat of this._materials) mat.emissiveIntensity = 0.3;
      }
    }

    // ---- プレイヤーへの到達判定 ----
    const distToPlayer = this.mesh.position.distanceTo(playerPosition);
    if (distToPlayer < Config.ENEMY.REACH_RADIUS) {
      this._onReachPlayer();
    }
  }

  /**
   * 移動処理
   * デフォルトはプレイヤーに向かって直進。敵タイプ固有の動き方(接近せず一定距離で
   * 停止するなど)はサブクラスでオーバーライドすること。
   * @param {number} delta
   * @param {THREE.Vector3} playerPosition
   */
  _updateMovement(delta, playerPosition) {
    const direction = new THREE.Vector3()
      .subVectors(playerPosition, this.mesh.position)
      .normalize();

    this.mesh.position.addScaledVector(direction, this.speed * delta);
  }

  /**
   * 見た目の毎フレーム更新(回転演出・照準など)
   * デフォルトはくるくる回転。敵タイプ固有の挙動はサブクラスでオーバーライドすること。
   * @param {number} delta
   * @param {THREE.Vector3} playerPosition
   */
  _updateVisual(delta, playerPosition) {
    this.mesh.rotation.x += delta * 1.5;
    this.mesh.rotation.y += delta * 2.0;
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
    for (const mat of this._materials) mat.emissiveIntensity = 1.0;
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
    this._disposeMesh();
  }

  /**
   * プレイヤーへの到達時の処理
   */
  _onReachPlayer() {
    this.isActive = false;
    this.scene.remove(this.mesh);
    this._disposeMesh();

    EventBus.emit('enemy:reached-player', {
      enemy: this,
      damage: Config.PLAYER.DAMAGE_PER_ENEMY,
    });
    EventBus.emit('sound:play', { id: 'player-hit' });
  }

  /**
   * mesh配下の全ジオメトリ・マテリアルを破棄する
   */
  _disposeMesh() {
    this.mesh.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry.dispose();
      child.material.dispose();
    });
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
    this._disposeMesh();
    this.isActive = false;
    this.isDefeated = true;
  }
}
