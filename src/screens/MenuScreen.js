/**
 * MenuScreen - スタート画面・リザルト画面の制御
 * ============================================================
 * 担当: メニュー画面担当メンバー
 *
 * 作業ガイド:
 *   - 見た目の変更は index.html の #menu-screen / #result-screen を変更
 *   - ボタンのテキストや色もHTMLで変更可能
 *   - showResult() でハイスコア記録機能などを追加できる
 *   - onStartXR / onStartDesktop コールバックはApp.jsから渡される(変更不要)
 *
 * このファイルで触るもの: このファイル + index.html のメニュー/リザルト部分
 * ============================================================
 */

export class MenuScreen {
  /**
   * @param {object} callbacks
   * @param {Function} callbacks.onStartXR      - ARモード開始ボタン
   * @param {Function} callbacks.onStartDesktop - デスクトップモード開始ボタン
   * @param {Function} callbacks.onRestart      - リスタートボタン
   * @param {Function} callbacks.onToMenu       - メニューへ戻るボタン
   */
  constructor(callbacks) {
    this._menuEl   = document.getElementById('menu-screen');
    this._resultEl = document.getElementById('result-screen');
    this._xrNotSupportedEl = document.getElementById('xr-not-supported');

    this._resultScoreEl     = document.getElementById('result-score');
    this._resultWaveValueEl = document.getElementById('result-wave-value');

    // ボタンへのコールバック設定
    document.getElementById('btn-start-xr')?.addEventListener('click', callbacks.onStartXR);
    document.getElementById('btn-start-desktop')?.addEventListener('click', callbacks.onStartDesktop);
    document.getElementById('btn-restart')?.addEventListener('click', callbacks.onRestart);
    document.getElementById('btn-to-menu')?.addEventListener('click', callbacks.onToMenu);

    this._highScore = Number(localStorage.getItem('mrShooterHighScore')) || 0;
  }

  /**
   * メニュー画面を表示する
   * @param {boolean} xrAvailable - WebXR ARが利用可能かどうか
   */
  showMenu(xrAvailable = true) {
    this._menuEl.style.display = 'flex';
    this._resultEl.style.display = 'none';

    const xrBtn = document.getElementById('btn-start-xr');
    if (!xrAvailable) {
      if (xrBtn) {
        xrBtn.disabled = true;
        xrBtn.style.opacity = '0.4';
        xrBtn.style.cursor = 'not-allowed';
      }
      if (this._xrNotSupportedEl) this._xrNotSupportedEl.style.display = 'block';
    } else {
      if (xrBtn) {
        xrBtn.disabled = false;
        xrBtn.style.opacity = '1';
        xrBtn.style.cursor = 'pointer';
      }
      if (this._xrNotSupportedEl) this._xrNotSupportedEl.style.display = 'none';
    }
  }

  /**
   * メニュー画面を非表示にする
   */
  hideMenu() {
    this._menuEl.style.display = 'none';
  }

  /**
   * リザルト画面を表示する
   * @param {number} finalScore - ゲーム終了時のスコア
   * @param {number} wave       - 到達したウェーブ数
   */
  showResult(finalScore, wave) {
    this._menuEl.style.display = 'none';
    this._resultEl.style.display = 'flex';

    // フェードイン演出を毎回再生させるため一旦クラスを外してから付け直す
    this._resultEl.classList.remove('show-anim');
    void this._resultEl.offsetWidth; // 強制リフロー
    this._resultEl.classList.add('show-anim');

    if (this._resultScoreEl) {
      this._resultScoreEl.textContent = finalScore.toLocaleString();
    }
    if (this._resultWaveValueEl) {
      this._resultWaveValueEl.textContent = wave;
    }

    // ハイスコア更新チェック(localStorageに永続化してセッションをまたいでも記録を保持する)
    if (finalScore > this._highScore) {
      this._highScore = finalScore;
      localStorage.setItem('mrShooterHighScore', String(finalScore));
      this._showHighScoreBadge(finalScore);
    }

    // TODO: ここにランキング機能やSNSシェア機能を追加できる
    //   例: navigator.share({ title: 'MR Shooter', text: `スコア: ${finalScore}` })
  }

  /**
   * リザルト画面を非表示にする
   */
  hideResult() {
    this._resultEl.style.display = 'none';
  }

  /**
   * ハイスコア更新バッジを表示する
   * TODO: このバッジのデザインを変えてみよう
   * @param {number} score
   */
  _showHighScoreBadge(score) {
    const existing = document.getElementById('highscore-badge');
    if (existing) existing.remove();

    const badge = document.createElement('div');
    badge.id = 'highscore-badge';
    badge.innerHTML = `NEW BEST!<br><small>${score.toLocaleString()}</small>`;
    badge.style.cssText = `
      position: absolute;
      top: 30%;
      right: 20%;
      background: linear-gradient(135deg, #f1c40f, #e67e22);
      color: #fff;
      padding: 0.8rem 1.2rem;
      border-radius: 8px;
      font-weight: bold;
      font-size: 1rem;
      text-align: center;
      animation: popIn 0.4s ease-out;
      pointer-events: none;
    `;

    if (!document.getElementById('pop-in-style')) {
      const style = document.createElement('style');
      style.id = 'pop-in-style';
      style.textContent = `
        @keyframes popIn {
          0%   { transform: scale(0); opacity: 0; }
          70%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); }
        }
      `;
      document.head.appendChild(style);
    }

    this._resultEl.appendChild(badge);
  }
}
