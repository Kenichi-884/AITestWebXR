/**
 * Weapon - 射撃・弾の生成と管理・コントローラー入力
 * ============================================================
 * 担当: 武器・射撃担当メンバー
 *
 * 作業ガイド:
 *   - コントローラーのトリガー入力 → _handleControllerInput()
 *   - デスクトップではクリックで射撃 → _handleDesktopInput()
 *   - 弾の見た目変更 → _createBulletMesh()
 *   - 当たり判定は App.js から checkCollisions() を呼んで行う
 *
 * このファイルで触るもの: このファイルのみ
 * ============================================================
 */

import * as THREE from 'three';
import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

/** @typedef {{ mesh: THREE.Mesh, velocity: THREE.Vector3, lifetime: number, active: boolean }} Bullet */

export class Weapon {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Camera} camera
   */
  constructor(scene, renderer, camera) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;

    /** @type {Bullet[]} */
    this._bullets = [];

    this._cooldown = 0;
    this._isActive = false;

    // コントローラー入力状態
    this._triggerPressed = [false, false]; // [left, right]

    this._setupDesktopInput();
  }

  /**
   * 武器を有効化する(ゲーム開始時)
   */
  start() {
    this._isActive = true;
    this._bullets = [];
    this._cooldown = 0;
  }

  /**
   * 武器を無効化する(ゲームオーバー時)
   */
  stop() {
    this._isActive = false;
  }

  /**
   * 毎フレーム呼ばれる更新処理
   * @param {number} delta
   * @param {XRFrame|null} frame - XRセッション中のフレーム(非XR時はnull)
   */
  update(delta, frame) {
    if (!this._isActive) return;

    // クールダウン更新
    if (this._cooldown > 0) this._cooldown -= delta;

    // XRコントローラー入力
    if (frame) {
      this._handleControllerInput(frame);
    }

    // 弾の移動・寿命更新
    for (const bullet of this._bullets) {
      if (!bullet.active) continue;
      bullet.mesh.position.addScaledVector(bullet.velocity, delta);
      bullet.lifetime -= delta;
      if (bullet.lifetime <= 0) {
        bullet.active = false;
        this.scene.remove(bullet.mesh);
      }
    }
  }

  /**
   * 弾と敵の当たり判定を行う(App.jsから毎フレーム呼ぶ)
   * @param {import('../gameplay/Enemy.js').Enemy[]} enemies
   */
  checkCollisions(enemies) {
    for (const bullet of this._bullets) {
      if (!bullet.active) continue;
      for (const enemy of enemies) {
        if (!enemy.isActive) continue;
        const dist = bullet.mesh.position.distanceTo(enemy.position);
        if (dist < Config.ENEMY.HIT_RADIUS + Config.WEAPON.BULLET_RADIUS) {
          bullet.active = false;
          this.scene.remove(bullet.mesh);
          enemy.hit();
          EventBus.emit('weapon:hit', { bullet, enemy });
          break;
        }
      }
    }
  }

  /**
   * 非アクティブな弾をメモリから除去する(App.jsから毎フレーム呼ぶ)
   */
  cleanup() {
    this._bullets = this._bullets.filter((b) => b.active);
  }

  /**
   * XRコントローラーのトリガー入力を処理する
   * Meta Quest: 右コントローラーのトリガー(selectstart)で射撃
   * @param {XRFrame} frame
   */
  _handleControllerInput(frame) {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    for (const source of session.inputSources) {
      if (!source.gamepad) continue;

      const triggerValue = source.gamepad.buttons[0]?.value ?? 0;
      const handIndex = source.handedness === 'left' ? 0 : 1;
      const wasPressed = this._triggerPressed[handIndex];
      const isPressed = triggerValue > 0.5;

      // トリガーを引いた瞬間だけ発射(押しっぱなし連射はCooldownで制御)
      if (isPressed && (!wasPressed || this._cooldown <= 0)) {
        const controller = this.renderer.xr.getController(handIndex);
        this._fireFromController(controller);
      }

      this._triggerPressed[handIndex] = isPressed;
    }
  }

  /**
   * コントローラーの向きから弾を発射する
   * @param {THREE.Group} controller
   */
  _fireFromController(controller) {
    if (this._cooldown > 0) return;

    // コントローラーの先端位置と向き
    const position = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);

    controller.getWorldPosition(position);
    direction.applyQuaternion(controller.quaternion);

    this._spawnBullet(position, direction);
  }

  /**
   * デスクトップ: マウスクリックで射撃(開発・テスト用)
   * Pointer Lock 中のクリックのみ受け付ける
   * (UI ボタンのクリックで誤射しないようにするため)
   */
  _setupDesktopInput() {
    window.addEventListener('click', () => {
      if (!this._isActive) return;
      if (this.renderer.xr.isPresenting) return;
      if (!document.pointerLockElement) return; // Pointer Lock 中のみ射撃

      const position = new THREE.Vector3();
      const direction = new THREE.Vector3(0, 0, -1);
      this.camera.getWorldPosition(position);
      direction.applyQuaternion(this.camera.quaternion);

      this._spawnBullet(position, direction);
    });
  }

  /**
   * 弾を生成してシーンに追加する
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} direction
   */
  _spawnBullet(position, direction) {
    if (this._cooldown > 0) return;
    this._cooldown = Config.WEAPON.COOLDOWN;

    const mesh = this._createBulletMesh();
    mesh.position.copy(position);

    const velocity = direction.clone().normalize().multiplyScalar(Config.WEAPON.BULLET_SPEED);

    this.scene.add(mesh);
    this._bullets.push({
      mesh,
      velocity,
      lifetime: Config.WEAPON.BULLET_LIFETIME,
      active: true,
    });

    EventBus.emit('weapon:fired', { position: position.clone(), direction: direction.clone() });
    EventBus.emit('sound:play', { id: 'shoot' });
  }

  /**
   * 弾のメッシュを生成する
   * TODO: 見た目をカスタマイズできる(レーザー、炎の玉など)
   * @returns {THREE.Mesh}
   */
  _createBulletMesh() {
    const geometry = new THREE.SphereGeometry(Config.WEAPON.BULLET_RADIUS, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const mesh = new THREE.Mesh(geometry, material);

    // 弾の光
    const light = new THREE.PointLight(0xffff00, 0.8, 1.0);
    mesh.add(light);

    return mesh;
  }

  /**
   * 全弾を破棄してリセットする
   */
  reset() {
    for (const bullet of this._bullets) {
      if (bullet.mesh.parent) this.scene.remove(bullet.mesh);
    }
    this._bullets = [];
    this._cooldown = 0;
    this._isActive = false;
    this._triggerPressed = [false, false];
  }
}
