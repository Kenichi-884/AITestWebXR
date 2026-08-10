/**
 * Config - ゲーム全体の定数・設定値
 * ============================================================
 * 担当: 全員が参照する設定ファイル。ゲームバランス調整はここで行う。
 *       コードの知識がなくても数値を変えるだけでバランス調整できる。
 *
 * NOTE: この値を変えると全モジュールに影響するため、
 *       変更前にチーム内でコメント・Slackで一言連絡すること。
 * ============================================================
 */

const Config = Object.freeze({

  // ----- プレイヤー -----
  PLAYER: {
    MAX_HEALTH: 100,          // 最大HP
    DAMAGE_PER_ENEMY: 25,     // 敵1体に到達されたときのダメージ
  },

  // ----- 敵 -----
  ENEMY: {
    BASE_SPEED: 0.4,          // 敵の初期移動速度 (m/s)
    SPEED_PER_WAVE: 0.05,     // ウェーブごとに速度に加算される値
    MAX_SPEED: 1.5,           // 速度の上限
    BASE_HP: 1,               // 敵の初期HP
    HP_PER_WAVE: 1,           // ウェーブごとにHPが増加する量
    HIT_RADIUS: 0.3,          // 弾との当たり判定半径 (m)
    REACH_RADIUS: 0.6,        // プレイヤーに「到達」とみなす距離 (m)
    SCORE_PER_KILL: 100,      // 1体撃破あたりのスコア
    SPAWN_RADIUS_MIN: 3.0,    // スポーン最小距離 (m)
    SPAWN_RADIUS_MAX: 6.0,    // スポーン最大距離 (m)
    SPAWN_HEIGHT_MIN: -0.5,   // スポーン高さ範囲 (m)
    SPAWN_HEIGHT_MAX: 1.5,
  },

  // ----- スポーナー -----
  SPAWNER: {
    BASE_INTERVAL: 3.0,       // 初期スポーン間隔 (秒)
    MIN_INTERVAL: 0.8,        // スポーン間隔の最小値 (秒)
    INTERVAL_DECAY: 0.2,      // ウェーブごとに間隔を短縮する秒数
    ENEMIES_PER_WAVE: 10,     // 1ウェーブあたりの撃破目標数
  },

  // ----- 武器 -----
  WEAPON: {
    BULLET_SPEED: 15.0,       // 弾速 (m/s)
    BULLET_LIFETIME: 3.0,     // 弾の生存時間 (秒)
    COOLDOWN: 0.3,            // 連射クールダウン (秒)
    BULLET_RADIUS: 0.05,      // 弾のサイズ (m)
  },

  // ----- シーン -----
  SCENE: {
    AMBIENT_LIGHT_INTENSITY: 0.6,
    DIR_LIGHT_INTENSITY: 0.8,
    FOG_NEAR: 8,
    FOG_FAR: 20,
  },

  // ----- サウンド -----
  SOUND: {
    MASTER_VOLUME: 0.8,
    SHOOT_VOLUME: 0.6,
    HIT_VOLUME: 0.9,
    DEFEAT_VOLUME: 1.0,
    PLAYER_HIT_VOLUME: 0.8,
  },

});

export default Config;
