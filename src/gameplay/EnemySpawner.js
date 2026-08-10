/**
 * EnemySpawner - 敵の出現ロジック・ウェーブ管理
 * ============================================================
 * 担当: 敵スポーン・ウェーブ担当メンバー
 *
 * 作業ガイド:
 *   - spawnEnemy() でスポーン位置や演出を変えられる
 *   - _nextWave() でウェーブアップ時のロジックを変えられる
 *   - Config.SPAWNER / Config.ENEMY の値でバランス調整
 *   - 将来的にスポーンパターン(包囲陣形など)を追加できる
 *
 * このファイルで触るもの: このファイルのみ
 * ============================================================
 */

import * as THREE from 'three';
import { Enemy } from './Enemy.js';
import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

export class EnemySpawner {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;

    /** @type {Enemy[]} */
    this._enemies = [];

    this._wave = 1;
    this._spawnTimer = 0;
    this._spawnInterval = Config.SPAWNER.BASE_INTERVAL;
    this._killCountInWave = 0;
    this._isActive = false;

    // ウェーブ進行を管理するためにEventBusを購読
    EventBus.on('enemy:defeated', this._onEnemyDefeated.bind(this));
    EventBus.on('enemy:reached-player', this._onEnemyReached.bind(this));
  }

  /**
   * スポーナーを起動する(ゲーム開始時にApp.jsから呼ぶ)
   */
  start() {
    this._isActive = true;
    this._wave = 1;
    this._spawnTimer = 0;
    this._killCountInWave = 0;
    this._spawnInterval = Config.SPAWNER.BASE_INTERVAL;
    this._enemies = [];

    EventBus.emit('game:wave-update', { wave: this._wave });
  }

  /**
   * スポーナーを停止する(ゲームオーバー時にApp.jsから呼ぶ)
   */
  stop() {
    this._isActive = false;
  }

  /**
   * 毎フレーム呼ばれる更新処理
   * @param {number} delta - 前フレームからの経過時間(秒)
   * @param {THREE.Vector3} playerPosition
   */
  update(delta, playerPosition) {
    if (!this._isActive) return;

    // スポーンタイマー
    this._spawnTimer += delta;
    if (this._spawnTimer >= this._spawnInterval) {
      this._spawnTimer = 0;
      this._spawnEnemy(playerPosition);
    }

    // 各敵の更新
    for (const enemy of this._enemies) {
      if (enemy.isActive) {
        enemy.update(delta, playerPosition);
      }
    }
  }

  /**
   * 非アクティブになった敵を配列から除去する(App.jsから毎フレーム呼ぶ)
   */
  cleanup() {
    this._enemies = this._enemies.filter((e) => e.isActive);
  }

  /**
   * アクティブな敵リストを返す(当たり判定用)
   * @returns {Enemy[]}
   */
  getEnemies() {
    return this._enemies.filter((e) => e.isActive);
  }

  /**
   * 敵を1体スポーンする
   * @param {THREE.Vector3} playerPosition
   */
  _spawnEnemy(playerPosition) {
    const position = this._calcSpawnPosition(playerPosition);

    const hp = Config.ENEMY.BASE_HP + (this._wave - 1) * Config.ENEMY.HP_PER_WAVE;
    const speed = Math.min(
      Config.ENEMY.BASE_SPEED + (this._wave - 1) * Config.ENEMY.SPEED_PER_WAVE,
      Config.ENEMY.MAX_SPEED,
    );

    const enemy = new Enemy(this.scene, position, {
      hp,
      speed,
      wave: this._wave,
    });

    this._enemies.push(enemy);
    EventBus.emit('enemy:spawned', { enemy });
  }

  /**
   * プレイヤー周囲のランダム位置を計算する
   * TODO: ここを変えてスポーンパターンを増やせる
   *   例: 真正面からだけスポーン、包囲陣形でスポーン、など
   * @param {THREE.Vector3} center
   * @returns {THREE.Vector3}
   */
  _calcSpawnPosition(center) {
    const angle = Math.random() * Math.PI * 2;
    const radius =
      Config.ENEMY.SPAWN_RADIUS_MIN +
      Math.random() * (Config.ENEMY.SPAWN_RADIUS_MAX - Config.ENEMY.SPAWN_RADIUS_MIN);
    const height =
      Config.ENEMY.SPAWN_HEIGHT_MIN +
      Math.random() * (Config.ENEMY.SPAWN_HEIGHT_MAX - Config.ENEMY.SPAWN_HEIGHT_MIN);

    return new THREE.Vector3(
      center.x + Math.cos(angle) * radius,
      center.y + height,
      center.z + Math.sin(angle) * radius,
    );
  }

  /**
   * 敵が撃破されたときの処理
   */
  _onEnemyDefeated() {
    this._killCountInWave++;
    if (this._killCountInWave >= Config.SPAWNER.ENEMIES_PER_WAVE) {
      this._nextWave();
    }
  }

  /**
   * 敵がプレイヤーに到達したときも撃破カウントに含める
   */
  _onEnemyReached() {
    this._killCountInWave++;
    if (this._killCountInWave >= Config.SPAWNER.ENEMIES_PER_WAVE) {
      this._nextWave();
    }
  }

  /**
   * 次のウェーブへ進む
   */
  _nextWave() {
    this._wave++;
    this._killCountInWave = 0;
    this._spawnInterval = Math.max(
      Config.SPAWNER.MIN_INTERVAL,
      Config.SPAWNER.BASE_INTERVAL - (this._wave - 1) * Config.SPAWNER.INTERVAL_DECAY,
    );

    EventBus.emit('game:wave-update', { wave: this._wave });
  }

  /**
   * 全敵を破棄してリセットする(ゲームリセット時)
   */
  reset() {
    for (const enemy of this._enemies) {
      enemy.destroy();
    }
    this._enemies = [];
    this._isActive = false;
    this._wave = 1;
    this._killCountInWave = 0;
    this._spawnTimer = 0;
    this._spawnInterval = Config.SPAWNER.BASE_INTERVAL;
  }

  get wave() {
    return this._wave;
  }
}
