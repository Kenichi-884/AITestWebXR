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
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

// ── 敵モデル ────────────────────────────────────────────────
/** 3Dモデルの場所。差し替えるときはここを変える */
const MODEL_URL = '/assets/enemy/monster.glb';
/** ゲーム内での敵の高さ(m)。大きすぎると当たり判定とズレるので注意 */
const MODEL_HEIGHT = 0.55;

/**
 * 自発光の強さ。
 * モデルはテクスチャを潰さないよう弱め、簡易図形はネオン感を出すため強めにする。
 * 個体ごとの基準値は mesh.userData.baseEmissive に持たせる。
 */
/**
 * 手続き的アニメーションの調整値。
 * ボーンを入れずに「生きている感じ」を出すためのパラメータ。
 * TODO: 動きが硬い/大げさすぎる場合はここの数値を変える
 */
const ANIM = {
  BOB_HEIGHT:     0.05,  // 歩行の上下動(m)
  BOB_SPEED:      7.0,   // 歩く速さ。移動速度に比例させる
  ROLL:           0.10,  // 左右の体重移動(ラジアン)
  LEAN:           0.13,  // 進行方向への前傾(ラジアン)
  SQUASH:         0.07,  // 着地時に潰れる量
  HIT_SQUASH:     0.30,  // 被弾時に潰れる量
  HIT_SQUASH_DUR: 0.18,  // 被弾の潰れが戻るまで(秒)
  HIT_KNOCKBACK:  0.14,  // 被弾時にのけぞって下がる距離(m)
  RAGE_RANGE:     2.0,   // この距離まで近づくと動きが激しくなる(m)
  RAGE_BOOST:     1.9,   // 接近時の激しさの倍率
};

const MODEL_EMISSIVE    = 0.15;
const FALLBACK_EMISSIVE = 0.8;
const HIT_EMISSIVE      = 1.2;

/**
 * 全個体で共有するモデルのテンプレート { geometry, material }。
 * ジオメトリは共有し、マテリアルだけ個体ごとに複製する。
 * (ヒット時の発光を個別に変えるためマテリアルは共有できない)
 * @type {{geometry: THREE.BufferGeometry, material: THREE.Material}|null}
 */
let _template = null;
let _loadPromise = null;

/**
 * 敵モデルを読み込んで共有テンプレートを作る。
 * 読み込みに失敗しても例外は投げず、簡易図形にフォールバックする。
 * @returns {Promise<object|null>}
 */
function loadEnemyModel() {
  if (_loadPromise) return _loadPromise;

  _loadPromise = new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    let source = null;
    gltf.scene.traverse((o) => { if (!source && o.isMesh) source = o; });
    if (!source) throw new Error('GLB内にメッシュが見つかりません');

    // GLB内の階層変換を焼き込んでから、ゲーム内のサイズに正規化する
    source.updateWorldMatrix(true, false);
    const geometry = source.geometry.clone();
    geometry.applyMatrix4(source.matrixWorld);

    geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    geometry.boundingBox.getSize(size);
    const scale = MODEL_HEIGHT / (size.y || 1);
    geometry.scale(scale, scale, scale);

    // 原点を中心に揃える。スポーン位置は空中なので、足元基準のままだと
    // 見た目と当たり判定の中心がズレる
    geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    geometry.boundingBox.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.computeBoundingSphere();

    _template = { geometry, material: source.material };
    return _template;
  }).catch((e) => {
    console.warn(
      `[Enemy] 敵モデルを読み込めませんでした: ${MODEL_URL}`, e,
      '\n簡易図形で代用します(ゲームは通常どおり動きます)。',
    );
    _template = null;
    return null;
  });

  return _loadPromise;
}

