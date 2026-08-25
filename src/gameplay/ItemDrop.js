/**
 * ItemDrop - 敵撃破時に落とすパワーアップアイテム
 * ============================================================
 * 担当: 敵挙動担当メンバー
 *
 * アイテム種類:
 *   power   - 威力5倍 (15秒)
 *   rapid   - 超高速連射 (15秒)
 *   shotgun - 7発拡散 (15秒)
 *
 * 使い方: 弾を当てると収集 → EventBus 'item:collected' を発行
 * ============================================================
 */

import * as THREE from 'three';
import EventBus from '../common/EventBus.js';

const COLORS = {
  power:   0xff2200,
  rapid:   0x00ffcc,
  shotgun: 0xffaa00,
};

const LABELS = {
  power:   'POW',
  rapid:   'RFL',
  shotgun: 'SGN',
};

export class ItemDrop {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position
   * @param {'power'|'rapid'|'shotgun'} type
   */
  constructor(scene, position, type) {
    this.scene    = scene;
    this.type     = type;
    this.isActive = true;
    this._age     = 0;
    this._baseY   = position.y;

    this.mesh = this._createMesh();
    this.mesh.position.copy(position);
    this.scene.add(this.mesh);
  }

  _createMesh() {
    const color = COLORS[this.type] ?? 0xffffff;
    const group = new THREE.Group();

    // コアのオーブ
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.12, 1),
      new THREE.MeshPhongMaterial({
        color,
        emissive:         new THREE.Color(color),
        emissiveIntensity: 1.2,
        transparent:      true,
        opacity:          0.9,
        shininess:        200,
      }),
    );
    group.add(orb);

    // 外側のリング
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.20, 0.018, 6, 24),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity:     0.7,
        blending:    THREE.AdditiveBlending,
        depthWrite:  false,
      }),
    );
    group.add(ring);

    return group;
  }

  /** @param {number} delta */
  update(delta) {
    if (!this.isActive) return;
    this._age += delta;

    // 上下に浮遊
    this.mesh.position.y = this._baseY + Math.sin(this._age * 2.5) * 0.07;

    // 本体を回転
    this.mesh.rotation.y += delta * 2.5;

    // リングを別軸で回転
    const ring = this.mesh.children[1];
    if (ring) ring.rotation.x += delta * 1.8;

    // 発光をパルス
    const orb = this.mesh.children[0];
    if (orb?.material) {
      orb.material.emissiveIntensity = 0.8 + Math.sin(this._age * 5) * 0.4;
    }

    // 12秒後に自動消滅
    if (this._age > 12) {
      this.isActive = false;
      if (this.mesh.parent) this.scene.remove(this.mesh);
    }
  }

  /** @returns {THREE.Vector3} */
  get position() {
    return this.mesh.position;
  }

  collect() {
    if (!this.isActive) return;
    this.isActive = false;
    if (this.mesh.parent) this.scene.remove(this.mesh);
    EventBus.emit('item:collected', { type: this.type });
  }

  destroy() {
    this.isActive = false;
    if (this.mesh.parent) this.scene.remove(this.mesh);
  }
}
