/**
 * EnemyDrone - ドローン型の敵
 * ============================================================
 * 担当: ドローン敵担当メンバー
 *
 * Enemy(基底クラス)を継承し、見た目をドローンGLBモデルに差し替え、
 * 銃口(双子のバレル)が常にプレイヤーを向くようにしている。
 * プレイヤーには突撃せず、STANDOFF_RADIUSまで近づくと停止して弾を撃ち込む
 * (命中時は 'enemy:projectile-hit' イベントでダメージを通知。App.jsが購読して処理する)。
 * 停止中は左右・上下に自由な揺れを重ねて飛び回る(_applyFlightWobble())。
 * 敵はプール方式で再利用されるため、ウェーブ色の再着色はせず(GLB本来の色を保つ)、
 * 発射管理・弾のクリアは _onReset() / _defeat() / _onReachPlayer() で行う。
 * 他の敵タイプを追加する場合は、このファイルではなく新しいサブクラスファイルを作ること。
 *
 * このファイルで触るもの: このファイルのみ
 * このファイルで触らないもの: EventBus, Config(値は変更OK)
 * (移動処理・プール再利用フックのため Enemy.js に _updateMovement()/_onReset() フックを追加し、
 *  App.js に 'enemy:projectile-hit' の購読を追加している)
 * ============================================================
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Enemy } from './Enemy.js';
import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

const DRONE_MODEL_PATH = '/assets/drone/models/futuristic_armored_drone.glb';
// GLB頂点データ解析の結果、銃口(バレル先端)はモデルローカル座標で -X 方向を向いていることが判明。
// Object3D.lookAt() はローカル -Z を基準に対象を向くため、Y軸-90度で補正して -X を -Z に合わせる。
const DRONE_AIM_CORRECTION_Y = -Math.PI / 2;
// モデルの全長(ローカル単位 約30)を実寸換算(約0.6m)するためのスケール
const DRONE_SCALE = 0.02;

// 敵弾の見た目色(ウェーブ色に依存しない固定の「危険色」にして視認性を確保)
const PROJECTILE_COLOR = 0xff3344;

// 飛行の揺れ: 主要な揺れに、周波数の異なる副次的な揺れを重ねてリサージュ曲線的な軌道にすることで
// 単純な正弦波の左右移動よりも直線的でない自由な飛び方(斜め・不規則な動き)に見せる。
const WOBBLE_SECONDARY_AMPLITUDE_RATIO = 0.4; // 副次的な揺れの振幅比率(主要振幅に対して)
const WOBBLE_SECONDARY_FREQ_MIN = 1.6;        // 副次的な揺れの周波数比率(主要角速度に対して)の範囲
const WOBBLE_SECONDARY_FREQ_MAX = 2.4;

// 敵1体ごとにロードし直すと重いため、モデルは1度だけ読み込んでテンプレートとして共有し、
// スポーン時は clone() する。
const _droneModelPromise = new GLTFLoader().loadAsync(DRONE_MODEL_PATH)
  .then((gltf) => gltf.scene)
  .catch((e) => {
    console.warn('[EnemyDrone] Drone model load failed, falling back to placeholder shape:', e);
    return null;
  });

export class EnemyDrone extends Enemy {
  /**
   * 読み込み完了までは基底クラスのプレースホルダー(発光する多面体)を表示し、
   * 読み込み完了後にドローンモデルへ差し替える。
   * @returns {THREE.Group}
   */
  _createMesh() {
    // ピボット: このGroupのローカル -Z が「銃口が向くべき方向」。_updateVisual()で毎フレームlookAt()する。
    const pivot = new THREE.Group();

    this._placeholder = super._createMesh();
    pivot.add(this._placeholder);

    this._projectiles = [];
    this._resetFlightState();

    _droneModelPromise.then((template) => this._onModelLoaded(template, pivot));

    return pivot;
  }

  /**
   * 射撃タイマー・飛行の揺れの位相をランダムに初期化する。
   * 初回生成時(_createMesh)・プール再利用時(_onReset)の両方から呼ぶ。
   */
  _resetFlightState() {
    // 初弾のタイミングをばらけさせて全ドローンが同時に撃たないようにする
    this._fireTimer = Config.DRONE.FIRE_INTERVAL * (0.5 + Math.random() * 0.5);

    // 左右・上下それぞれに主+副の周波数/位相をドローンごとにランダム化し、
    // 直線的でない自由な飛び方(斜め移動含む)を演出する。
    this._wobbleTime = 0;
    this._wobble = {
      rightPhase1: Math.random() * Math.PI * 2,
      rightPhase2: Math.random() * Math.PI * 2,
      rightFreqRatio: WOBBLE_SECONDARY_FREQ_MIN + Math.random() * (WOBBLE_SECONDARY_FREQ_MAX - WOBBLE_SECONDARY_FREQ_MIN),
      upPhase1: Math.random() * Math.PI * 2,
      upPhase2: Math.random() * Math.PI * 2,
      upFreqRatio: WOBBLE_SECONDARY_FREQ_MIN + Math.random() * (WOBBLE_SECONDARY_FREQ_MAX - WOBBLE_SECONDARY_FREQ_MIN),
    };
  }

  /**
   * ドローンモデルの読み込み完了時にプレースホルダーと差し替える
   * @param {THREE.Object3D|null} template
   * @param {THREE.Group} pivot
   */
  _onModelLoaded(template, pivot) {
    if (!template) return;

    pivot.remove(this._placeholder);
    this._placeholder.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry.dispose();
      child.material.dispose();
    });
    this._placeholder = null;
    this._materials = [];
    this._wireMaterials = [];

    const model = template.clone(true);
    model.rotation.y = DRONE_AIM_CORRECTION_Y;
    model.scale.setScalar(DRONE_SCALE);
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      // モデル本来の色・テクスチャをそのまま使う(ウェーブ色のエミッシブ着色はしない)
      child.material = child.material.clone();
      this._trackMaterial(child.material);
    });

    pivot.add(model);
  }

  /**
   * プレイヤーに突撃せず、一定距離(STANDOFF_RADIUS)まで近づいたら停止する。
   * 以降は _updateShooting() による銃撃でプレイヤーを削る。
   * 直進だけだと単調なため、左右・上下に自由に飛び回る揺れを重ねる(_applyFlightWobble())。
   * @param {number} delta
   * @param {THREE.Vector3} playerPosition
   */
  _updateMovement(delta, playerPosition) {
    const toPlayer = new THREE.Vector3().subVectors(playerPosition, this.mesh.position);
    const dist = toPlayer.length();
    const forward = toPlayer.normalize();

    if (dist > Config.DRONE.STANDOFF_RADIUS) {
      this.mesh.position.addScaledVector(forward, this.speed * delta);
    }

    this._applyFlightWobble(delta, forward);
  }

  /**
   * プレイヤー方向に対する左右(right)・ワールド上下(up)それぞれに、
   * 周波数の異なる2つのサイン波を重ねて速度として加える。
   * 位置=振幅*sin(...) の微分(=速度)を積分する形にすることで滑らかに揺れ、
   * 2軸が異なる周波数で同時に動くため斜め・不規則な軌道になる。
   * @param {number} delta
   * @param {THREE.Vector3} forward - プレイヤー方向の単位ベクトル
   */
  _applyFlightWobble(delta, forward) {
    this._wobbleTime += delta;
    const t = this._wobbleTime;
    const w = this._wobble;

    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const up = new THREE.Vector3(0, 1, 0);

    const rightVelocity =
      Config.DRONE.STRAFE_AMPLITUDE * Config.DRONE.STRAFE_ANGULAR_SPEED
        * Math.cos(t * Config.DRONE.STRAFE_ANGULAR_SPEED + w.rightPhase1)
      + Config.DRONE.STRAFE_AMPLITUDE * WOBBLE_SECONDARY_AMPLITUDE_RATIO * Config.DRONE.STRAFE_ANGULAR_SPEED * w.rightFreqRatio
        * Math.cos(t * Config.DRONE.STRAFE_ANGULAR_SPEED * w.rightFreqRatio + w.rightPhase2);

    const upVelocity =
      Config.DRONE.BOB_AMPLITUDE * Config.DRONE.BOB_ANGULAR_SPEED
        * Math.cos(t * Config.DRONE.BOB_ANGULAR_SPEED + w.upPhase1)
      + Config.DRONE.BOB_AMPLITUDE * WOBBLE_SECONDARY_AMPLITUDE_RATIO * Config.DRONE.BOB_ANGULAR_SPEED * w.upFreqRatio
        * Math.cos(t * Config.DRONE.BOB_ANGULAR_SPEED * w.upFreqRatio + w.upPhase2);

    this.mesh.position.addScaledVector(right, rightVelocity * delta);
    this.mesh.position.addScaledVector(up, upVelocity * delta);
  }

  /**
   * 回転演出の代わりに、銃口を常にプレイヤーへ向ける。あわせて銃撃も処理する。
   * @param {number} delta
   * @param {THREE.Vector3} playerPosition
   */
  _updateVisual(delta, playerPosition) {
    this.mesh.lookAt(playerPosition);
    this._updateShooting(delta, playerPosition);
  }

  /**
   * 一定間隔でプレイヤーへ弾を発射し、発射済みの弾を毎フレーム前進させる。
   * プレイヤーに命中した弾はダメージイベントを発行して消える。
   * @param {number} delta
   * @param {THREE.Vector3} playerPosition
   */
  _updateShooting(delta, playerPosition) {
    this._fireTimer -= delta;
    if (this._fireTimer <= 0) {
      this._fireTimer = Config.DRONE.FIRE_INTERVAL;
      this._fireProjectile(playerPosition);
    }

    this._updateProjectiles(delta, playerPosition);
  }

  /**
   * 発射済みの弾を前進させ、命中/期限切れの弾を消す。
   * ドローン自身が撃破・到達済みになった後は呼ばれなくなる想定のため、
   * その場合は _defeat()/_onReachPlayer() 側で即座に弾をクリアする。
   * @param {number} delta
   * @param {THREE.Vector3} playerPosition
   */
  _updateProjectiles(delta, playerPosition) {
    for (const projectile of this._projectiles) {
      if (!projectile.active) continue;

      projectile.mesh.position.addScaledVector(projectile.velocity, delta);
      projectile.lifetime -= delta;

      const didHit = projectile.mesh.position.distanceTo(playerPosition) < Config.DRONE.PROJECTILE_HIT_RADIUS;
      if (didHit || projectile.lifetime <= 0) {
        this._removeProjectile(projectile);
        if (didHit) {
          EventBus.emit('enemy:projectile-hit', { damage: Config.DRONE.PROJECTILE_DAMAGE });
          EventBus.emit('sound:play', { id: 'player-hit' });
        }
      }
    }
    this._projectiles = this._projectiles.filter((p) => p.active);
  }

  /**
   * 現在のドローン位置からプレイヤーへ向けて1発発射する
   * @param {THREE.Vector3} playerPosition
   */
  _fireProjectile(playerPosition) {
    const origin = new THREE.Vector3();
    this.mesh.getWorldPosition(origin);
    const velocity = new THREE.Vector3()
      .subVectors(playerPosition, origin)
      .normalize()
      .multiplyScalar(Config.DRONE.PROJECTILE_SPEED);

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(Config.DRONE.PROJECTILE_RADIUS, 8, 8),
      new THREE.MeshBasicMaterial({ color: PROJECTILE_COLOR }),
    );
    mesh.position.copy(origin);
    this.scene.add(mesh);

    this._projectiles.push({
      mesh,
      velocity,
      lifetime: Config.DRONE.PROJECTILE_LIFETIME,
      active: true,
    });
    EventBus.emit('sound:play', { id: 'shoot' });
  }

  /**
   * 弾をシーンから除去してリソースを解放する
   * @param {{mesh: THREE.Mesh, active: boolean}} projectile
   */
  _removeProjectile(projectile) {
    projectile.active = false;
    this.scene.remove(projectile.mesh);
    projectile.mesh.geometry.dispose();
    projectile.mesh.material.dispose();
  }

  /**
   * 発射済みの弾をすべて即座に消す。
   * ドローンが撃破・到達済みになると update() が呼ばれなくなり(またはプールで
   * 再利用され位置が変わる)、発射中の弾を放置すると永遠にシーンへ残ってしまうため、
   * その時点で残っている弾は消してしまう。
   */
  _clearProjectiles() {
    for (const projectile of this._projectiles) {
      if (projectile.active) this._removeProjectile(projectile);
    }
    this._projectiles = [];
  }

  _defeat() {
    super._defeat();
    this._clearProjectiles();
  }

  _onReachPlayer() {
    super._onReachPlayer();
    this._clearProjectiles();
  }

  /**
   * プール再利用時の見た目更新フック。
   * GLBモデル本来の色を保つため、基底クラスのようなウェーブ色の再着色は行わない。
   * 射撃タイマー・飛行の揺れ・残弾を初期化するのみ。
   */
  _onReset() {
    this._clearProjectiles();
    this._resetFlightState();
  }

  /**
   * ドローン本体に加えて、発射済みの弾もすべて破棄する
   */
  _disposeMesh() {
    super._disposeMesh();
    this._clearProjectiles();
  }
}