// 最初の敵が出る前に間に合わせるため、モジュール読み込み時に先読みを開始する
loadEnemyModel();

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

    // 手続き的アニメーション用の状態
    // 位相を個体ごとにずらさないと、全員が同じタイミングで跳ねて不自然になる
    this._animPhase      = Math.random() * Math.PI * 2;
    this._animTime       = 0;
    this._bobOffset      = 0;   // 今フレームの上下動。次フレームで打ち消す
    this._hitSquashTimer = 0;

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

    // モデルの読み込みが間に合っていればそれを使い、間に合わなければ簡易図形
    return _template ? this._createModelMesh(color) : this._createFallbackMesh(color);
  }

  /**
   * ウェーブに応じた見た目をマテリアルに反映する。
   * 生成時と reset() の両方から呼ぶので、ここだけ直せば両方に効く。
   * @param {THREE.Material} material
   * @param {THREE.Color} color
   * @param {boolean} isModel 3Dモデルかどうか
   */
  _applyWaveLook(material, color, isModel) {
    if (isModel) {
      // モデルは本来のテクスチャを活かしたいので、色は白のまま。
      // ウェーブの違いは自発光の色味だけで表現する。
      material.color.set(0xffffff);
      material.emissive.set(color);
      material.emissiveIntensity = MODEL_EMISSIVE;
      material.opacity = 1.0;
      material.userData.baseOpacity = 1.0;
    } else {
      material.color.set(color);
      material.emissive.set(color);
      material.emissiveIntensity = FALLBACK_EMISSIVE;
      material.opacity = 0.88;
      material.userData.baseOpacity = 0.88;
    }
  }

  /**
   * 3Dモデルから敵のメッシュを作る
   * ジオメトリは全個体で共有し、マテリアルだけ複製する
   * @param {THREE.Color} color ウェーブに応じた色
   */
  _createModelMesh(color) {
    const material = _template.material.clone();
    material.emissive = new THREE.Color(0x000000);   // _applyWaveLook で設定する
    material.transparent = true;                     // 撃破時のフェードアウトで使う
    this._applyWaveLook(material, color, true);

    const mesh = new THREE.Mesh(_template.geometry, material);
    mesh.castShadow = true;
    mesh.userData.baseEmissive = MODEL_EMISSIVE;
    mesh.userData.baseOpacity  = 1.0;
    // destroy() で共有ジオメトリを破棄しないための目印
    mesh.userData.sharedGeometry = true;
    // update() の回転処理を「回転」ではなく「プレイヤーを向く」に切り替えるための目印
    mesh.userData.isModel = true;
    return mesh;
  }

  /**
   * モデルが使えないときの簡易図形(従来の見た目)
   * @param {THREE.Color} color
   */
  _createFallbackMesh(color) {
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
      emissiveIntensity: FALLBACK_EMISSIVE,
      shininess: 150,
      specular: new THREE.Color(0xffffff),
      transparent: true,
      opacity: 0.88,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.userData.baseEmissive = FALLBACK_EMISSIVE;
    mesh.userData.baseOpacity  = 0.88;

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

    // 前フレームで足した上下動をいったん戻す。
    // 戻さずに毎フレーム足すと、敵がどんどん浮き上がってしまう
    this.mesh.position.y -= this._bobOffset;
    this._bobOffset = 0;

    // ---- 移動: プレイヤーに向かって直進 ----
    this._direction.subVectors(playerPosition, this.mesh.position).normalize();
    this.mesh.position.addScaledVector(this._direction, this.speed * delta);

    // ---- 回転演出 ----
    if (this.mesh.userData.isModel) {
      // モデルは回すと転がって見えるので、プレイヤーの方を向かせる。
      // 歩行の揺れは lookAt の後にローカル回転で足す(向きを崩さないため)
      this.mesh.lookAt(playerPosition);
      if (this._spawnTimer <= 0) this._applyWalkAnimation(delta, playerPosition);
    } else {
      this.mesh.rotation.x += delta * 1.5;
      this.mesh.rotation.y += delta * 2.0;
    }

    // ---- ヒットフラッシュ解除 ----
    if (this._hitFlashTimer > 0) {
      this._hitFlashTimer -= delta;
      if (this._hitFlashTimer <= 0) {
        this.mesh.material.emissiveIntensity = this.mesh.userData.baseEmissive ?? MODEL_EMISSIVE;
      }
    }

    // ---- プレイヤーへの到達判定 ----
    if (this.mesh.position.distanceToSquared(playerPosition) < this._reachRadiusSq) {
      this._onReachPlayer();
    }
  }

  /**
   * 歩行アニメーション(ボーンを使わない手続き的アニメーション)
   *
   * 上下動・左右の体重移動・前傾・潰れを重ねて「生きている」感じを出す。
   * ボーンが無くても歩いているように見せるのが狙い。
   * NOTE: lookAt() の直後に呼ぶこと。rotateX/Z はローカル回転なので
   *       lookAt で決まった向きを保ったまま傾きだけ足せる。
   *
   * @param {number} delta
   * @param {THREE.Vector3} playerPosition
   */
  _applyWalkAnimation(delta, playerPosition) {
    // プレイヤーに近いほど動きを激しくして、迫ってくる圧を出す
    const dist = this.mesh.position.distanceTo(playerPosition);
    const rage = dist < ANIM.RAGE_RANGE
      ? 1 + (1 - dist / ANIM.RAGE_RANGE) * (ANIM.RAGE_BOOST - 1)
      : 1;

    // 歩幅は移動速度に比例させる(速い敵ほど忙しく歩く)
    this._animTime += delta * ANIM.BOB_SPEED * this.speed * rage;
    const t = this._animTime + this._animPhase;

    // 上下動: abs(sin) にすると「左足・右足」の2拍子になる
    const step = Math.abs(Math.sin(t));
    this._bobOffset = step * ANIM.BOB_HEIGHT * rage;

    // 体重移動(左右の揺れ)と前傾
    this.mesh.rotateZ(Math.sin(t * 0.5) * ANIM.ROLL * rage);
    this.mesh.rotateX(ANIM.LEAN * rage);

    // 着地の瞬間に潰れる(スカッシュ&ストレッチ)
    let squash = (1 - step) * ANIM.SQUASH;

    // 被弾直後はさらに強く潰す
    if (this._hitSquashTimer > 0) {
      this._hitSquashTimer -= delta;
      squash += (Math.max(0, this._hitSquashTimer) / ANIM.HIT_SQUASH_DUR) * ANIM.HIT_SQUASH;
    }
    // 縦に潰れたぶん横に広がると、弾力があるように見える
    this.mesh.scale.set(1 + squash * 0.7, 1 - squash, 1 + squash * 0.7);

    this.mesh.position.y += this._bobOffset;
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
    this.mesh.material.emissiveIntensity = HIT_EMISSIVE;
    this._hitFlashTimer = 0.1;

    if (this.mesh.userData.isModel) {
      // 潰れてのけぞる。lookAt でプレイヤーを向いているので、
      // ローカル +Z がプレイヤーと反対方向になる
      this._hitSquashTimer = ANIM.HIT_SQUASH_DUR;
      this.mesh.translateZ(ANIM.HIT_KNOCKBACK);
    }

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
    // 通常時の不透明度から下げる。0.88固定だとモデル(1.0)が撃破の瞬間に
    // 急に薄くなってしまう
    const base = this.mesh.userData.baseOpacity ?? 0.88;
    const opacity = Math.max(0, base * (1 - t));
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
    // アニメーション状態も戻す。位相は引き直して個体差を保つ
    this._animPhase      = Math.random() * Math.PI * 2;
    this._animTime       = 0;
    this._bobOffset      = 0;
    this._hitSquashTimer = 0;
    this.mesh.scale.setScalar(0.01);

    // ウェーブに応じた色を更新(ソリッド + ワイヤーフレーム両方)
    const hue = (this.wave * 0.15) % 1.0;
    const color = new THREE.Color().setHSL(hue, 1.0, 0.55);
    this._applyWaveLook(this.mesh.material, color, !!this.mesh.userData.isModel);
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
    // モデルのジオメトリは全個体で共有しているので破棄してはいけない
    // (1体の撃破で他の敵のジオメトリまで壊れてしまう)
    if (!this.mesh.userData.sharedGeometry) this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    const wire = this.mesh.children[0];
    if (wire) wire.material.dispose(); // ジオメトリは共有なのでdisposeしない
    this.isActive = false;
    this.isDefeated = true;
  }
}
