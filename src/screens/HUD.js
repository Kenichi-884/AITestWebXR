/**
 * HUD - スコア・HP・ウェーブ表示
 * ============================================================
 * 担当: HUD画面担当メンバー
 *
 * 作業ガイド:
 *   - HTML/CSS の変更は index.html の #hud セクションで行う
 *   - このファイルは「どのタイミングで表示を更新するか」を定義している
 *   - EventBus のイベントを購読して自動的に表示が更新される
 *   - 新しい表示項目を追加する場合:
 *     1. index.html に要素を追加
 *     2. constructor() で document.getElementById() で取得
 *     3. 対応するイベントを EventBus.on() で購読して更新
 *
 * このファイルで触るもの: このファイル + index.html の #hud 部分
 * ============================================================
 */

import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

export class HUD {
  constructor() {
    // DOM要素の参照を取得
    this._hudEl       = document.getElementById('hud');
    this._scoreEl     = document.getElementById('score-value');
    this._waveEl      = document.getElementById('wave-value');
    this._ammoEl      = document.getElementById('ammo-value');
    this._healthBarEl = document.getElementById('health-bar');
    this._crosshairEl = document.getElementById('crosshair');

    this._reloadEl    = document.getElementById('reload-indicator');

    this._score = 0;
    this._health = Config.PLAYER.MAX_HEALTH;

    // EventBusからの自動更新を購読
    EventBus.on('game:score-update',  this._onScoreUpdate.bind(this));
    EventBus.on('game:health-update', this._onHealthUpdate.bind(this));
    EventBus.on('game:wave-update',   this._onWaveUpdate.bind(this));
    EventBus.on('weapon:ammo-update', this._onAmmoUpdate.bind(this));
    EventBus.on('weapon:reloading',   this._onReloading.bind(this));
  }

  /**
   * HUDを表示してゲームプレイ状態にする
   */
  show() {
    this._hudEl.style.display = 'block';
    this._crosshairEl.style.display = 'block';
    this._reset();
  }

  /**
   * HUDを非表示にする
   */
  hide() {
    this._hudEl.style.display = 'none';
    this._crosshairEl.style.display = 'none';
  }

  /**
   * 表示をリセットする
   */
  _reset() {
    this._score = 0;
    this._health = Config.PLAYER.MAX_HEALTH;
    this._updateScoreDisplay();
    this._updateHealthDisplay();
    this._updateWaveDisplay(1);
    if (this._ammoEl) this._ammoEl.textContent = '12 / 12';
    if (this._reloadEl) { this._reloadEl.style.display = 'none'; }
  }

  /**
   * スコア更新イベントの処理
   * @param {{ score: number, delta: number }} data
   */
  _onScoreUpdate(data) {
    this._score = data.score;
    this._updateScoreDisplay();

    // TODO: スコアアップ時のアニメーションをここに追加できる
    //   例: スコア表示を一時的に大きくしてfadeoutするCSSアニメーション
  }

  /**
   * HP更新イベントの処理
   * @param {{ health: number, maxHealth: number }} data
   */
  _onHealthUpdate(data) {
    this._health = data.health;
    this._updateHealthDisplay();
  }

  /**
   * ウェーブ更新イベントの処理
   * @param {{ wave: number }} data
   */
  _onWaveUpdate(data) {
    this._updateWaveDisplay(data.wave);
    this._showWaveBanner(data.wave);
  }

  _updateScoreDisplay() {
    if (this._scoreEl) this._scoreEl.textContent = this._score.toLocaleString();
  }

  _updateHealthDisplay() {
    if (!this._healthBarEl) return;
    const pct = Math.max(0, (this._health / Config.PLAYER.MAX_HEALTH) * 100);
    this._healthBarEl.style.width = `${pct}%`;

    // HPが低くなったら色を変える
    if (pct > 60) {
      this._healthBarEl.style.background = '#2ecc71'; // 緑
    } else if (pct > 30) {
      this._healthBarEl.style.background = '#f39c12'; // 黄
    } else {
      this._healthBarEl.style.background = '#e74c3c'; // 赤
    }
  }

  _onAmmoUpdate({ ammo, max }) {
    if (this._ammoEl) this._ammoEl.textContent = `${ammo} / ${max}`;
    if (this._reloadEl) this._reloadEl.style.display = 'none';
    // 残弾0で赤くする
    if (this._ammoEl) {
      this._ammoEl.style.color = ammo === 0 ? '#e74c3c' : '#fff';
    }
  }

  _onReloading({ reloadTime }) {
    if (this._ammoEl) { this._ammoEl.textContent = '-- / --'; this._ammoEl.style.color = '#f39c12'; }
    if (this._reloadEl) {
      this._reloadEl.style.display = 'block';
      this._reloadEl.style.animationDuration = `${reloadTime}s`;
    }
  }

  _updateWaveDisplay(wave) {
    const el = document.getElementById('wave-value');
    if (el) el.textContent = wave;
  }

  /**
   * ウェーブ進行時のバナー表示
   * TODO: ここのスタイルをカスタマイズしてウェーブ演出を豪華にできる
   * @param {number} wave
   */
  _showWaveBanner(wave) {
    if (wave <= 1) return; // 最初のウェーブでは表示しない

    const banner = document.createElement('div');
    banner.textContent = `WAVE ${wave}`;
    banner.style.cssText = `
      position: fixed;
      top: 45%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 3rem;
      font-weight: bold;
      color: #f1c40f;
      text-shadow: 0 0 20px rgba(241,196,15,0.8);
      animation: waveBanner 2s ease-out forwards;
      pointer-events: none;
      z-index: 100;
    `;

    // アニメーション定義(未追加の場合のみ)
    if (!document.getElementById('wave-banner-style')) {
      const style = document.createElement('style');
      style.id = 'wave-banner-style';
      style.textContent = `
        @keyframes waveBanner {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
          20%  { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
          80%  { opacity: 1; transform: translate(-50%, -50%) scale(1.0); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.0); }
        }
      `;
      document.head.appendChild(style);
    }

    document.getElementById('overlay').appendChild(banner);
    setTimeout(() => banner.remove(), 2100);
  }

  get score() {
    return this._score;
  }
}
