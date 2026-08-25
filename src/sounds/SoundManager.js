/**
 * SoundManager - 効果音・BGMの再生管理
 * ============================================================
 * 担当: サウンド・エフェクト担当メンバー
 *
 * 作業ガイド:
 *   - Web Audio API でプロシージャルに音を生成している(音声ファイル不要)
 *   - 新しいサウンドIDを追加するには _soundDefs に定義を追加するだけ
 *   - 音の調整は「レイヤー」の数値を変えるだけでOK(下の「音の作り方」参照)
 *   - BGM はスケールに沿ったアルペジオを自動生成(ウェーブが進むとテンポUP)
 *   - 音声ファイルに差し替えたい場合は preload() / setBGMFile() を使う
 *
 * サウンドID一覧:
 *   'shoot'      - 射撃(ロケットランチャー)  (Weapon.js から発火)
 *   'hit'        - 着弾(小さめの炸裂)        (Enemy.js から発火)
 *   'defeat'     - 撃破(爆発)               (Enemy.js から発火)
 *   'player-hit' - プレイヤーがダメージ      (Enemy.js から発火)
 *   'reload'     - リロード                 (Weapon.js から発火)
 *   'game-start' - 冒険の始まりファンファーレ (game:start を自前で購読)
 *   'game-over'  - RPGエンディング風         (game:over を自前で購読)
 *   'wave-up'    - ウェーブ進行ファンファーレ (game:wave-update を自前で購読)
 *   'spawn'      - 敵スポーン              (enemy:spawned を自前で購読)
 *   'empty'      - 弾切れ時の空撃ち        (未使用 / 手動で play('empty') 可)
 *
 * 音の作り方(_playTone の1レイヤー):
 *   type      : 'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise'
 *   freq      : 開始周波数 Hz (440 = ラ音)
 *   freqEnd   : 終了周波数 Hz (省略で変化なし。下げると「ピュン」上げると「ポン」)
 *   duration  : 音の長さ(秒)
 *   volume    : 音量 0.0〜1.0
 *   attack    : 立ち上がり(秒) 小さいほど鋭い
 *   decay     : 減衰(秒) 省略時は duration と同じ
 *   delay     : この音を鳴らすまでの待ち(秒) ─ 複数レイヤーで和音・連打を作る
 *   filter    : { type, freq, freqEnd, Q } 音の明るさを削る(lowpass推奨)
 *
 * このファイルで触るもの: このファイルのみ
 * ============================================================
 */

import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

/**
 * Config.SOUND に無い音量・パラメータはここで定義する。
 * NOTE: Config.js は全モジュール共有のため、サウンド専用の値はこちらで持つ。
 */
const SOUND_CONFIG = {
  RELOAD_VOLUME:     0.50,
  GAME_START_VOLUME: 0.70,
  GAME_OVER_VOLUME:  0.85,
  WAVE_UP_VOLUME:    0.70,
  SPAWN_VOLUME:      0.30,
  EMPTY_VOLUME:      0.45,

  BGM_VOLUME:        0.35,   // BGM全体の音量(効果音とは独立)
  BGM_FADE_IN:       1.50,   // BGMのフェードイン(秒)
  BGM_FADE_OUT:      0.80,   // BGMのフェードアウト(秒)
  BGM_STEP_SEC:      0.30,   // 1ステップの長さ(秒) 小さいほど速い
  BGM_MIN_STEP_SEC:  0.16,   // テンポ上昇の下限
  BGM_SPEEDUP_PER_WAVE: 0.04, // ウェーブごとのテンポ上昇率

  MAX_VOICES:        32,     // 同時発音数の上限(連射時の音割れ防止)
};

/** BGMのルート音(A1)と、使用するスケール(マイナーペンタトニック) */
const BGM_ROOT_HZ = 55;
const BGM_SCALE = [0, 3, 5, 7, 10];
/** アルペジオのパターン(BGM_SCALE のインデックス。-1 は休符) */
const BGM_ARP_PATTERN = [0, 2, 4, 2, 3, -1, 4, 1, 0, 3, 2, -1, 4, 2, 1, -1];
/** ベースのパターン(4ステップに1回鳴る) */
const BGM_BASS_PATTERN = [0, 0, 3, 2];

export class SoundManager {
  constructor() {
    /** @type {AudioContext|null} */
    this._ctx = null;

    this._masterGain = null;
    this._sfxGain = null;
    this._sfxComp = null;
    this._bgmGain = null;
    this._initialized = false;
    this._muted = false;

    /** ノイズ系サウンド用の共有バッファ */
    this._noiseBuffer = null;

    /** 同時発音数カウンタ */
    this._activeVoices = 0;

    /** 音声ファイルのキャッシュ { id => AudioBuffer } */
    this._buffers = new Map();
    /** init前にpreloadされた生データ { id => ArrayBuffer } */
    this._pendingBuffers = new Map();

    /** BGM関連 */
    this._bgmNodes = null;        // ドローン音のオシレーター群
    this._bgmTimer = null;        // シーケンサーのタイマー
    this._bgmStep = 0;
    this._bgmNextTime = 0;
    this._bgmBuffer = null;       // 音声ファイルBGMを使う場合のバッファ
    this._bgmSource = null;       // 同上の再生ノード
    this._bgmPlaying = false;

    /** ウェーブ進行の検知用 */
    this._wave = 1;

    this._soundDefs = this._createSoundDefs();

    // ---- EventBus購読 ----
    // NOTE: 他ファイルを変更せずに音を増やすため、
    //       'sound:play' 以外のゲームイベントもここで直接拾っている。
    EventBus.on('sound:play', ({ id }) => this.play(id));

    EventBus.on('game:start', () => {
      this._wave = 1;
      this.play('game-start');
      this._startBGM();
    });

    EventBus.on('game:over', () => {
      this._stopBGM();
      this.play('game-over');
    });

    EventBus.on('game:wave-update', ({ wave }) => {
      // ゲーム開始時にも wave:1 が飛んでくるため、2以降の「進行」だけ鳴らす
      if (wave > 1 && wave > this._wave) this.play('wave-up');
      this._wave = wave;
    });

    EventBus.on('enemy:spawned', () => this.play('spawn'));
  }

