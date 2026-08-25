【音声素材フォルダ】
===================

対応フォーマット: WAV / MP3 / OGG
推奨フォーマット: WAV（高音質・遅延なし） または MP3（容量節約）

使い方 (SoundManager.js):
  soundManager.preload({ shoot: '/assets/audio/shoot.wav' });
  soundManager.setBGMFile('/assets/audio/bgm.mp3');

サウンドID一覧 (差し替え可能):
  shoot      - 射撃音
  hit        - 命中音
  defeat     - 撃破音
  player-hit - 被弾音
  reload     - リロード音
  game-start - ゲーム開始SE
  game-over  - ゲームオーバーSE
  wave-up    - ウェーブ進行SE
  spawn      - 敵スポーン音

配置例:
  public/assets/audio/shoot.wav
  public/assets/audio/bgm.mp3

※ ファイルを置くだけでは自動適用されません。
   SoundManager.preload() / setBGMFile() を呼ぶ必要があります。
