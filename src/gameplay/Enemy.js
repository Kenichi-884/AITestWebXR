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
    // 撃破時の吹き飛びアニメーション(ゲームループ管理)
    this._dying        = false;
    this._dyingElapsed = 0;
    this._dyingDur     = 0.45;
    this._dyingVel     = new THREE.Vector3();
    // スポーン時のスケールイン演出タイマー(秒)
    this._spawnTimer = 0.25;

    // フレームごとに再利用するVector3（GCを避けるためキャッシュ）
    this._direction = new THREE.Vector3();
    this._reachRadiusSq = Config.ENEMY.REACH_RADIUS * Config.ENEMY.REACH_RADIUS;

    this.mesh = this._createMesh();
    this.mesh.scale.setScalar(0.01); // スポーン演出: 小さい状態から始まる
    this.mesh.position.copy(spawnPosition);
    this.scene.add(this.mesh);
  }

  /**
   * 敵のメッシュを生成する
   * ウェーブ段階に応じてジオメトリが変化し、難易度を視覚的に伝える
   *   Wave 1-2: TetrahedronGeometry (4面体・小型・鋭角)
   *   Wave 3-4: OctahedronGeometry  (8面体・中型・標準)
   *   Wave 5+ : IcosahedronGeometry (20面体・大型・複雑)
   * @returns {THREE.Mesh}
   */
  _createMesh() {
    // ウェーブが進むごとに色相が変わる(難易度の視覚フィードバック)
    const hue = (this.wave * 0.15) % 1.0;
    const color = new THREE.Color().setHSL(hue, 1.0, 0.55);

    // ウェーブ段階に応じてジオメトリ・サイズを変える
    let geometry;
    if (this.wave <= 2) {
      geometry = new THREE.TetrahedronGeometry(0.22, 0);
    } else if (this.wave <= 4) {
      geometry = new THREE.OctahedronGeometry(0.25, 0);
    } else {
      geometry = new THREE.IcosahedronGeometry(0.28, 0);
    }

    // ソリッドマテリアル: 高光沢・強めの自発光でネオン感を出す
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.8,
      shininess: 150,
      specular: new THREE.Color(0xffffff),
      transparent: true,
      opacity: 0.88,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;

    // ワイヤーフレームオーバーレイ: サイバーパンク風の縁取り
    const wireMat = new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.45,
    });
    const wireMesh = new THREE.Mesh(geometry, wireMat);
    wireMesh.scale.setScalar(1.09); // 少し大きくしてソリッドからはみ出させる
    mesh.add(wireMesh);

    return mesh;
  }

  /**
   * 毎フレーム呼ばれる更新処理
   * @param {number} delta - 前フレームからの経過時間(秒)
   * @param {THREE.Vector3} playerPosition - プレイヤーの現在位置
   */
  update(delta, playerPosition) {
    // 撃破後の吹き飛びアニメーション(WebXR対応: ゲームループで処理)
    if (this._dying) {
      this._updateDying(delta);
      return;
    }
    if (!this.isActive || this.isDefeated) return;

    // ---- スポーンアニメーション: 0→1.1→1.0 のオーバーシュートスケール ----
    if (this._spawnTimer > 0) {
      this._spawnTimer -= delta;
      const t = 1 - Math.max(0, this._spawnTimer) / 0.25;
      // 0〜0.75で1.15まで拡大、0.75〜1.0で1.0に収束
      const s = t < 0.75 ? (t / 0.75) * 1.15 : 1.15 - ((t - 0.75) / 0.25) * 0.15;
      this.mesh.scale.setScalar(Math.max(0.01, s));
      if (this._spawnTimer <= 0) this.mesh.scale.setScalar(1);
    }

    // ---- 移動: プレイヤーに向かって直進 ----
    this._direction.subVectors(playerPosition, this.mesh.position).normalize();
    this.mesh.position.addScaledVector(this._direction, this.speed * delta);

    // ---- 回転演出 ----
    this.mesh.rotation.x += delta * 1.5;
    this.mesh.rotation.y += delta * 2.0;

    // ---- ヒットフラッシュ解除 ----
    if (this._hitFlashTimer > 0) {
      this._hitFlashTimer -= delta;
      if (this._hitFlashTimer <= 0) {
        this.mesh.material.emissiveIntensity = 0.8;
      }
    }

    // ---- プレイヤーへの到達判定 ----
    if (this.mesh.position.distanceToSquared(playerPosition) < this._reachRadiusSq) {
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
   * 撃破後の吹き飛びアニメーション (ゲームループから毎フレーム呼ばれる)
   * ※ WebXR では window.requestAnimationFrame が停止するため
   *    ゲームループ (EnemySpawner → Enemy.update) で処理する
   * @param {number} delta
   */
  _updateDying(delta) {
    this._dyingElapsed += delta;
    const t = Math.min(1, this._dyingElapsed / this._dyingDur);

    // 重力付き吹き飛び
    this._dyingVel.y -= 10 * delta;
    this.mesh.position.addScaledVector(this._dyingVel, delta);
    this.mesh.rotation.x += delta * 8;
    this.mesh.rotation.z += delta * 6;

    // フェードアウト (本体 + ワイヤーフレーム)
    const opacity = Math.max(0, 0.88 * (1 - t));
    this.mesh.material.opacity = opacity;
    const wire = this.mesh.children[0];
    if (wire?.material) wire.material.opacity = opacity * 0.5;

    if (t >= 1) {
      this._dying = false;
      if (this.mesh.parent) this.scene.remove(this.mesh);
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

    // 吹き飛び初期化 (アニメーション本体は _updateDying でゲームループ処理)
    this._dying        = true;
    this._dyingElapsed = 0;
    this._dyingVel.set(
      (Math.random() - 0.5) * 6,
      Math.random() * 4 + 2,
      (Math.random() - 0.5) * 6,
    );
    this.mesh.material.transparent = true;
    const wire = this.mesh.children[0];
    if (wire?.material) wire.material.transparent = true;
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
   * プール再利用: 位置・パラメータをリセットしてシーンに戻す
   * @param {THREE.Vector3} spawnPosition
   * @param {{ hp: number, speed: number, wave: number }} options
   */
  reset(spawnPosition, options = {}) {
    this.hp    = options.hp    ?? Config.ENEMY.BASE_HP;
    this.speed = options.speed ?? Config.ENEMY.BASE_SPEED;
    this.wave  = options.wave  ?? 1;
    this.isDefeated = false;
    this.isActive   = true;
    this._hitFlashTimer = 0;
    this._reachRadiusSq = Config.ENEMY.REACH_RADIUS * Config.ENEMY.REACH_RADIUS;

    this._dying        = false; // 吹き飛びアニメーションをキャンセル
    this._dyingElapsed = 0;
    this._spawnTimer   = 0.25; // スポーンアニメーションをリセット
    this.mesh.scale.setScalar(0.01);

    // ウェーブに応じた色を更新(ソリッド + ワイヤーフレーム両方)
    const hue = (this.wave * 0.15) % 1.0;
    const color = new THREE.Color().setHSL(hue, 1.0, 0.55);
    this.mesh.material.color.set(color);
    this.mesh.material.emissive.set(color);
    this.mesh.material.emissiveIntensity = 0.8;
    this.mesh.material.opacity = 0.88; // 透明度をリセット
    const wire = this.mesh.children[0];
    if (wire) {
      wire.material.color.set(color);
      wire.material.opacity = 0.45; // ワイヤーフレームの透明度もリセット
    }

    this.mesh.position.copy(spawnPosition);
    if (!this.mesh.parent) this.scene.add(this.mesh);
  }

  /**
   * 手動で敵を除去する(ゲームリセット時など)
   */
  destroy() {
    this._dying = false; // 吹き飛びアニメーションをキャンセル
    if (this.mesh.parent) this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    const wire = this.mesh.children[0];
    if (wire) wire.material.dispose(); // ジオメトリは共有なのでdisposeしない
    this.isActive = false;
    this.isDefeated = true;
  }
}