  // ── 初期化 ───────────────────────────────────────────────

  /**
   * AudioContext を初期化する
   * NOTE: ブラウザポリシーにより、ユーザー操作後に呼ぶ必要がある
   */
  init() {
    if (this._initialized) {
      // 一度サスペンドされた場合に備えて毎回resumeを試みる
      this._ctx?.resume?.().catch(() => {});
      return;
    }
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();

      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = Config.SOUND.MASTER_VOLUME;
      this._masterGain.connect(this._ctx.destination);

      // 効果音とBGMを別系統にして、片方だけ音量調整できるようにする。
      // 効果音側はコンプレッサーを通す: 爆発やロケット発射音はレイヤーが多く
      // 波形が振り切れて歪みやすいため、ピークだけを抑えて迫力を保つ。
      // BGMには掛けない(BGMが効果音に引きずられて音量変動するのを避けるため)。
      this._sfxComp = this._ctx.createDynamicsCompressor();
      // NOTE: 強く掛けると爆発も小さい音も同じ音量まで潰れて強弱が失われる。
      //       ここでは素の音量を1.0前後に収めた上で、振り切れだけを抑える穏やかな設定。
      this._sfxComp.threshold.value = -6;
      this._sfxComp.knee.value = 10;
      this._sfxComp.ratio.value = 3;
      this._sfxComp.attack.value = 0.003;
      this._sfxComp.release.value = 0.15;
      this._sfxComp.connect(this._masterGain);

      this._sfxGain = this._ctx.createGain();
      this._sfxGain.gain.value = 1.0;
      this._sfxGain.connect(this._sfxComp);

      this._bgmGain = this._ctx.createGain();
      this._bgmGain.gain.value = 0.0;   // 開始時にフェードインさせる
      this._bgmGain.connect(this._masterGain);

      this._noiseBuffer = this._createNoiseBuffer();
      this._initialized = true;

      // ユーザー操作前にpreload()されていた音をここでデコードする
      this._flushPendingBuffers();

      // 自動再生ポリシーで suspended 状態で生成されることがある
      this._ctx.resume?.().catch(() => {});
    } catch (e) {
      console.warn('[SoundManager] Web Audio API 初期化失敗:', e);
    }
  }

  /** 初期化済みかどうか */
  get isReady() {
    return this._initialized;
  }

  // ── 再生 ────────────────────────────────────────────────

  /**
   * サウンドを再生する
   * @param {string} id
   */
  play(id) {
    if (!this._initialized || !this._ctx || this._muted) return;

    // 音声ファイルが登録されていればそちらを優先する
    if (this._buffers.has(id)) {
      this._playBuffer(this._buffers.get(id), this._volumeForId(id));
      return;
    }

    const layers = this._soundDefs[id];
    if (!layers) {
      console.warn(`[SoundManager] 未定義のサウンドID: "${id}"`);
      return;
    }

    const now = this._ctx.currentTime;
    for (const layer of layers) {
      this._playTone(layer, now);
    }
  }

  // ── 各サウンド定義 ───────────────────────────────────────
  // TODO: ここの数値を変えて音をカスタマイズできる。
  //       配列の要素1つ=1レイヤーで、delay を付けると連続音・和音になる。

  _createSoundDefs() {
    const V = Config.SOUND;
    const S = SOUND_CONFIG;

    return {
      // 射撃: ロケットランチャー。発射の「ドンッ」+ 弾が飛び去るシューという抜け
      // NOTE: 連射クールダウンが0.3秒(Config.WEAPON.COOLDOWN)のため、
      //       音が濁らないよう全体を0.35秒以内に収めている。
      'shoot': [
        // 発射の衝撃(サブベース)
        { type: 'sine', freq: 170, freqEnd: 42,
          duration: 0.30, volume: V.SHOOT_VOLUME * 0.81,
          attack: 0.002, decay: 0.28 },
        // 発射音の芯(歪んだ低音)
        { type: 'sawtooth', freq: 340, freqEnd: 55,
          duration: 0.26, volume: V.SHOOT_VOLUME * 0.43,
          attack: 0.002, decay: 0.24,
          filter: { type: 'lowpass', freq: 2600, freqEnd: 240, Q: 5 } },
        // 発射炎の破裂
        { type: 'noise', freq: 1600,
          duration: 0.13, volume: V.SHOOT_VOLUME * 0.47,
          attack: 0.001, decay: 0.13,
          filter: { type: 'lowpass', freq: 5200, freqEnd: 700, Q: 1 } },
        // ロケットが遠ざかっていくシュー音(帯域を下げて距離感を出す)
        { type: 'noise', freq: 900,
          duration: 0.34, volume: V.SHOOT_VOLUME * 0.27,
          attack: 0.03, decay: 0.34, delay: 0.04,
          filter: { type: 'bandpass', freq: 2800, freqEnd: 700, Q: 1.2 } },
      ],

      // ヒット: 着弾したが撃破に至らなかった場合。小さめの炸裂で手応えを出す
      'hit': [
        { type: 'sine', freq: 220, freqEnd: 65,
          duration: 0.20, volume: V.HIT_VOLUME * 0.43,
          attack: 0.002, decay: 0.19 },
        { type: 'noise', freq: 900,
          duration: 0.18, volume: V.HIT_VOLUME * 0.35,
          attack: 0.001, decay: 0.18,
          filter: { type: 'lowpass', freq: 3000, freqEnd: 320, Q: 1 } },
      ],

      // 撃破: 爆発。バリッという破裂 → 爆風 → 地響き → 破片が散る余韻の4段構成
      'defeat': [
        // 破裂の立ち上がり(高域のバリッという成分)
        { type: 'noise', freq: 2600,
          duration: 0.10, volume: V.DEFEAT_VOLUME * 0.30,
          attack: 0.001, decay: 0.10,
          filter: { type: 'highpass', freq: 2400 } },
        // 爆風の本体(高域から低域へ一気に落とす)
        { type: 'noise', freq: 1100,
          duration: 0.55, volume: V.DEFEAT_VOLUME * 0.53,
          attack: 0.002, decay: 0.55,
          filter: { type: 'lowpass', freq: 5500, freqEnd: 170, Q: 1.2 } },
        // 地響き(サブベース)
        { type: 'sine', freq: 115, freqEnd: 28,
          duration: 0.60, volume: V.DEFEAT_VOLUME * 0.57,
          attack: 0.004, decay: 0.60 },
        // 破片が散る余韻
        { type: 'noise', freq: 500,
          duration: 0.75, volume: V.DEFEAT_VOLUME * 0.19,
          attack: 0.06, decay: 0.75, delay: 0.10,
          filter: { type: 'lowpass', freq: 1000, freqEnd: 220, Q: 0.7 } },
      ],

      // 被弾: 濁った低音で「やられた」感。少し長めに残す
      'player-hit': [
        {
          type: 'sawtooth', freq: 200, freqEnd: 70,
          duration: 0.35, volume: V.PLAYER_HIT_VOLUME * 0.55,
          attack: 0.004, decay: 0.35,
          filter: { type: 'lowpass', freq: 1200, freqEnd: 200, Q: 6 },
        },
        {
          type: 'square', freq: 90, freqEnd: 45,
          duration: 0.40, volume: V.PLAYER_HIT_VOLUME * 0.30,
          attack: 0.004, decay: 0.40,
        },
        {
          type: 'noise', freq: 400,
          duration: 0.25, volume: V.PLAYER_HIT_VOLUME * 0.25,
          attack: 0.002, decay: 0.25,
          filter: { type: 'lowpass', freq: 900, Q: 1 },
        },
      ],

      // リロード: 「カチャッ…ガチャン」の2段構成
      'reload': [
        {
          type: 'noise', freq: 600,
          duration: 0.07, volume: S.RELOAD_VOLUME * 0.6,
          attack: 0.001, decay: 0.07,
          filter: { type: 'bandpass', freq: 1800, Q: 2 },
        },
        {
          type: 'square', freq: 320, freqEnd: 180,
          duration: 0.08, volume: S.RELOAD_VOLUME * 0.35,
          attack: 0.002, decay: 0.08,
          filter: { type: 'lowpass', freq: 1500 },
        },
        {
          type: 'noise', freq: 500,
          duration: 0.10, volume: S.RELOAD_VOLUME * 0.7,
          attack: 0.001, decay: 0.10, delay: 0.28,
          filter: { type: 'bandpass', freq: 1100, Q: 1.5 },
        },
        {
          type: 'square', freq: 220, freqEnd: 120,
          duration: 0.12, volume: S.RELOAD_VOLUME * 0.40,
          attack: 0.002, decay: 0.12, delay: 0.28,
          filter: { type: 'lowpass', freq: 1200 },
        },
      ],

      // 開始: 冒険の始まりを告げるファンファーレ(約2.3秒)。
      // 期待感を煽る立ち上がり → 上昇アルペジオ → 明るく開ける主和音。
      // NOTE: ブラウザの制約でAudioContextはユーザー操作後にしか音を出せないため、
      //       メニュー表示の瞬間ではなくスタートボタンを押した時点で鳴る。
      'game-start': [
        // サーッと持ち上がる立ち上がり
        { type: 'noise', freq: 500, duration: 0.50, volume: S.GAME_START_VOLUME * 0.20,
          attack: 0.24, decay: 0.50,
          filter: { type: 'bandpass', freq: 400, freqEnd: 5000, Q: 0.7 } },

        // 上昇アルペジオ C - E - G (ブラス風)
        { type: 'sawtooth', freq: 523, duration: 0.16, volume: S.GAME_START_VOLUME * 0.30,
          attack: 0.008, decay: 0.16, delay: 0.42, filter: { type: 'lowpass', freq: 2800, Q: 1 } },
        { type: 'sawtooth', freq: 659, duration: 0.16, volume: S.GAME_START_VOLUME * 0.30,
          attack: 0.008, decay: 0.16, delay: 0.56, filter: { type: 'lowpass', freq: 3000, Q: 1 } },
        { type: 'sawtooth', freq: 784, duration: 0.16, volume: S.GAME_START_VOLUME * 0.30,
          attack: 0.008, decay: 0.16, delay: 0.70, filter: { type: 'lowpass', freq: 3200, Q: 1 } },

        // 到達点の主和音(ここで一気に視界が開ける)
        { type: 'sawtooth', freq: 1047, duration: 1.30, volume: S.GAME_START_VOLUME * 0.34,
          attack: 0.012, decay: 1.30, delay: 0.84,
          filter: { type: 'lowpass', freq: 3600, freqEnd: 1400, Q: 1 } },
        { type: 'triangle', freq: 659, duration: 1.30, volume: S.GAME_START_VOLUME * 0.20, attack: 0.02, decay: 1.30, delay: 0.84 },
        { type: 'triangle', freq: 784, duration: 1.30, volume: S.GAME_START_VOLUME * 0.20, attack: 0.02, decay: 1.30, delay: 0.84 },
        { type: 'sine',     freq: 2093, duration: 1.20, volume: S.GAME_START_VOLUME * 0.10, attack: 0.03, decay: 1.20, delay: 0.86 },

        // 足元を支えるベースと、開幕のインパクト
        { type: 'sine', freq: 131, duration: 1.50, volume: S.GAME_START_VOLUME * 0.45, attack: 0.02, decay: 1.50, delay: 0.84 },
        { type: 'noise', freq: 900, duration: 0.35, volume: S.GAME_START_VOLUME * 0.30,
          attack: 0.001, decay: 0.35, delay: 0.84,
          filter: { type: 'lowpass', freq: 4000, freqEnd: 300, Q: 1 } },
      ],

      // 終了: RPGのエンディング風(約5秒)。C - F - G - C のゆったりした進行に
      // ベル系のメロディを重ね、最後は主和音に解決して余韻を残す。
      // NOTE: このゲームに「クリア」状態は無く、game:over(HP0 / セッション終了)で鳴る。
      //       リザルト画面(1秒後に表示)に被せて流れる想定。
      'game-over': [
        // --- ベース: C - F - G - C ---
        { type: 'sine', freq: 131, duration: 1.00, volume: S.GAME_OVER_VOLUME * 0.45, attack: 0.03, decay: 1.00, delay: 0.00 },
        { type: 'sine', freq: 175, duration: 1.00, volume: S.GAME_OVER_VOLUME * 0.45, attack: 0.03, decay: 1.00, delay: 1.05 },
        { type: 'sine', freq: 196, duration: 1.00, volume: S.GAME_OVER_VOLUME * 0.45, attack: 0.03, decay: 1.00, delay: 2.10 },
        { type: 'sine', freq: 131, duration: 2.00, volume: S.GAME_OVER_VOLUME * 0.50, attack: 0.03, decay: 2.00, delay: 3.15 },

        // --- 和音パッド(上のベースに乗る三和音) ---
        { type: 'triangle', freq: 262, duration: 1.00, volume: S.GAME_OVER_VOLUME * 0.14, attack: 0.06, decay: 1.00, delay: 0.00, filter: { type: 'lowpass', freq: 1800 } },
        { type: 'triangle', freq: 330, duration: 1.00, volume: S.GAME_OVER_VOLUME * 0.14, attack: 0.06, decay: 1.00, delay: 0.00, filter: { type: 'lowpass', freq: 1800 } },
        { type: 'triangle', freq: 392, duration: 1.00, volume: S.GAME_OVER_VOLUME * 0.14, attack: 0.06, decay: 1.00, delay: 0.00, filter: { type: 'lowpass', freq: 1800 } },
        { type: 'triangle', freq: 262, duration: 1.00, volume: S.GAME_OVER_VOLUME * 0.14, attack: 0.06, decay: 1.00, delay: 1.05, filter: { type: 'lowpass', freq: 1800 } },
        { type: 'triangle', freq: 349, duration: 1.00, volume: S.GAME_OVER_VOLUME * 0.14, attack: 0.06, decay: 1.00, delay: 1.05, filter: { type: 'lowpass', freq: 1800 } },
        { type: 'triangle', freq: 440, duration: 1.00, volume: S.GAME_OVER_VOLUME * 0.14, attack: 0.06, decay: 1.00, delay: 1.05, filter: { type: 'lowpass', freq: 1800 } },
        { type: 'triangle', freq: 247, duration: 1.00, volume: S.GAME_OVER_VOLUME * 0.14, attack: 0.06, decay: 1.00, delay: 2.10, filter: { type: 'lowpass', freq: 1800 } },
        { type: 'triangle', freq: 294, duration: 1.00, volume: S.GAME_OVER_VOLUME * 0.14, attack: 0.06, decay: 1.00, delay: 2.10, filter: { type: 'lowpass', freq: 1800 } },
        { type: 'triangle', freq: 392, duration: 1.00, volume: S.GAME_OVER_VOLUME * 0.14, attack: 0.06, decay: 1.00, delay: 2.10, filter: { type: 'lowpass', freq: 1800 } },
        { type: 'triangle', freq: 262, duration: 2.00, volume: S.GAME_OVER_VOLUME * 0.16, attack: 0.06, decay: 2.00, delay: 3.15, filter: { type: 'lowpass', freq: 1800 } },
        { type: 'triangle', freq: 330, duration: 2.00, volume: S.GAME_OVER_VOLUME * 0.16, attack: 0.06, decay: 2.00, delay: 3.15, filter: { type: 'lowpass', freq: 1800 } },
        { type: 'triangle', freq: 392, duration: 2.00, volume: S.GAME_OVER_VOLUME * 0.16, attack: 0.06, decay: 2.00, delay: 3.15, filter: { type: 'lowpass', freq: 1800 } },

        // --- メロディ(ベル) E-G-A-G-F-E-D-C と下りて主音に着地 ---
        { type: 'triangle', freq: 659, duration: 0.50, volume: S.GAME_OVER_VOLUME * 0.30, attack: 0.010, decay: 0.50, delay: 0.10, filter: { type: 'lowpass', freq: 3200 } },
        { type: 'triangle', freq: 784, duration: 0.50, volume: S.GAME_OVER_VOLUME * 0.30, attack: 0.010, decay: 0.50, delay: 0.55, filter: { type: 'lowpass', freq: 3200 } },
        { type: 'triangle', freq: 880, duration: 0.55, volume: S.GAME_OVER_VOLUME * 0.32, attack: 0.010, decay: 0.55, delay: 1.15, filter: { type: 'lowpass', freq: 3400 } },
        { type: 'triangle', freq: 784, duration: 0.45, volume: S.GAME_OVER_VOLUME * 0.30, attack: 0.010, decay: 0.45, delay: 1.65, filter: { type: 'lowpass', freq: 3200 } },
        { type: 'triangle', freq: 698, duration: 0.45, volume: S.GAME_OVER_VOLUME * 0.30, attack: 0.010, decay: 0.45, delay: 2.20, filter: { type: 'lowpass', freq: 3200 } },
        { type: 'triangle', freq: 659, duration: 0.45, volume: S.GAME_OVER_VOLUME * 0.30, attack: 0.010, decay: 0.45, delay: 2.65, filter: { type: 'lowpass', freq: 3200 } },
        { type: 'triangle', freq: 587, duration: 0.30, volume: S.GAME_OVER_VOLUME * 0.28, attack: 0.010, decay: 0.30, delay: 3.00, filter: { type: 'lowpass', freq: 3000 } },
        // 主音に解決して長く伸ばす + 上のオクターブでキラッと余韻を残す
        { type: 'triangle', freq: 523, duration: 1.70, volume: S.GAME_OVER_VOLUME * 0.34, attack: 0.012, decay: 1.70, delay: 3.25, filter: { type: 'lowpass', freq: 3000 } },
        { type: 'sine',     freq: 1047, duration: 1.80, volume: S.GAME_OVER_VOLUME * 0.12, attack: 0.030, decay: 1.80, delay: 3.25 },
      ],

      // ウェーブ進行: 短いファンファーレ
      'wave-up': [
        { type: 'square', freq: 523, duration: 0.10, volume: S.WAVE_UP_VOLUME * 0.35, attack: 0.005, decay: 0.10, delay: 0.00, filter: { type: 'lowpass', freq: 3000 } },
        { type: 'square', freq: 659, duration: 0.10, volume: S.WAVE_UP_VOLUME * 0.35, attack: 0.005, decay: 0.10, delay: 0.09, filter: { type: 'lowpass', freq: 3000 } },
        { type: 'square', freq: 784, duration: 0.10, volume: S.WAVE_UP_VOLUME * 0.35, attack: 0.005, decay: 0.10, delay: 0.18, filter: { type: 'lowpass', freq: 3000 } },
        { type: 'square', freq: 1047, duration: 0.35, volume: S.WAVE_UP_VOLUME * 0.45, attack: 0.005, decay: 0.35, delay: 0.27, filter: { type: 'lowpass', freq: 3500 } },
      ],

      // スポーン: 存在を知らせる控えめな低いブリップ
      'spawn': [
        {
          type: 'sine', freq: 180, freqEnd: 320,
          duration: 0.16, volume: S.SPAWN_VOLUME * 0.8,
          attack: 0.02, decay: 0.16,
          filter: { type: 'lowpass', freq: 900 },
        },
      ],

      // 弾切れ: 乾いたカチッという空撃ち音
      'empty': [
        {
          type: 'noise', freq: 400,
          duration: 0.05, volume: S.EMPTY_VOLUME * 0.8,
          attack: 0.001, decay: 0.05,
          filter: { type: 'bandpass', freq: 2500, Q: 3 },
        },
      ],

      // パワーアップ取得: 上昇する3音ジングル
      'powerup': [
        { type: 'square', freq: 523, duration: 0.10, volume: 0.40,
          attack: 0.005, decay: 0.10, delay: 0.00,
          filter: { type: 'lowpass', freq: 3000 } },
        { type: 'square', freq: 784, duration: 0.10, volume: 0.40,
          attack: 0.005, decay: 0.10, delay: 0.09,
          filter: { type: 'lowpass', freq: 3000 } },
        { type: 'square', freq: 1047, duration: 0.28, volume: 0.50,
          attack: 0.005, decay: 0.28, delay: 0.18,
          filter: { type: 'lowpass', freq: 3500 } },
        { type: 'sine', freq: 2093, duration: 0.22, volume: 0.15,
          attack: 0.01, decay: 0.22, delay: 0.20 },
      ],
    };
  }

  /** 音声ファイル再生時に使う、IDごとの音量 */
  _volumeForId(id) {
    const V = Config.SOUND;
    switch (id) {
      case 'shoot':      return V.SHOOT_VOLUME;
      case 'hit':        return V.HIT_VOLUME;
      case 'defeat':     return V.DEFEAT_VOLUME;
      case 'player-hit': return V.PLAYER_HIT_VOLUME;
      case 'reload':     return SOUND_CONFIG.RELOAD_VOLUME;
      case 'game-start': return SOUND_CONFIG.GAME_START_VOLUME;
      case 'game-over':  return SOUND_CONFIG.GAME_OVER_VOLUME;
      case 'wave-up':    return SOUND_CONFIG.WAVE_UP_VOLUME;
      case 'spawn':      return SOUND_CONFIG.SPAWN_VOLUME;
      case 'empty':      return SOUND_CONFIG.EMPTY_VOLUME;
      default:           return 0.8;
    }
  }

  // ── 音声合成のコア ────────────────────────────────────────

  /**
   * 1レイヤー分のトーンを再生する
   * @param {object} opts   レイヤー定義(ファイル冒頭「音の作り方」参照)
   * @param {number} [when] 再生開始時刻(AudioContextの時間軸)。省略で即時
   * @param {AudioNode} [dest] 出力先。省略で効果音バス
   */
  _playTone(opts, when = null, dest = null) {
    if (!this._ctx) return;
    // 同時発音数の上限は効果音のみに適用する。
    // BGMにも掛けると、連射中に音符が間引かれて曲が途切れてしまうため。
    const isBGM = dest === this._bgmGain;
    if (!isBGM && this._activeVoices >= SOUND_CONFIG.MAX_VOICES) return;

    const {
      type = 'sine',
      freq = 440,
      freqEnd = null,
      duration = 0.2,
      volume = 0.5,
      attack = 0.005,
      decay = null,
      delay = 0,
      detune = 0,
      filter = null,
    } = opts;

    // 各値を安全な範囲に丸める(0や負値は exponentialRamp が例外を投げるため)
    const startAt = Math.max(this._ctx.currentTime, when ?? this._ctx.currentTime) + Math.max(0, delay);
    const dur = Math.max(0.02, duration);
    const atk = Math.min(Math.max(attack, 0.001), dur * 0.5);
    const rel = Math.max(decay ?? dur, atk + 0.01);
    const vol = Math.max(0.0001, volume);

    let source;
    if (type === 'noise') {
      if (!this._noiseBuffer) return;
      source = this._ctx.createBufferSource();
      source.buffer = this._noiseBuffer;
      source.loop = true;
      // freq をノイズの「明るさ」として playbackRate に流用する
      source.playbackRate.value = Math.min(4, Math.max(0.1, freq / 440));
    } else {
      source = this._ctx.createOscillator();
      source.type = type;
      source.detune.value = detune;
      source.frequency.setValueAtTime(Math.max(1, freq), startAt);
      if (freqEnd != null && freqEnd > 0) {
        source.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), startAt + dur);
      }
    }

    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(vol, startAt + atk);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + rel);

    /** @type {AudioNode} */
    let node = source;
    if (filter) {
      const biquad = this._ctx.createBiquadFilter();
      biquad.type = filter.type ?? 'lowpass';
      biquad.Q.value = filter.Q ?? 1;
      biquad.frequency.setValueAtTime(Math.max(20, filter.freq ?? 2000), startAt);
      if (filter.freqEnd != null && filter.freqEnd > 0) {
        biquad.frequency.exponentialRampToValueAtTime(Math.max(20, filter.freqEnd), startAt + dur);
      }
      node.connect(biquad);
      node = biquad;
    }

    node.connect(gain);
    gain.connect(dest ?? this._sfxGain);

    this._activeVoices++;
    source.onended = () => {
      this._activeVoices = Math.max(0, this._activeVoices - 1);
      try { gain.disconnect(); } catch (_) {}
    };

    source.start(startAt);
    source.stop(startAt + rel + 0.05);
  }

  /**
   * ホワイトノイズのバッファを1つだけ作って使い回す
   * @returns {AudioBuffer|null}
   */
  _createNoiseBuffer() {
    if (!this._ctx) return null;
    const length = Math.floor(this._ctx.sampleRate * 1.0);
    const buffer = this._ctx.createBuffer(1, length, this._ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // ── BGM ─────────────────────────────────────────────────

  /**
   * BGMを開始する
   * ドローン(持続音) + アルペジオ + ベース の3層構成。
   * TODO: 音階を変えたい場合は BGM_ROOT_HZ / BGM_SCALE / BGM_ARP_PATTERN を編集
   */
  _startBGM() {
    if (!this._initialized || !this._ctx) return;
    this._stopBGM({ immediate: true });
    this._bgmPlaying = true;

    // フェードイン
    const now = this._ctx.currentTime;
    this._bgmGain.gain.cancelScheduledValues(now);
    this._bgmGain.gain.setValueAtTime(0.0001, now);
    this._bgmGain.gain.linearRampToValueAtTime(
      SOUND_CONFIG.BGM_VOLUME, now + SOUND_CONFIG.BGM_FADE_IN,
    );

    // 音声ファイルBGMが登録されていればそちらを鳴らす
    if (this._bgmBuffer) {
      this._bgmSource = this._ctx.createBufferSource();
      this._bgmSource.buffer = this._bgmBuffer;
      this._bgmSource.loop = true;
      this._bgmSource.connect(this._bgmGain);
      this._bgmSource.start(now);
      return;
    }

    // ---- ドローン(下支えする持続音) ----
    const droneFreqs = [BGM_ROOT_HZ, BGM_ROOT_HZ * 2, BGM_ROOT_HZ * 3];
    this._bgmNodes = droneFreqs.map((freq, i) => {
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = i * 4;   // わずかにズラして厚みを出す
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.10 / (i + 1), now + SOUND_CONFIG.BGM_FADE_IN);
      osc.connect(gain);
      gain.connect(this._bgmGain);
      osc.start(now);
      return { osc, gain };
    });

    // ---- アルペジオ・ベースのシーケンサー ----
    // NOTE: setInterval は不正確なので、少し先までまとめて予約する方式にしている
    this._bgmStep = 0;
    this._bgmNextTime = now + 0.1;
    this._bgmTimer = setInterval(() => this._scheduleBGM(), 60);
    this._scheduleBGM();
  }

  /** 現在のウェーブに応じた1ステップの長さ(ウェーブが進むほど速くなる) */
  _bgmStepDuration() {
    const speedup = 1 + (this._wave - 1) * SOUND_CONFIG.BGM_SPEEDUP_PER_WAVE;
    return Math.max(SOUND_CONFIG.BGM_MIN_STEP_SEC, SOUND_CONFIG.BGM_STEP_SEC / speedup);
  }

  /** 直近0.3秒分のBGMノートを先読みして予約する */
  _scheduleBGM() {
    if (!this._ctx || !this._bgmPlaying) return;
    const lookahead = 0.3;
    while (this._bgmNextTime < this._ctx.currentTime + lookahead) {
      this._scheduleBGMStep(this._bgmNextTime, this._bgmStep);
      this._bgmNextTime += this._bgmStepDuration();
      this._bgmStep++;
    }
  }

  /**
   * BGMの1ステップ分を予約する
   * @param {number} time 再生時刻
   * @param {number} step 通し番号
   */
  _scheduleBGMStep(time, step) {
    const stepDur = this._bgmStepDuration();

    // ---- アルペジオ ----
    const arpIndex = BGM_ARP_PATTERN[step % BGM_ARP_PATTERN.length];
    if (arpIndex >= 0) {
      // 8ステップごとに1オクターブ上げて変化をつける
      const octave = (Math.floor(step / BGM_ARP_PATTERN.length) % 2 === 1) ? 5 : 4;
      const freq = this._scaleFreq(BGM_SCALE[arpIndex], octave);
      this._playTone({
        type: 'triangle',
        freq,
        duration: stepDur * 1.6,
        volume: 0.16,
        attack: 0.005,
        decay: stepDur * 1.6,
        filter: { type: 'lowpass', freq: 2400, freqEnd: 700, Q: 1 },
      }, time, this._bgmGain);
    }

    // ---- ベース(4ステップに1回) ----
    if (step % 4 === 0) {
      const bassIndex = BGM_BASS_PATTERN[Math.floor(step / 4) % BGM_BASS_PATTERN.length];
      const freq = this._scaleFreq(BGM_SCALE[bassIndex], 2);
      this._playTone({
        type: 'sine',
        freq,
        duration: stepDur * 3.0,
        volume: 0.22,
        attack: 0.01,
        decay: stepDur * 3.0,
        filter: { type: 'lowpass', freq: 400 },
      }, time, this._bgmGain);
    }

    // ---- 拍を刻むパルス(8ステップに1回) ----
    if (step % 8 === 4) {
      this._playTone({
        type: 'noise',
        freq: 300,
        duration: 0.08,
        volume: 0.05,
        attack: 0.001,
        decay: 0.08,
        filter: { type: 'lowpass', freq: 600, freqEnd: 120, Q: 1 },
      }, time, this._bgmGain);
    }
  }

  /**
   * スケール上の音を周波数に変換する
   * @param {number} semitone ルートからの半音数
   * @param {number} octave   オクターブ(BGM_ROOT_HZ を1として数える)
   */
  _scaleFreq(semitone, octave) {
    return BGM_ROOT_HZ * Math.pow(2, octave - 1) * Math.pow(2, semitone / 12);
  }

  /**
   * BGMを停止する
   * @param {object} [opts]
   * @param {boolean} [opts.immediate] trueで即停止(フェードなし)
   */
  _stopBGM({ immediate = false } = {}) {
    this._bgmPlaying = false;

    if (this._bgmTimer !== null) {
      clearInterval(this._bgmTimer);
      this._bgmTimer = null;
    }
    if (!this._ctx) return;

    const now = this._ctx.currentTime;
    const fade = immediate ? 0 : SOUND_CONFIG.BGM_FADE_OUT;

    if (this._bgmGain) {
      this._bgmGain.gain.cancelScheduledValues(now);
      this._bgmGain.gain.setValueAtTime(Math.max(0.0001, this._bgmGain.gain.value), now);
      this._bgmGain.gain.linearRampToValueAtTime(0.0001, now + fade);
    }

    // フェードが終わってから実際のノードを止める(プツッというノイズ防止)
    const stopAt = now + fade + 0.05;

    if (this._bgmNodes) {
      for (const { osc } of this._bgmNodes) {
        try { osc.stop(stopAt); } catch (_) {}
      }
      this._bgmNodes = null;
    }
    if (this._bgmSource) {
      try { this._bgmSource.stop(stopAt); } catch (_) {}
      this._bgmSource = null;
    }
  }

  // ── 音声ファイル対応 ──────────────────────────────────────

  /**
   * 音声ファイルを読み込んでサウンドIDに割り当てる。
   * 登録されたIDは、プロシージャル音の代わりにファイルが再生される。
   *
   * 使い方:
   *   soundManager.preload({ shoot: './assets/shoot.wav', defeat: './assets/defeat.mp3' });
   *
   * NOTE: init() 前に呼んでもよい(ダウンロードだけ先に行い、init時にデコードする)
   * @param {Record<string, string>} map { サウンドID: ファイルURL }
   * @returns {Promise<void>}
   */
  async preload(map) {
    await Promise.all(Object.entries(map).map(async ([id, url]) => {
      try {
        const arrayBuffer = await this._fetchAudio(url);
        if (this._ctx) {
          this._buffers.set(id, await this._ctx.decodeAudioData(arrayBuffer));
        } else {
          this._pendingBuffers.set(id, arrayBuffer);
        }
      } catch (e) {
        // 読み込みに失敗してもプロシージャル音にフォールバックするだけなので致命的ではない
        console.warn(`[SoundManager] 音声ファイルの読み込み失敗 "${id}" (${url}):`, e);
      }
    }));
  }

  /**
   * BGMを音声ファイルに差し替える(ループ再生)。
   * 次に game:start が来たタイミングから適用される。
   * @param {string} url
   * @returns {Promise<void>}
   */
  async setBGMFile(url) {
    try {
      const arrayBuffer = await this._fetchAudio(url);
      if (!this._ctx) {
        console.warn('[SoundManager] setBGMFile は init() 後に呼んでください');
        return;
      }
      this._bgmBuffer = await this._ctx.decodeAudioData(arrayBuffer);
      // 再生中なら即座に差し替える
      if (this._bgmPlaying) this._startBGM();
    } catch (e) {
      console.warn(`[SoundManager] BGMファイルの読み込み失敗 (${url}):`, e);
    }
  }

  /**
   * 音声ファイルを取得する
   * @param {string} url
   * @returns {Promise<ArrayBuffer>}
   */
  async _fetchAudio(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  }

  /** init() 前に preload されていたデータをデコードする */
  async _flushPendingBuffers() {
    if (this._pendingBuffers.size === 0 || !this._ctx) return;
    const pending = [...this._pendingBuffers.entries()];
    this._pendingBuffers.clear();
    for (const [id, arrayBuffer] of pending) {
      try {
        this._buffers.set(id, await this._ctx.decodeAudioData(arrayBuffer));
      } catch (e) {
        console.warn(`[SoundManager] 音声ファイルのデコード失敗 "${id}":`, e);
      }
    }
  }

  /**
   * 読み込み済みバッファを1回だけ再生する
   * @param {AudioBuffer} buffer
   * @param {number} volume
   */
  _playBuffer(buffer, volume) {
    if (!this._ctx || this._activeVoices >= SOUND_CONFIG.MAX_VOICES) return;
    const source = this._ctx.createBufferSource();
    const gain = this._ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.max(0.0001, volume);
    source.connect(gain);
    gain.connect(this._sfxGain);

    this._activeVoices++;
    source.onended = () => {
      this._activeVoices = Math.max(0, this._activeVoices - 1);
      try { gain.disconnect(); } catch (_) {}
    };
    source.start();
  }

  // ── 音量・後始末 ─────────────────────────────────────────

  /**
   * マスター音量を変更する
   * @param {number} value 0.0〜1.0
   */
  setMasterVolume(value) {
    if (!this._masterGain) return;
    this._masterGain.gain.value = Math.min(1, Math.max(0, value));
  }

  /**
   * ミュートを切り替える
   * @param {boolean} [muted] 省略でトグル
   * @returns {boolean} 切り替え後の状態
   */
  setMuted(muted) {
    this._muted = muted ?? !this._muted;
    if (this._masterGain && this._ctx) {
      const now = this._ctx.currentTime;
      this._masterGain.gain.cancelScheduledValues(now);
      this._masterGain.gain.linearRampToValueAtTime(
        this._muted ? 0.0001 : Config.SOUND.MASTER_VOLUME, now + 0.1,
      );
    }
    return this._muted;
  }

  /** すべて停止してAudioContextを解放する */
  dispose() {
    this._stopBGM({ immediate: true });
    this._buffers.clear();
    this._pendingBuffers.clear();
    try { this._ctx?.close(); } catch (_) {}
    this._ctx = null;
    this._initialized = false;
  }
}
