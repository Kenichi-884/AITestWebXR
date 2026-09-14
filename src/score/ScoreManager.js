/**
 * ScoreManager - コンボ・ボーナス計算とランク/称号判定
 * ============================================================
 * 担当: スコア担当メンバー
 *
 * 作業ガイド:
 *   - EventBus を購読して自己完結している(他モジュールから呼ばれない)
 *   - 表示用のDOMとCSSもこのファイル内で生成するため、HUD.js や
 *     MenuScreen.js を変更する必要はない
 *   - バランス調整は下の SCORE_CONFIG / RANKS の数値を変えるだけ
 *
 * 設計方針(重要):
 *   基本スコアの加算は App.js が担当しているため、このファイルは
 *   **基本スコアには一切触れない**。コンボによる上乗せ分を「ボーナス」として
 *   独立に集計し、リザルト画面で合算して表示する。
 *   こうすることで App.js との二重加算を避け、他担当のファイルを
 *   変更せずに機能を追加できる。
 *
 *   TODO: 将来 HUD のスコア表示にボーナスも含めたい場合は、
 *         App.js の `_addScore` をこちらに移す必要がある(エンジン担当と要相談)。
 *
 * 購読するイベント:
 *   game:start          - コンボ・ボーナスをリセット
 *   enemy:defeated      - コンボ加算 + コンボボーナス計算
 *   enemy:reached-player- 被弾でコンボが途切れる
 *   game:wave-update    - ウェーブ突破ボーナス / ノーダメージボーナス
 *   game:over           - ランク・称号を判定してリザルト画面に表示
 *
 * 発火するイベント(他の担当が拾えるように用意):
 *   score:combo-update  - コンボ更新   { combo, multiplier }
 *   score:bonus         - ボーナス獲得 { points, reason, total }
 *   score:rank          - ランク確定   { rank, title, baseScore, bonus, total, maxCombo }
 *
 * このファイルで触るもの: このファイル + index.html の <script> 1行のみ
 * ============================================================
 */

import EventBus from '../common/EventBus.js';

/** バランス調整用の数値。ここだけ変えれば挙動が変わる */
const SCORE_CONFIG = {
  COMBO_WINDOW_SEC:     2.5,   // この秒数以内に次を倒すとコンボ継続
  COMBO_RATE:           0.10,  // コンボ1つあたりの倍率上昇(0.10 = +10%)
  COMBO_MAX_MULTIPLIER: 3.0,   // 倍率の上限
  COMBO_MIN_TO_SHOW:    2,     // この数からコンボ表示を出す

  WAVE_CLEAR_BONUS:     200,   // ウェーブ突破ボーナス(突破したウェーブ数を掛ける)
  NO_DAMAGE_BONUS:      500,   // 被弾ゼロでウェーブを突破した場合の追加ボーナス

  POPUP_LIFETIME_MS:    900,   // ボーナス表示が消えるまで(ミリ秒)
};

/**
 * ランクと称号。min は「基本スコア + ボーナス」の合計に対するしきい値。
 * NOTE: 1体100点 × ウェーブ数、1ウェーブ10体なので
 *       ウェーブ3到達で約6,000点、ウェーブ5到達で約15,000点が目安。
 * TODO: プレイしてみて簡単すぎ/難しすぎたらこの数値を調整する
 */
const RANKS = [
  { min: 30000, rank: 'S', title: '英雄',         color: '#f1c40f' },
  { min: 15000, rank: 'A', title: '歴戦の狙撃手', color: '#e67e22' },
  { min:  6000, rank: 'B', title: '熟練兵',       color: '#3498db' },
  { min:  2000, rank: 'C', title: '見習い',       color: '#2ecc71' },
  { min:     0, rank: 'D', title: '新兵',         color: '#95a5a6' },
];

class ScoreManagerClass {
  constructor() {
    this._combo = 0;
    this._maxCombo = 0;
    this._bonusTotal = 0;
    this._comboTimer = null;
    this._damagedThisWave = false;
    this._wave = 1;

    this._styleInjected = false;
    this._comboEl = null;
    this._rankEl = null;

    EventBus.on('game:start', () => this._onGameStart());
    EventBus.on('enemy:defeated', (data) => this._onDefeated(data));
    EventBus.on('enemy:reached-player', () => this._onPlayerHit());
    EventBus.on('game:wave-update', ({ wave }) => this._onWaveUpdate(wave));
    EventBus.on('game:over', (data) => this._onGameOver(data));
  }

  // ── 外部から参照したい場合のゲッター ──────────────────────

  get combo() { return this._combo; }
  get maxCombo() { return this._maxCombo; }
  get bonusTotal() { return this._bonusTotal; }

