/**
 * EventBus - モジュール間通信の共通バス
 * ============================================================
 * 担当: 全員が「読む」共通ルール。このファイルは基本的に変更しない。
 *
 * 使い方:
 *   // イベントを購読する
 *   EventBus.on('enemy:defeated', (data) => { console.log(data.score); });
 *
 *   // イベントを発火する
 *   EventBus.emit('enemy:defeated', { score: 100, position: enemy.position });
 *
 *   // 購読解除
 *   const handler = (data) => {};
 *   EventBus.on('game:start', handler);
 *   EventBus.off('game:start', handler);
 *
 * 定義済みイベント一覧:
 *   game:start          - ゲーム開始
 *   game:over           - ゲームオーバー        { finalScore, wave }
 *   game:score-update   - スコア更新            { score, delta }
 *   game:health-update  - HP更新                { health, maxHealth }
 *   game:wave-update    - ウェーブ更新           { wave }
 *   enemy:spawned       - 敵スポーン            { enemy }
 *   enemy:defeated      - 敵撃破               { enemy, score }
 *   enemy:reached-player- 敵がプレイヤーに到達  { enemy, damage }
 *   weapon:fired        - 射撃                  { position, direction }
 *   weapon:hit          - 弾が敵にヒット        { bullet, enemy }
 *   sound:play          - 効果音再生依頼        { id }
 * ============================================================
 */

class EventBusClass {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * イベントを購読する
   * @param {string} event
   * @param {Function} handler
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
  }

  /**
   * イベントの購読を解除する
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  /**
   * イベントを発火する
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    this._listeners.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err);
      }
    });
  }

  /**
   * 全リスナーを削除する(ゲームリセット時に使用)
   */
  clear() {
    this._listeners.clear();
  }
}

const EventBus = new EventBusClass();
export default EventBus;
