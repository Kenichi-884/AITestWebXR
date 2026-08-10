/**
 * SoundManager - 効果音・BGMの再生管理
 * ============================================================
 * 担当: サウンド・エフェクト担当メンバー
 *
 * 作業ガイド:
 *   - Web Audio API でプロシージャルに音を生成している(音声ファイル不要)
 *   - 音声ファイルを使いたい場合は _loadAudioFile() を参照
 *   - 新しいサウンドIDを追加するには _soundDefs に定義を追加するだけ
 *   - BGM はループするオシレーター音(差し替え可能)
 *
 * サウンドID一覧:
 *   'shoot'      - 射撃音
 *   'hit'        - 弾が敵にヒット
 *   'defeat'     - 敵撃破
 *   'player-hit' - プレイヤーがダメージを受けた
 *
 * このファイルで触るもの: このファイルのみ
 * ============================================================
 */

import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

export class SoundManager {
  constructor() {
    /** @type {AudioContext|null} */
    this._ctx = null;

    this._masterGain = null;
    this._bgmNode = null;
    this._initialized = false;

    // EventBusから音再生依頼を受け取る
    EventBus.on('sound:play', ({ id }) => this.play(id));
    EventBus.on('game:start', () => this._startBGM());
    EventBus.on('game:over', () => this._stopBGM());
  }

  /**
   * AudioContext を初期化する
   * NOTE: ブラウザポリシーにより、ユーザー操作後に呼ぶ必要がある
   */
  init() {
    if (this._initialized) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = Config.SOUND.MASTER_VOLUME;
      this._masterGain.connect(this._ctx.destination);
      this._initialized = true;
    } catch (e) {
      console.warn('[SoundManager] Web Audio API 初期化失敗:', e);
    }
  }

  /**
   * サウンドを再生する
   * @param {string} id
   */
  play(id) {
    if (!this._initialized || !this._ctx) return;

    switch (id) {
      case 'shoot':      this._playShoot(); break;
      case 'hit':        this._playHit(); break;
      case 'defeat':     this._playDefeat(); break;
      case 'player-hit': this._playPlayerHit(); break;
      default:
        console.warn(`[SoundManager] 未定義のサウンドID: "${id}"`);
    }
  }

  // ---- 各サウンド定義 ----
  // TODO: ここのパラメータを変えて音の高さ・長さ・波形をカスタマイズできる
  //   type: 'sine' | 'square' | 'sawtooth' | 'triangle'
  //   frequency: Hz (440 = ラ音)

  _playShoot() {
    this._playTone({
      type: 'square',
      frequency: 880,
      frequencyEnd: 220,
      duration: 0.12,
      volume: Config.SOUND.SHOOT_VOLUME,
      attack: 0.005,
      decay: 0.12,
    });
  }

  _playHit() {
    this._playTone({
      type: 'sine',
      frequency: 660,
      frequencyEnd: 330,
      duration: 0.1,
      volume: Config.SOUND.HIT_VOLUME,
      attack: 0.002,
      decay: 0.1,
    });
  }

  _playDefeat() {
    // 2音の連続で「ポン!」という爽快感
    this._playTone({ type: 'sine', frequency: 440, frequencyEnd: 880, duration: 0.15, volume: Config.SOUND.DEFEAT_VOLUME, attack: 0.01, decay: 0.15 });
    setTimeout(() => {
      this._playTone({ type: 'sine', frequency: 660, frequencyEnd: 1320, duration: 0.2, volume: Config.SOUND.DEFEAT_VOLUME, attack: 0.01, decay: 0.2 });
    }, 80);
  }

  _playPlayerHit() {
    this._playTone({
      type: 'sawtooth',
      frequency: 200,
      frequencyEnd: 80,
      duration: 0.3,
      volume: Config.SOUND.PLAYER_HIT_VOLUME,
      attack: 0.005,
      decay: 0.3,
    });
  }

  /**
   * プロシージャルトーン再生のユーティリティ
   * @param {object} opts
   */
  _playTone({ type, frequency, frequencyEnd, duration, volume, attack, decay }) {
    if (!this._ctx) return;
    const now = this._ctx.currentTime;

    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(frequencyEnd, now + duration);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

    osc.connect(gain);
    gain.connect(this._masterGain);

    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  /**
   * BGMを開始する
   * TODO: ここをカスタムBGMやファイル再生に差し替えられる
   */
  _startBGM() {
    if (!this._initialized || !this._ctx) return;
    this._stopBGM();

    // シンプルなアンビエント風ドローン音
    const frequencies = [55, 110, 165];
    this._bgmNodes = frequencies.map((freq) => {
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.04;
      osc.connect(gain);
      gain.connect(this._masterGain);
      osc.start();
      return { osc, gain };
    });
  }

  /**
   * BGMを停止する
   */
  _stopBGM() {
    if (!this._bgmNodes) return;
    for (const { osc } of this._bgmNodes) {
      try { osc.stop(); } catch (_) {}
    }
    this._bgmNodes = null;
  }

  /**
   * 音声ファイルを使う場合のテンプレート
   * TODO: 実際の音声ファイルがあればこちらを使う
   * @param {string} url
   * @returns {Promise<AudioBuffer>}
   */
  async _loadAudioFile(url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return this._ctx.decodeAudioData(arrayBuffer);
  }
}