  /** 現在のコンボ倍率 */
  get multiplier() {
    if (this._combo < 2) return 1.0;
    const m = 1 + (this._combo - 1) * SCORE_CONFIG.COMBO_RATE;
    return Math.min(SCORE_CONFIG.COMBO_MAX_MULTIPLIER, m);
  }

  // ── イベントハンドラ ─────────────────────────────────────

  _onGameStart() {
    this._combo = 0;
    this._maxCombo = 0;
    this._bonusTotal = 0;
    this._damagedThisWave = false;
    this._wave = 1;
    this._clearComboTimer();
    this._hideCombo();
    this._removeRankPanel();
  }

  /**
   * 敵を倒した: コンボを伸ばし、倍率ぶんをボーナスとして加算する
   * @param {{ score: number }} data App.js が基本スコアに加算するのと同じ値
   */
  _onDefeated({ score = 0 } = {}) {
    this._combo++;
    if (this._combo > this._maxCombo) this._maxCombo = this._combo;

    // 一定時間次を倒さなければコンボが途切れる
    this._clearComboTimer();
    this._comboTimer = setTimeout(
      () => this._breakCombo(),
      SCORE_CONFIG.COMBO_WINDOW_SEC * 1000,
    );

    const multiplier = this.multiplier;
    // 基本スコアは App.js が既に加算済みなので、上乗せ分だけを足す
    const bonus = Math.round(score * (multiplier - 1));
    if (bonus > 0) {
      this._addBonus(bonus, `${this._combo} COMBO`);
    }

    EventBus.emit('score:combo-update', { combo: this._combo, multiplier });
    this._renderCombo();
  }

  /** 被弾: コンボが途切れ、そのウェーブのノーダメージボーナスも失う */
  _onPlayerHit() {
    this._damagedThisWave = true;
    this._breakCombo();
  }

  /**
   * ウェーブが進んだ = 前のウェーブを突破した
   * NOTE: ゲーム開始時にも wave:1 が飛んでくるため、2以降の「進行」だけ扱う
   */
  _onWaveUpdate(wave) {
    if (wave > 1 && wave > this._wave) {
      const cleared = wave - 1;
      this._addBonus(SCORE_CONFIG.WAVE_CLEAR_BONUS * cleared, `WAVE ${cleared} CLEAR`);
      if (!this._damagedThisWave) {
        this._addBonus(SCORE_CONFIG.NO_DAMAGE_BONUS, 'NO DAMAGE');
      }
    }
    this._damagedThisWave = false;
    this._wave = wave;
  }

  /** ゲーム終了: 合計からランクを決めてリザルト画面に差し込む */
  _onGameOver({ finalScore = 0 } = {}) {
    this._clearComboTimer();
    this._combo = 0;
    this._hideCombo();

    const total = finalScore + this._bonusTotal;
    const entry = RANKS.find((r) => total >= r.min) ?? RANKS[RANKS.length - 1];

    EventBus.emit('score:rank', {
      rank: entry.rank,
      title: entry.title,
      baseScore: finalScore,
      bonus: this._bonusTotal,
      total,
      maxCombo: this._maxCombo,
    });

    this._renderRankPanel(entry, finalScore, total);
  }

  // ── 内部処理 ────────────────────────────────────────────

  _addBonus(points, reason) {
    this._bonusTotal += points;
    EventBus.emit('score:bonus', { points, reason, total: this._bonusTotal });
    this._showBonusPopup(points, reason);
  }

  _breakCombo() {
    this._clearComboTimer();
    if (this._combo === 0) return;
    this._combo = 0;
    EventBus.emit('score:combo-update', { combo: 0, multiplier: 1.0 });
    this._hideCombo();
  }

  _clearComboTimer() {
    if (this._comboTimer !== null) {
      clearTimeout(this._comboTimer);
      this._comboTimer = null;
    }
  }

  // ── 表示(DOMもCSSもここで作るので他ファイルの変更が不要) ──────

  /** 表示先。XRのdom-overlayルートを優先し、無ければbody */
  _root() {
    return document.getElementById('overlay') ?? document.body;
  }

