/**
 * DebugMode - PCでのテストモード(デバッグパネル + ショートカットキー)
 * ============================================================
 * 有効化: localhost で開く(PC)か、URLに ?debug を付けて開く。?debug=0 で無効
 *   例) https://localhost:5173  /  https://192.168.x.x:5173/?debug
 *   - メニューに「PC TEST MODE」ボタンが出る(マウスで視点操作 / クリックで射撃)
 *   - 画面右上にスコア・HP・撃破数・死亡数などを常時表示
 *
 * キー操作(ゲーム中):
 *   K : 敵を1体倒す(撃破 +100 の確認用)
 *   H : 25ダメージを受ける
 *   X : 即死する(死亡 -100 / 死亡数の確認用)
 *   G : 無敵 ON/OFF
 *   0 : 通算記録(撃破数・死亡数)をリセット
 *   F1: パネルの表示/非表示
 *
 * 本番(?debug なし)では何も読み込まれず、挙動に影響しない。
 * ============================================================
 */

import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';
import ScoreManager from '../score/ScoreManager.js';

export class DebugMode {
  /**
   * @param {object} app App インスタンス(内部状態を読むためだけに使う)
   */
  constructor(app) {
    this._app = app;
    this._invincible = false;
    this._log = [];

    this._showDesktopButton();
    this._createPanel();

    window.addEventListener('keydown', (e) => this._onKeyDown(e));

    const log = (msg) => () => this._pushLog(msg);
    EventBus.on('enemy:defeated', log('敵撃破'));
    EventBus.on('game:start', log('ゲーム開始'));
    EventBus.on('game:over', ({ finalScore }) => this._pushLog(`ゲーム終了 score=${finalScore}`));
    EventBus.on('game:score-update', ({ delta }) => { if (delta) this._pushLog(`スコア ${delta > 0 ? '+' : ''}${delta}`); });

    // コンソールからも触れるように公開  例) __debug.app._score
    window.__debug = { app, ScoreManager, mode: this };

    const tick = () => { this._render(); setTimeout(tick, 200); };
    tick();
    console.info('[DebugMode] 有効: K=撃破 H=被弾 X=即死 G=無敵 0=通算リセット F1=パネル');
  }

  /** 無敵中はダメージを無視する(App._applyDamage から参照) */
  get invincible() { return this._invincible; }

  // ── キー操作 ─────────────────────────────────────────────

  _onKeyDown(e) {
    if (e.code === 'F1') {
      e.preventDefault();
      this._panel.hidden = !this._panel.hidden;
      return;
    }
    if (e.repeat) return;

    const app = this._app;
    const playing = app._state === 'playing';

    switch (e.code) {
      case 'KeyK':
        if (playing) this._killOneEnemy();
        break;
      case 'KeyH':
        if (playing) this._damage(Config.PLAYER.DAMAGE_PER_ENEMY);
        break;
      case 'KeyX':
        if (playing) this._damage(Infinity);
        break;
      case 'KeyG':
        this._invincible = !this._invincible;
        this._pushLog(`無敵 ${this._invincible ? 'ON' : 'OFF'}`);
        break;
      case 'Digit0':
        ScoreManager.resetStats();
        this._pushLog('通算記録リセット');
        break;
      default:
        return;
    }
    this._render();
  }

  /** アクティブな敵を1体本当に倒す(ウェーブ進行・エフェクトも通常どおり動く) */
  _killOneEnemy() {
    const enemy = this._app._enemySpawner.getEnemies().find((en) => en.isActive && !en.isDefeated);
    if (!enemy) {
      this._pushLog('倒せる敵がいない');
      return;
    }
    enemy.hit(Infinity);
  }

  /** 無敵を無視してダメージを与える(Xキーの即死を確実に通すため) */
  _damage(amount) {
    const prev = this._invincible;
    this._invincible = false;
    this._app._applyDamage(Math.min(amount, this._app._health));
    this._invincible = prev;
  }

  // ── 表示 ────────────────────────────────────────────────

  _showDesktopButton() {
    const btn = document.getElementById('btn-start-desktop');
    if (!btn) return;
    btn.textContent = 'PC TEST MODE';
    btn.style.display = 'block';
  }

  _createPanel() {
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.style.cssText = `
      position:fixed; top:8px; right:8px; z-index:1000;
      min-width:220px; padding:8px 10px; border-radius:6px;
      background:rgba(0,0,0,.72); color:#9f9; pointer-events:none;
      font:12px/1.5 ui-monospace,Consolas,monospace; white-space:pre;
    `;
    (document.getElementById('overlay') ?? document.body).appendChild(panel);
    this._panel = panel;
  }

  _pushLog(msg) {
    const t = new Date().toLocaleTimeString();
    this._log.unshift(`${t} ${msg}`);
    this._log.length = Math.min(this._log.length, 6);
  }

  _render() {
    if (this._panel.hidden) return;
    const app = this._app;
    const s = ScoreManager.stats;
    const active = app._enemySpawner.getEnemies().filter((en) => en.isActive && !en.isDefeated).length;
    this._panel.textContent = [
      '[DEBUG] F1で隠す',
      `state   : ${app._state}`,
      `score   : ${app._score}`,
      `hp      : ${app._health}/${Config.PLAYER.MAX_HEALTH}${this._invincible ? '  (無敵)' : ''}`,
      `wave    : ${app._enemySpawner.wave}   敵: ${active}`,
      `撃破/死亡: ${ScoreManager.kills} / ${ScoreManager.deaths}`,
      `通算     : 撃破 ${s.totalKills} / 死亡 ${s.totalDeaths} / ${s.plays}プレイ`,
      '',
      'K撃破 H被弾 X即死 G無敵 0通算リセット',
      '──────────',
      ...this._log,
    ].join('\n');
  }
}
