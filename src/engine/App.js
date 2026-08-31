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
import { ItemDrop } from '../gameplay/ItemDrop.js';
import { EffectManager } from '../effects/EffectManager.js';
import { HUD } from '../screens/HUD.js';
import { WorldHUD } from '../screens/WorldHUD.js';
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
    this._renderer.shadowMap.type = THREE.BasicShadowMap;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.0;

    // ── モジュール初期化 ─────────────────────────────────────
    this._sceneManager  = new SceneManager(this._renderer);
    this._soundManager  = new SoundManager();
    this._effectManager = new EffectManager(this._sceneManager.scene);
    this._enemySpawner  = new EnemySpawner(this._sceneManager.scene);
    this._weapon        = new Weapon(this._sceneManager.scene, this._renderer, this._sceneManager.camera);
    this._hud      = new HUD();
    this._worldHUD = new WorldHUD(this._sceneManager.scene, this._sceneManager.camera);
    this._menu = new MenuScreen({
      onStartXR:      () => this._startXR(),
      onStartDesktop: () => this._startDesktop(),
      onRestart:      () => this._restartGame(),
      onToMenu:       () => this._toMenu(),
    });

    // コンボ管理(スコア倍率付き) / カメラシェイク / ヒットポーズ
    this._comboCount    = 0;
    this._comboTimer    = null;
    this._shakePower    = 0;
    this._hitstopFrames = 0; // 撃破時に数フレーム停止して重さを演出

    // アイテムドロップ管理
    /** @type {ItemDrop[]} */
    this._items = [];

    // ── EventBus ────────────────────────────────────────────
    EventBus.on('enemy:defeated', ({ enemy, score }) => {
      this._hitstopFrames = 3;
      this._registerCombo();
      this._addScore(Math.round(score * this._comboMultiplier()), this._comboMultiplier());
      this._tryDropItem(enemy);
    });
    EventBus.on('item:collected', ({ type }) => {
      this._weapon.activatePowerUp(type, Config.POWERUP.DURATION);
    });
    EventBus.on('enemy:reached-player', ({ damage }) => {
      this._applyDamage(damage);
      this._triggerShake(false); // 被弾: 大きめのシェイク
    });
    EventBus.on('enemy:projectile-hit', ({ damage }) => {
      this._applyDamage(damage);
      this._triggerShake(false); // ドローンの弾が命中: 大きめのシェイク
    });
    EventBus.on('weapon:fired', () => this._triggerShake(true)); // 射撃: 小さいシェイク

    // ── デスクトップ: マウスルック ────────────────────────────
    this._yaw = 0;
    this._pitch = 0;
    this._setupMouseLook();

    // フレームごとに再利用するVector3（GCを避けるためキャッシュ）
    this._playerPos = new THREE.Vector3();

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
      // Quest では devicePixelRatio=1 にするだけで GPU 負荷が大幅に下がる
      this._renderer.setPixelRatio(1);
      this._sceneManager.setWeaponMode('xr');
      this._isDesktopMode = false;
      this._startGame();
      this._worldHUD.show();
      session.addEventListener('end', () => {
        if (this._state === STATE.PLAYING) this._endGame();
        this._worldHUD.hide();
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

    this._comboCount    = 0;
    this._hitstopFrames = 0;
    if (this._comboTimer) { clearTimeout(this._comboTimer); this._comboTimer = null; }
    this._shakePower = 0;

    // アイテムをリセット
    for (const item of this._items) item.destroy();
    this._items = [];

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
    this._worldHUD.hide();

    for (const item of this._items) item.destroy();
    this._items = [];

    const wave = this._enemySpawner.wave;
    EventBus.emit('game:over', { finalScore: this._score, wave });
    setTimeout(() => this._menu.showResult(this._score, wave), 1000);
  }

  _restartGame() {
    this._enemySpawner.reset();
    this._weapon.reset();
    if (this._isDesktopMode) this._requestPointerLock();
    this._startGame();
    if (this._renderer.xr.isPresenting) this._worldHUD.show();
  }

  _toMenu() {
    if (this._renderer.xr.isPresenting) {
      this._renderer.xr.getSession()?.end();
    }
    // XR 終了時にピクセルレートを元に戻す
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._exitPointerLock();
    this._state = STATE.MENU;
    this._enemySpawner.reset();
    this._weapon.reset();
    for (const item of this._items) item.destroy();
    this._items = [];
    this._hud.hide();
    this._worldHUD.hide();
    this._menu.hideResult();
    this._sceneManager.setWeaponMode('xr');
    if (this._isDesktopMode) {
      this._sceneManager.scene.background = null;
      this._isDesktopMode = false;
    }
    this._checkXRSupport();
  }

  // ── アイテムドロップ ─────────────────────────────────────

  /**
   * 敵撃破時に確率でアイテムをドロップする
   * @param {import('../gameplay/Enemy.js').Enemy} enemy
   */
  _tryDropItem(enemy) {
    if (!enemy || Math.random() > Config.POWERUP.DROP_CHANCE) return;
    const types = ['power', 'rapid', 'shotgun'];
    const type  = types[Math.floor(Math.random() * types.length)];
    const pos   = enemy.position.clone();
    this._items.push(new ItemDrop(this._sceneManager.scene, pos, type));
  }

  // ── スコア / ダメージ ────────────────────────────────────

  _addScore(delta, multiplier = 1) {
    this._score += delta;
    EventBus.emit('game:score-update', { score: this._score, delta, multiplier });
  }

  // ── コンボ管理 ────────────────────────────────────────────

  _registerCombo() {
    this._comboCount++;
    if (this._comboTimer) clearTimeout(this._comboTimer);
    // 2秒間キルがなければコンボリセット
    this._comboTimer = setTimeout(() => {
      this._comboCount = 0;
      EventBus.emit('game:combo-update', { count: 0, multiplier: 1 });
    }, 2000);
    EventBus.emit('game:combo-update', { count: this._comboCount, multiplier: this._comboMultiplier() });
  }

  /** コンボ数に応じたスコア倍率 */
  _comboMultiplier() {
    if (this._comboCount <  2) return 1;
    if (this._comboCount <  4) return 1.5;
    if (this._comboCount <  7) return 2;
    if (this._comboCount < 11) return 3;
    return 5;
  }

  // ── カメラシェイク ─────────────────────────────────────────

  /**
   * オーバーレイ全体をCSSアニメーションで揺らす(XR・デスクトップ共用)
   * @param {boolean} small true=小(射撃), false=大(被弾)
   */
  _triggerShake(small = true) {
    const el = document.getElementById('overlay');
    if (!el) return;
    el.classList.remove('shake-sm', 'shake-lg');
    void el.offsetWidth; // アニメーションを再起動させるための強制リフロー
    el.classList.add(small ? 'shake-sm' : 'shake-lg');
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

    try { this._update(delta, frame); } catch (err) {
      console.error('[App] frame error:', err);
    }

    this._renderer.render(this._sceneManager.scene, this._sceneManager.camera);
  }

  _update(delta, frame) {
    if (this._state === STATE.PLAYING) {
      // ヒットポーズ中もリロードタイマーは継続する
      if (this._hitstopFrames > 0) {
        this._hitstopFrames--;
        this._weapon.update(delta); // リロードを継続するためにupdateは必ず呼ぶ
        return;
      }

      // デスクトップ: マウスルックでカメラ回転
      if (this._isDesktopMode) {
        this._sceneManager.camera.rotation.order = 'YXZ';
        this._sceneManager.camera.rotation.y = this._yaw;
        this._sceneManager.camera.rotation.x = this._pitch;
      }

      this._sceneManager.camera.getWorldPosition(this._playerPos);

      this._sceneManager.update(delta);
      this._effectManager.update(delta);
      this._weapon.update(delta);
      this._worldHUD.update(delta);
      this._enemySpawner.update(delta, this._playerPos);
      this._weapon.checkCollisions(this._enemySpawner.getEnemies());
      this._weapon.checkItemCollisions(this._items);
      this._weapon.cleanup();
      this._enemySpawner.cleanup();

      // アイテムを更新・期限切れを削除
      for (const item of this._items) item.update(delta);
      this._items = this._items.filter((i) => i.isActive);
    }
  }
}

new App();