  /** CSSを一度だけ差し込む */
  _ensureStyle() {
    if (this._styleInjected || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.id = 'score-manager-style';
    style.textContent = `
      #score-combo {
        position: absolute; top: 4.5rem; left: 50%;
        transform: translateX(-50%);
        font-weight: bold; text-align: center; pointer-events: none;
        color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,.6);
        display: none; z-index: 20;
      }
      #score-combo .sc-count { font-size: 2rem; line-height: 1; }
      #score-combo .sc-mult  { font-size: 1rem; color: #f1c40f; }
      #score-combo.sc-pop { animation: scPop .25s ease-out; }
      @keyframes scPop {
        0%   { transform: translateX(-50%) scale(1.35); }
        100% { transform: translateX(-50%) scale(1); }
      }
      .sc-bonus {
        position: absolute; left: 50%; top: 8.5rem;
        transform: translateX(-50%);
        font-weight: bold; font-size: 1.1rem; color: #f1c40f;
        text-shadow: 0 2px 8px rgba(0,0,0,.6);
        pointer-events: none; z-index: 20;
        animation: scFloat ${SCORE_CONFIG.POPUP_LIFETIME_MS}ms ease-out forwards;
      }
      @keyframes scFloat {
        0%   { opacity: 0; transform: translate(-50%, 10px); }
        15%  { opacity: 1; transform: translate(-50%, 0); }
        100% { opacity: 0; transform: translate(-50%, -40px); }
      }
      #score-rank {
        display: flex; flex-direction: column; align-items: center;
        gap: .25rem; margin: .5rem 0 1rem;
      }
      #score-rank .sr-badge {
        font-size: 3rem; font-weight: bold; line-height: 1;
        animation: scPopIn .4s ease-out;
      }
      #score-rank .sr-title { font-size: 1.1rem; opacity: .9; }
      #score-rank .sr-detail {
        font-size: .85rem; opacity: .75; margin-top: .4rem;
        line-height: 1.6; text-align: center;
      }
      @keyframes scPopIn {
        0%   { opacity: 0; transform: scale(.5); }
        100% { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
    this._styleInjected = true;
  }

  _renderCombo() {
    if (typeof document === 'undefined') return;
    if (this._combo < SCORE_CONFIG.COMBO_MIN_TO_SHOW) return;
    this._ensureStyle();

    if (!this._comboEl) {
      this._comboEl = document.createElement('div');
      this._comboEl.id = 'score-combo';
      this._root().appendChild(this._comboEl);
    }
    this._comboEl.innerHTML =
      `<div class="sc-count">${this._combo} COMBO</div>` +
      `<div class="sc-mult">× ${this.multiplier.toFixed(1)}</div>`;
    this._comboEl.style.display = 'block';

    // アニメーションを再生し直すためクラスを付け直す
    this._comboEl.classList.remove('sc-pop');
    void this._comboEl.offsetWidth;
    this._comboEl.classList.add('sc-pop');
  }

  _hideCombo() {
    if (this._comboEl) this._comboEl.style.display = 'none';
  }

  _showBonusPopup(points, reason) {
    if (typeof document === 'undefined') return;
    this._ensureStyle();

    const el = document.createElement('div');
    el.className = 'sc-bonus';
    el.textContent = `+${points.toLocaleString()}  ${reason}`;
    this._root().appendChild(el);
    setTimeout(() => el.remove(), SCORE_CONFIG.POPUP_LIFETIME_MS);
  }

  /**
   * リザルト画面にランクを差し込む。
   * NOTE: #result-screen は最初からDOMに存在し(非表示なだけ)、MenuScreen は
   *       中身を消さずに textContent を書き換えるだけなので、ここで先に
   *       追加しておけば表示されたタイミングで一緒に出る。
   */
  _renderRankPanel(entry, baseScore, total) {
    if (typeof document === 'undefined') return;
    const result = document.getElementById('result-screen');
    if (!result) return;
    this._ensureStyle();
    this._removeRankPanel();

    const el = document.createElement('div');
    el.id = 'score-rank';
    el.innerHTML =
      `<div class="sr-badge" style="color:${entry.color}">RANK ${entry.rank}</div>` +
      `<div class="sr-title">${entry.title}</div>` +
      `<div class="sr-detail">` +
        `基本 ${baseScore.toLocaleString()} + ボーナス ${this._bonusTotal.toLocaleString()}` +
        ` = <strong>${total.toLocaleString()}</strong><br>` +
        `最大コンボ ${this._maxCombo}` +
      `</div>`;

    // 「もう一度」ボタンの直前に入れる(無ければ末尾)
    const restart = document.getElementById('btn-restart');
    if (restart) result.insertBefore(el, restart);
    else result.appendChild(el);
    this._rankEl = el;
  }

  _removeRankPanel() {
    const existing = this._rankEl ?? document.getElementById('score-rank');
    if (existing) existing.remove();
    this._rankEl = null;
  }
}

/**
 * このモジュールを import した時点で購読が始まる。
 * index.html から <script type="module" src="/src/score/ScoreManager.js"> で
 * 読み込むだけでよく、App.js から呼び出す必要はない。
 */
const ScoreManager = new ScoreManagerClass();
export default ScoreManager;
