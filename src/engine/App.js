/**
 * App.js - XRセッション初期化・ゲームループ・ゲーム状態管理
 * ============================================================
 * 担当: コアエンジン・XR担当メンバー
 *
 * 作業ガイド:
 *   - XRセッション設定     → _startXR()
 *   - ゲームループ         → _onAnimationFrame()
 *   - ゲーム状態管理       → STATE と switch
 *   - 各モジュールの呼び出し順はここで制御する
 *
 * このファイルで触るもの: このファイルのみ
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

const STATE = Object.freeze({ MENU: 'menu', PLAYING: 'playing', GAMEOVER: 'gameover' });

class App {
  constructor() {
    this._state = STATE.MENU;
    this._score = 0;
    this._health = Config.PLAYER.MAX_HEALTH;
    this._lastTime = 0;
    this._isDesktopMode = false;

    // ── レンダラー ──────────────────────────────────────────
    this._renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById('canvas'),
      antialias: true,
      alpha: true,
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.xr.enabled = true;
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.0;

    // ── モジュール初期化 ─────────────────────────────────────
    this._sceneManager = new SceneManager(this._renderer);
    this._soundManager = new SoundManager();
    this._enemySpawner = new EnemySpawner(this._sceneManager.scene);
    this._weapon = new Weapon(this._sceneManager.scene, this._renderer, this._sceneManager.camera);
    this._hud = new HUD();
    this._menu = new MenuScreen({
      onStartXR:      () => this._startXR(),
      onStartDesktop: () => this._startDesktop(),
      onRestart:      () => this._restartGame(),
      onToMenu:       () => this._toMenu(),
    });

    // ── EventBus ────────────────────────────────────────────
    EventBus.on('enemy:defeated',        ({ score }) => this._addScore(score));
    EventBus.on('enemy:reached-player',  ({ damage }) => this._applyDamage(damage));

    // ── デスクトップ: マウスルック ────────────────────────────
    this._yaw = 0;
    this._pitch = 0;
    this._setupMouseLook();

    this._checkXRSupport();
    this._renderer.setAnimationLoop(this._onAnimationFrame.bind(this));
  }

  // ── XR サポートチェック ──────────────────────────────────

  async _checkXRSupport() {
    let xrAvailable = false;
    try {
      xrAvailable = await navigator.xr?.isSessionSupported('immersive-ar') ?? false;
    } catch (_) {}
    this._menu.showMenu(xrAvailable);
  }

  // ── ゲーム開始 ───────────────────────────────────────────

  async _startXR() {
    this._soundManager.init();
    try {
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['dom-overlay', 'hand-tracking', 'bounded-floor'],
        domOverlay: { root: document.getElementById('overlay') },
      });
      await this._renderer.xr.setSession(session);
      this._sceneManager.setWeaponMode('xr');
      this._isDesktopMode = false;
      this._startGame();
      session.addEventListener('end', () => {
        if (this._state === STATE.PLAYING) this._endGame();
      });
    } catch (err) {
      console.error('[App] XR session failed:', err);
      alert('Failed to start AR session.\nPlease use Meta Quest browser.\n\n' + err.message);
    }
  }

  _startDesktop() {
    this._soundManager.init();
    this._isDesktopMode = true;
    this._sceneManager.scene.background = new THREE.Color(0x111122);
    this._sceneManager.setWeaponMode('desktop');
    this._menu.hideMenu();
    this._startGame();
    // マウスルック開始のためクリックで Pointer Lock を促す
    this._requestPointerLock();
  }

  _startGame() {
    this._state = STATE.PLAYING;
    this._score = 0;
    this._health = Config.PLAYER.MAX_HEALTH;
    this._yaw = 0;
    this._pitch = 0;

    this._menu.hideMenu();
    this._menu.hideResult();
    this._hud.show();
    this._enemySpawner.start();
    this._weapon.start();

    EventBus.emit('game:start', {});
    EventBus.emit('game:score-update', { score: 0, delta: 0 });
    EventBus.emit('game:health-update', { health: this._health, maxHealth: Config.PLAYER.MAX_HEALTH });
  }

  // ── ゲーム終了 ───────────────────────────────────────────

  _endGame() {
    if (this._state === STATE.GAMEOVER) return;
    this._state = STATE.GAMEOVER;

    this._exitPointerLock();
    this._enemySpawner.stop();
    this._weapon.stop();
    this._hud.hide();

    const wave = this._enemySpawner.wave;
    EventBus.emit('game:over', { finalScore: this._score, wave });
    setTimeout(() => this._menu.showResult(this._score, wave), 1000);
  }

  _restartGame() {
    this._enemySpawner.reset();
    this._weapon.reset();
    if (this._isDesktopMode) this._requestPointerLock();
    this._startGame();
  }

  _toMenu() {
    if (this._renderer.xr.isPresenting) {
      this._renderer.xr.getSession()?.end();
    }
    this._exitPointerLock();
    this._state = STATE.MENU;
    this._enemySpawner.reset();
    this._weapon.reset();
    this._hud.hide();
    this._menu.hideResult();
    this._sceneManager.setWeaponMode('xr');
    if (this._isDesktopMode) {
      this._sceneManager.scene.background = null;
      this._isDesktopMode = false;
    }
    this._checkXRSupport();
  }

  // ── スコア / ダメージ ────────────────────────────────────

  _addScore(delta) {
    this._score += delta;
    EventBus.emit('game:score-update', { score: this._score, delta });
  }

  _applyDamage(damage) {
    this._health = Math.max(0, this._health - damage);
    EventBus.emit('game:health-update', { health: this._health, maxHealth: Config.PLAYER.MAX_HEALTH });
    if (this._health <= 0) this._endGame();
  }

  // ── デスクトップ: マウスルック ────────────────────────────

  /**
   * Pointer Lock API を使ってマウスでカメラを操作できるようにする
   * クリック射撃も同時に動作する
   */
  _setupMouseLook() {
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = document.pointerLockElement === document.body;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this._pointerLocked || !this._isDesktopMode) return;
      const sensitivity = 0.002;
      this._yaw   -= e.movementX * sensitivity;
      this._pitch -= e.movementY * sensitivity;
      // 上下の視点を ±80度 に制限
      this._pitch = Math.max(-Math.PI * 0.44, Math.min(Math.PI * 0.44, this._pitch));
    });

    // ESCキーまたはPointerLock解除時のガイド表示
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._isDesktopMode && this._state === STATE.PLAYING) {
        this._showPointerLockHint();
      }
    });
  }

  _requestPointerLock() {
    document.body.requestPointerLock().catch(() => {
      // Pointer Lock が拒否された場合(ブラウザポリシー)は無視
    });
  }

  _exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
    this._pointerLocked = false;
  }

  /**
   * Pointer Lock が外れたときに再クリックを促すヒントを表示する
   */
  _showPointerLockHint() {
    const existing = document.getElementById('pointer-lock-hint');
    if (existing) return;
    const hint = document.createElement('div');
    hint.id = 'pointer-lock-hint';
    hint.textContent = 'Click to resume mouse look';
    hint.style.cssText = `
      position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
      background:rgba(0,0,0,0.7); color:#fff; padding:1rem 2rem;
      border-radius:8px; font-size:1rem; pointer-events:all; cursor:pointer;
      z-index:999;
    `;
    hint.addEventListener('click', () => {
      hint.remove();
      this._requestPointerLock();
    });
    document.getElementById('overlay').appendChild(hint);
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) hint.remove();
    }, { once: true });
  }

  // ── メインゲームループ ───────────────────────────────────

  _onAnimationFrame(time, frame) {
    const delta = Math.min((time - this._lastTime) / 1000, 0.1);
    this._lastTime = time;

    if (this._state === STATE.PLAYING) {
      // デスクトップ: マウスルックでカメラ回転
      if (this._isDesktopMode) {
        this._sceneManager.camera.rotation.order = 'YXZ';
        this._sceneManager.camera.rotation.y = this._yaw;
        this._sceneManager.camera.rotation.x = this._pitch;
      }

      const playerPos = new THREE.Vector3();
      this._sceneManager.camera.getWorldPosition(playerPos);

      this._sceneManager.update(delta);
      this._weapon.update(delta);
      this._enemySpawner.update(delta, playerPos);
      this._weapon.checkCollisions(this._enemySpawner.getEnemies());
      this._weapon.cleanup();
      this._enemySpawner.cleanup();
    }

    this._renderer.render(this._sceneManager.scene, this._sceneManager.camera);
  }
}

new App();
