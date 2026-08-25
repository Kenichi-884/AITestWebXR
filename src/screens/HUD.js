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
    this._damageFlashEl = document.getElementById('damage-flash');

    this._comboEl      = document.getElementById('combo-display');
    this._comboValueEl = document.getElementById('combo-value');
    this._comboMultEl  = document.getElementById('combo-mult');
    this._healthPercentEl = document.getElementById('health-percent');
    this._ammoDotsEl      = document.getElementById('ammo-dots');
    this._lowHpVignetteEl = document.getElementById('low-hp-vignette');
    this._powerupDisplayEl = document.getElementById('powerup-display');
    this._powerupLabelEl   = document.getElementById('powerup-label');
    this._powerupBarEl     = document.getElementById('powerup-bar');

    this._score = 0;
    this._health = Config.PLAYER.MAX_HEALTH;
    this._hitFlashTimer  = null;
    this._chFiredTimer   = null; // クロスヘアスプレッド用タイマー

    // EventBusからの自動更新を購読
    EventBus.on('game:score-update',  this._onScoreUpdate.bind(this));
    EventBus.on('game:health-update', this._onHealthUpdate.bind(this));
    EventBus.on('game:wave-update',   this._onWaveUpdate.bind(this));
    EventBus.on('game:combo-update',  this._onComboUpdate.bind(this));
    EventBus.on('weapon:ammo-update', this._onAmmoUpdate.bind(this));
    EventBus.on('weapon:reloading',   this._onReloading.bind(this));
    EventBus.on('weapon:hit',         this._onWeaponHit.bind(this));
    EventBus.on('powerup:activated',  this._onPowerUpActivated.bind(this));
    EventBus.on('powerup:ended',      this._onPowerUpEnded.bind(this));
    // 射撃時にクロスヘアを一瞬広げるスプレッド演出
    EventBus.on('weapon:fired', () => {
      if (!this._crosshairEl) return;
      this._crosshairEl.classList.add('ch-fired');
      clearTimeout(this._chFiredTimer);
      this._chFiredTimer = setTimeout(() => this._crosshairEl.classList.remove('ch-fired'), 100);
    });
  }

  /**
   * HUDを表示してゲームプレイ状態にする
   */
  show() {
    this._hudEl.style.display = 'block';
    this._crosshairEl.style.display = 'block';
    const ammoWrap = document.getElementById('ammo-display');
    if (ammoWrap) ammoWrap.style.display = 'block';
    this._reset();
  }

  /**
   * HUDを非表示にする
   */
  hide() {
    this._hudEl.style.display = 'none';
    this._crosshairEl.style.display = 'none';
    const ammoWrap = document.getElementById('ammo-display');
    if (ammoWrap) ammoWrap.style.display = 'none';
    if (this._reloadEl) this._reloadEl.style.display = 'none';
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
    if (this._ammoEl) this._ammoEl.textContent = '12';
    this._updateAmmoDots(Config.WEAPON.MAX_AMMO, Config.WEAPON.MAX_AMMO);
    if (this._reloadEl) { this._reloadEl.style.display = 'none'; }
    document.getElementById('ammo-display')?.classList.remove('ammo-critical');
    if (this._lowHpVignetteEl) this._lowHpVignetteEl.classList.remove('active');
    if (this._crosshairEl) this._crosshairEl.classList.remove('ch-fired');
    this._hideCombo();
    this._onPowerUpEnded();
  }

  /**
   * スコア更新イベントの処理
   * @param {{ score: number, delta: number }} data
   */
  _onScoreUpdate(data) {
    this._score = data.score;
    this._updateScoreDisplay();

    if (data.delta > 0) {
      this._popScore(data.delta, data.multiplier ?? 1);
    }
  }

  /**
   * スコア加算時のポップ演出(数字の拡大 + "+delta ×multiplier"の浮遊テキスト)
   * @param {number} delta
   * @param {number} multiplier コンボ倍率(1より大きいと倍率を表示)
   */
  _popScore(delta, multiplier = 1) {
    if (this._scoreEl) {
      this._scoreEl.classList.remove('score-pop');
      void this._scoreEl.offsetWidth; // 連続加算でもアニメーションを再始動させるための強制リフロー
      this._scoreEl.classList.add('score-pop');
    }

    const scoreDisplay = document.getElementById('score-display');
    if (!scoreDisplay) return;
    const popup = document.createElement('div');
    popup.className = 'score-popup';
    popup.textContent = multiplier > 1 ? `+${delta}  ×${multiplier}` : `+${delta}`;
    scoreDisplay.appendChild(popup);
    setTimeout(() => popup.remove(), 800);
  }

  /**
   * App.jsからのコンボ更新イベントを受けてコンボ表示を更新する
   * @param {{ count: number, multiplier: number }} data
   */
  _onComboUpdate({ count, multiplier }) {
    if (count < 2) {
      this._hideCombo();
      return;
    }
    if (this._comboValueEl) this._comboValueEl.textContent = count;
    if (this._comboMultEl)  this._comboMultEl.textContent  = multiplier > 1 ? `×${multiplier}` : '';
    if (this._comboEl) this._comboEl.classList.add('combo-active');

    // キルストリークアナウンス(特定コンボ数で表示)
    const KILLSTREAK = { 3: 'TRIPLE KILL!', 5: 'KILLING SPREE!', 10: 'UNSTOPPABLE!!' };
    if (KILLSTREAK[count]) this._showKillstreak(KILLSTREAK[count], multiplier);
  }

  _hideCombo() {
    if (this._comboEl) this._comboEl.classList.remove('combo-active');
  }

  /**
   * キルストリーク達成時のアナウンス表示
   */
  _showKillstreak(text, mult) {
    const el = document.createElement('div');
    el.className = 'killstreak-popup';
    el.innerHTML = `<span class="ks-text">${text}</span><span class="ks-mult">SCORE ×${mult}</span>`;
    document.getElementById('overlay').appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  /**
   * 弾が敵にヒットした瞬間に照準を光らせる(ヒットマーカー)
   */
  _onWeaponHit() {
    if (!this._crosshairEl) return;
    this._crosshairEl.classList.add('hit-flash');
    if (this._hitFlashTimer) clearTimeout(this._hitFlashTimer);
    this._hitFlashTimer = setTimeout(() => {
      this._crosshairEl.classList.remove('hit-flash');
    }, 250);
  }

  /**
   * HP更新イベントの処理
   * @param {{ health: number, maxHealth: number }} data
   */
  _onHealthUpdate(data) {
    if (data.health < this._health) this._triggerDamageFlash();
    this._health = data.health;
    this._updateHealthDisplay();
  }

  /**
   * 被弾時に画面を赤くフラッシュさせる
   */
  _triggerDamageFlash() {
    if (!this._damageFlashEl) return;
    this._damageFlashEl.classList.remove('damage-flash-active');
    void this._damageFlashEl.offsetWidth; // 再生中でもアニメーションを再始動させるための強制リフロー
    this._damageFlashEl.classList.add('damage-flash-active');
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

    // HPが低くなるほど赤に変化
    let color, glow;
    if (pct > 60) {
      color = 'var(--green)'; glow = 'rgba(48,209,88,0.5)';
    } else if (pct > 30) {
      color = 'var(--warn)';  glow = 'rgba(255,214,10,0.5)';
    } else {
      color = 'var(--danger)'; glow = 'rgba(255,45,85,0.6)';
    }
    this._healthBarEl.style.background = color;
    this._healthBarEl.style.boxShadow  = `0 0 8px ${glow}`;

    if (this._healthPercentEl) {
      this._healthPercentEl.textContent = `${Math.round(pct)}%`;
      this._healthPercentEl.style.color = color;
    }

    // 低HP時のビネット: 30%以下でアクティブ
    if (this._lowHpVignetteEl) {
      if (pct <= 30 && pct > 0) {
        this._lowHpVignetteEl.classList.add('active');
      } else {
        this._lowHpVignetteEl.classList.remove('active');
      }
    }
  }

  _onAmmoUpdate({ ammo, max }) {
    if (this._ammoEl) {
      this._ammoEl.textContent = ammo;
      this._ammoEl.style.color = ammo === 0 ? 'var(--danger)' : 'var(--text)';
    }
    if (this._reloadEl) this._reloadEl.style.display = 'none';
    this._updateAmmoDots(ammo, max);

    // 残弾3発以下で点滅警告
    const ammoDisplay = document.getElementById('ammo-display');
    if (ammoDisplay) {
      if (ammo > 0 && ammo <= 3) {
        ammoDisplay.classList.add('ammo-critical');
      } else {
        ammoDisplay.classList.remove('ammo-critical');
      }
    }
  }

  _onReloading({ reloadTime }) {
    if (this._ammoEl) {
      this._ammoEl.textContent = '--';
      this._ammoEl.style.color = 'var(--warn)';
    }
    if (this._reloadEl) {
      this._reloadEl.style.display = 'block';
      this._reloadEl.style.animationDuration = `${reloadTime}s`;
    }
  }

  /**
   * 弾数ドットを更新する
   * @param {number} ammo 現在の弾数
   * @param {number} max 最大弾数
   */
  _updateAmmoDots(ammo, max) {
    if (!this._ammoDotsEl) return;
    this._ammoDotsEl.innerHTML = Array.from({ length: max }, (_, i) =>
      `<span class="ammo-dot${i < ammo ? ' loaded' : ''}"></span>`,
    ).join('');
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
    banner.innerHTML = `
      <div class="wave-banner-line"></div>
      <div class="wave-banner-text">WAVE ${wave}</div>
      <div class="wave-banner-sub">GET READY</div>
      <div class="wave-banner-line"></div>
    `;
    banner.style.cssText = `
      position: fixed;
      top: 45%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
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

  /**
   * パワーアップ取得時の表示
   * @param {{ type: string, duration: number }} data
   */
  _onPowerUpActivated({ type, duration }) {
    if (!this._powerupDisplayEl) return;
    const labels = { power: 'POWER ×5', rapid: 'RAPID FIRE', shotgun: 'SHOTGUN' };
    if (this._powerupLabelEl) this._powerupLabelEl.textContent = labels[type] ?? type;

    this._powerupDisplayEl.className = `powerup-active pu-${type}`;
    this._powerupDisplayEl.style.display = 'flex';

    // タイマーバーをCSS animationで制御
    if (this._powerupBarEl) {
      this._powerupBarEl.style.animationDuration = `${duration}s`;
      this._powerupBarEl.classList.remove('pu-bar-run');
      void this._powerupBarEl.offsetWidth; // 強制リフロー
      this._powerupBarEl.classList.add('pu-bar-run');
    }
  }

  _onPowerUpEnded() {
    if (this._powerupDisplayEl) this._powerupDisplayEl.style.display = 'none';
  }

  get score() {
    return this._score;
  }
}
