/**
 * App.js - アプリケーションのエントリーポイント
 * XRセッション初期化・ゲームループ・ゲーム状態管理
 * ============================================================
 * 担当: コアエンジン・XR担当メンバー
 *
 * 作業ガイド:
 *   - XRセッションの設定 → _startXR()
 *   - ゲームループ(毎フレーム処理) → _onAnimationFrame()
 *   - ゲーム状態管理 → STATE定数とswitch文
 *   - 各モジュールの呼び出し順序はここで制御する
 *
 * このファイルで触るもの: このファイルのみ
 * 各モジュールの内部実装はそれぞれのファイルで担当する
 * ============================================================
 */

import * as THREE from 'three';
import { SceneManager } from './SceneManager.js';
import { EnemySpawner } from '../gameplay/EnemySpawner.js';
import { Weapon } from '../gameplay/Weapon.js';
import { HUD } from '../screens/HUD.js';
import { MenuScreen } from '../screens/MenuScreen.js';
import { SoundManager } from '../sounds/SoundManager.js';
import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

// ---- ゲーム状態 ----
const STATE = Object.freeze({
  MENU: 'menu',
  PLAYING: 'playing',
  GAMEOVER: 'gameover',
});

class App {
  constructor() {
    this._state = STATE.MENU;
    this._score = 0;
    this._health = Config.PLAYER.MAX_HEALTH;
    this._lastTime = 0;
    this._isDesktopMode = false;

    // Three.js レンダラーの初期化
    this._renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById('canvas'),
      antialias: true,
      alpha: true,        // AR(パススルー)用に背景を透明に
    });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.xr.enabled = true;
    this._renderer.shadowMap.enabled = true;

    // 各モジュールの初期化
    this._sceneManager = new SceneManager(this._renderer);
    this._soundManager = new SoundManager();
    this._enemySpawner = new EnemySpawner(this._sceneManager.scene);
    this._weapon = new Weapon(
      this._sceneManager.scene,
      this._renderer,
      this._sceneManager.camera,
    );
    this._hud = new HUD();
    this._menu = new MenuScreen({
      onStartXR:      () => this._startXR(),
      onStartDesktop: () => this._startDesktop(),
      onRestart:      () => this._restartGame(),
      onToMenu:       () => this._toMenu(),
    });

    // EventBus購読
    EventBus.on('game:score-update', ({ score }) => { this._score = score; });
    EventBus.on('enemy:defeated', ({ score }) => this._addScore(score));
    EventBus.on('enemy:reached-player', ({ damage }) => this._applyDamage(damage));

    // 初期表示
    this._checkXRSupport();

    // デスクトップのゲームループ(XR以外)
    this._renderer.setAnimationLoop(this._onAnimationFrame.bind(this));
  }

  /**
   * WebXR AR サポートチェックとメニュー表示
   */
  async _checkXRSupport() {
    let xrAvailable = false;
    try {
      xrAvailable = await navigator.xr?.isSessionSupported('immersive-ar') ?? false;
    } catch (_) {}
    this._menu.showMenu(xrAvailable);
  }

  /**
   * Meta Quest - ARモードでXRセッションを開始する
   */
  async _startXR() {
    this._soundManager.init();
    try {
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['dom-overlay', 'hand-tracking', 'bounded-floor'],
        domOverlay: { root: document.getElementById('overlay') },
      });

      await this._renderer.xr.setSession(session);
      this._isDesktopMode = false;
      this._startGame();

      session.addEventListener('end', () => {
        if (this._state === STATE.PLAYING) this._endGame();
      });
    } catch (err) {
      console.error('[App] XRセッション開始失敗:', err);
      alert('ARセッションを開始できませんでした。Meta Questのブラウザでお試しください。\n\n' + err.message);
    }
  }

  /**
   * デスクトップ(PC)でのテストモード
   */
  _startDesktop() {
    this._soundManager.init();
    this._isDesktopMode = true;
    this._sceneManager.scene.background = new THREE.Color(0x111122);
    this._menu.hideMenu();
    this._startGame();
  }

  /**
   * ゲームを開始する(XR/デスクトップ共通)
   */
  _startGame() {
    this._state = STATE.PLAYING;
    this._score = 0;
    this._health = Config.PLAYER.MAX_HEALTH;

    this._menu.hideMenu();
    this._menu.hideResult();
    this._hud.show();

    this._enemySpawner.start();
    this._weapon.start();

    EventBus.emit('game:start', {});
    EventBus.emit('game:score-update', { score: 0, delta: 0 });
    EventBus.emit('game:health-update', { health: this._health, maxHealth: Config.PLAYER.MAX_HEALTH });
  }

  /**
   * ゲームオーバー処理
   */
  _endGame() {
    if (this._state === STATE.GAMEOVER) return;
    this._state = STATE.GAMEOVER;

    this._enemySpawner.stop();
    this._weapon.stop();
    this._hud.hide();

    const wave = this._enemySpawner.wave;
    EventBus.emit('game:over', { finalScore: this._score, wave });

    // 少し間を置いてリザルト表示
    setTimeout(() => {
      this._menu.showResult(this._score, wave);
    }, 1000);
  }

  /**
   * リスタート
   */
  _restartGame() {
    this._enemySpawner.reset();
    this._weapon.reset();
    this._startGame();
  }

  /**
   * メニューへ戻る
   */
  _toMenu() {
    if (this._renderer.xr.isPresenting) {
      this._renderer.xr.getSession()?.end();
    }
    this._state = STATE.MENU;
    this._enemySpawner.reset();
    this._weapon.reset();
    this._hud.hide();
    this._menu.hideResult();

    if (this._isDesktopMode) {
      this._sceneManager.scene.background = null;
    }
    this._checkXRSupport();
  }

  /**
   * スコアを加算する
   * @param {number} delta
   */
  _addScore(delta) {
    this._score += delta;
    EventBus.emit('game:score-update', { score: this._score, delta });
  }

  /**
   * HPにダメージを適用する
   * @param {number} damage
   */
  _applyDamage(damage) {
    this._health = Math.max(0, this._health - damage);
    EventBus.emit('game:health-update', { health: this._health, maxHealth: Config.PLAYER.MAX_HEALTH });

    if (this._health <= 0) {
      this._endGame();
    }
  }

  /**
   * メインゲームループ(毎フレーム呼ばれる)
   * @param {number} time - 経過時間(ms)
   * @param {XRFrame|null} frame
   */
  _onAnimationFrame(time, frame) {
    const delta = Math.min((time - this._lastTime) / 1000, 0.1); // 最大0.1秒でクランプ
    this._lastTime = time;

    if (this._state === STATE.PLAYING) {
      // プレイヤー位置 = カメラ位置(XR中はHMDの位置)
      const playerPos = new THREE.Vector3();
      this._sceneManager.camera.getWorldPosition(playerPos);

      // 各モジュールの更新
      this._weapon.update(delta, frame ?? null);
      this._enemySpawner.update(delta, playerPos);

      // 当たり判定
      const enemies = this._enemySpawner.getEnemies();
      this._weapon.checkCollisions(enemies);

      // 非アクティブなオブジェクトのクリーンアップ
      this._weapon.cleanup();
      this._enemySpawner.cleanup();
    }

    // レンダリング
    this._renderer.render(this._sceneManager.scene, this._sceneManager.camera);
  }
}

// アプリケーション起動
new App();
