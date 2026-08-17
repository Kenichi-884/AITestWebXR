/**
 * EffectManager - 視覚エフェクト管理
 * ============================================================
 * 担当: エフェクト担当メンバー
 *
 * 作業ガイド:
 *   - マズルフラッシュ → _spawnMuzzleFlash()
 *   - ヒットスパーク   → _spawnHitSpark()
 *   - 撃破エフェクト   → _spawnDefeatBurst()
 *   - 新エフェクト追加 → このファイルにメソッドを追加し
 *                        EventBus.on() で購読する
 *
 * このファイルで触るもの: このファイルのみ
 * ============================================================
 */

import * as THREE from 'three';
import EventBus from '../common/EventBus.js';

export class EffectManager {

  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;

    // 現在表示されているエフェクト
    this._effects = [];

    // ─────────────────────────────
    // イベントを受け取る
    // ─────────────────────────────

    // 銃を撃った
    EventBus.on('weapon:fired', ({ position }) => {
      this._spawnMuzzleFlash(position);
    });

    // 敵に弾が当たった
    EventBus.on('weapon:hit', ({ enemy }) => {
      this._spawnHitSpark(enemy.position);
    });

    // 敵を倒した
    EventBus.on('enemy:defeated', ({ enemy }) => {
      this._spawnDefeatBurst(enemy.position);
    });
  }


  // ============================================================
  // 毎フレーム更新
  // ============================================================

  update(delta) {

    for (const fx of this._effects) {

      // 残り時間を減らす
      fx.lifetime -= delta;

      // 0 → 1
      const t =
        1 -
        Math.max(
          0,
          fx.lifetime / fx.maxLifetime
        );

      // エフェクトを動かす
      fx.onUpdate(
        t,
        fx.mesh,
        delta
      );

      // 寿命が終わったら削除
      if (fx.lifetime <= 0) {
        this.scene.remove(fx.mesh);
      }
    }

    // 終わったエフェクトを配列から削除
    this._effects =
      this._effects.filter(
        (fx) => fx.lifetime > 0
      );
  }


  // ============================================================
  // 🔫 マズルフラッシュ
  // ============================================================

  _spawnDefeatBurst(position) {

    // ============================================================
    // ① 白い超強力フラッシュ
    // ============================================================
  
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
  
    core.position.copy(position);
    this.scene.add(core);
  
    this._add(core, 0.15, (t, mesh) => {
      mesh.scale.setScalar(1 + t * 8);
      mesh.material.opacity = 1 - t;
    });
  
  
    // ============================================================
    // ② メインのインク爆発
    // ============================================================
  
    const COLORS = [
      0xff2bd6, // ピンク
      0x16e8ff, // シアン
      0xd9ff00, // ライム
      0xffe600, // 黄色
    ];
  
    const mainColor =
      COLORS[Math.floor(Math.random() * COLORS.length)];
  
  
    const explosion = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.32, 1),
      new THREE.MeshBasicMaterial({
        color: mainColor,
        transparent: true,
        opacity: 1,
      })
    );
  
    explosion.position.copy(position);
  
    explosion.scale.set(
      1.4,
      1.0,
      1.4
    );
  
    this.scene.add(explosion);
  
    this._add(explosion, 0.3, (t, mesh) => {
  
      const punch =
        Math.sin(t * Math.PI);
  
      const scale =
        1 + punch * 5;
  
      mesh.scale.set(
        scale * 1.4,
        scale,
        scale * 1.4
      );
  
      mesh.rotation.y += 0.2;
  
      mesh.material.opacity =
        1 - t;
    });
  
  
    // ============================================================
    // ③ 反対色の外側爆発
    // ============================================================
  
    const secondColor =
      COLORS[Math.floor(Math.random() * COLORS.length)];
  
  
    const outer = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.4, 1),
      new THREE.MeshBasicMaterial({
        color: secondColor,
        transparent: true,
        opacity: 0.8,
        wireframe: false,
      })
    );
  
    outer.position.copy(position);
  
    this.scene.add(outer);
  
    this._add(outer, 0.35, (t, mesh) => {
  
      const scale =
        1 + t * 6;
  
      mesh.scale.setScalar(scale);
  
      mesh.rotation.x += 0.05;
      mesh.rotation.y -= 0.07;
  
      mesh.material.opacity =
        (1 - t) * 0.8;
    });
  
  
    // ============================================================
    // ④ コミック衝撃波
    // ============================================================
  
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(
        0.2,
        0.32,
        10
      ),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
  
    ring.position.copy(position);
  
    ring.rotation.x =
      Math.PI / 2;
  
    this.scene.add(ring);
  
    this._add(ring, 0.3, (t, mesh) => {
  
      mesh.scale.setScalar(
        1 + t * 12
      );
  
      mesh.material.opacity =
        (1 - t) * 0.9;
    });
  
  
    // ============================================================
    // ⑤ アメコミ放射線
    // ============================================================
  
    const LINE_COUNT = 24;
  
    for (let i = 0; i < LINE_COUNT; i++) {
  
      const direction =
        new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() - 0.3,
          Math.random() - 0.5
        ).normalize();
  
  
      const length =
        0.3 +
        Math.random() * 0.8;
  
  
      const line = new THREE.Mesh(
  
        new THREE.BoxGeometry(
          0.025,
          0.025,
          length
        ),
  
        new THREE.MeshBasicMaterial({
          color:
            Math.random() > 0.4
              ? 0xffffff
              : mainColor,
  
          transparent: true,
  
          blending:
            THREE.AdditiveBlending,
  
          depthWrite: false,
        })
      );
  
  
      line.position.copy(position);
  
  
      line.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        direction
      );
  
  
      this.scene.add(line);
  
  
      const speed =
        4 +
        Math.random() * 8;
  
  
      this._add(
        line,
        0.25 + Math.random() * 0.2,
  
        (t, mesh, delta) => {
  
          mesh.position.addScaledVector(
            direction,
            speed * delta
          );
  
  
          mesh.scale.z =
            1 + t * 2;
  
  
          mesh.material.opacity =
            1 - t;
        }
      );
    }
  
  
    // ============================================================
    // ⑥ インク飛沫
    // ============================================================
  
    const SPLASH_COUNT = 30;
  
  
    for (let i = 0; i < SPLASH_COUNT; i++) {
  
      const size =
        0.025 +
        Math.random() * 0.09;
  
  
      const splash = new THREE.Mesh(
  
        new THREE.SphereGeometry(
          size,
          5,
          5
        ),
  
        new THREE.MeshBasicMaterial({
          color:
            COLORS[
              Math.floor(
                Math.random() * COLORS.length
              )
            ],
  
          transparent: true,
        })
      );
  
  
      splash.position.copy(position);
  
  
      // 丸ではなく潰してインクっぽく
      splash.scale.set(
        0.5 + Math.random() * 1.5,
        0.5 + Math.random() * 1.5,
        0.3 + Math.random()
      );
  
  
      this.scene.add(splash);
  
  
      const velocity =
        new THREE.Vector3(
  
          (Math.random() - 0.5) * 10,
  
          Math.random() * 8 + 1,
  
          (Math.random() - 0.5) * 10
        );
  
  
      const lifetime =
        0.35 +
        Math.random() * 0.45;
  
  
      this._add(
        splash,
        lifetime,
  
        (t, mesh, delta) => {
  
          velocity.y -=
            10 * delta;
  
  
          mesh.position.addScaledVector(
            velocity,
            delta
          );
  
  
          mesh.rotation.x +=
            delta * 6;
  
          mesh.rotation.y +=
            delta * 8;
  
  
          mesh.material.opacity =
            1 - t;
  
  
          mesh.scale.multiplyScalar(
            0.995
          );
        }
      );
    }
  
  
    // ============================================================
    // ⑦ 大きな漫画破片
    // ============================================================
  
    const CHUNK_COUNT = 12;
  
  
    for (let i = 0; i < CHUNK_COUNT; i++) {
  
      const chunk =
        new THREE.Mesh(
  
          new THREE.TetrahedronGeometry(
            0.07 +
            Math.random() * 0.08
          ),
  
          new THREE.MeshBasicMaterial({
  
            color:
              COLORS[
                Math.floor(
                  Math.random() *
                  COLORS.length
                )
              ],
  
            transparent: true,
          })
        );
  
  
      chunk.position.copy(position);
  
  
      this.scene.add(chunk);
  
  
      const velocity =
        new THREE.Vector3(
  
          (Math.random() - 0.5) * 9,
  
          Math.random() * 7 + 2,
  
          (Math.random() - 0.5) * 9
        );
  
  
      const spin =
        new THREE.Vector3(
  
          Math.random() * 15,
  
          Math.random() * 15,
  
          Math.random() * 15
        );
  
  
      const lifetime =
        0.5 +
        Math.random() * 0.4;
  
  
      this._add(
        chunk,
        lifetime,
  
        (t, mesh, delta) => {
  
          velocity.y -=
            9 * delta;
  
  
          mesh.position.addScaledVector(
            velocity,
            delta
          );
  
  
          mesh.rotation.x +=
            spin.x * delta;
  
          mesh.rotation.y +=
            spin.y * delta;
  
          mesh.rotation.z +=
            spin.z * delta;
  
  
          mesh.material.opacity =
            1 - t;
        }
      );
    }
  
  
    // ============================================================
    // ⑧ 爆発時に周囲を強く照らす
    // ============================================================
  
    const lightHolder =
      new THREE.Object3D();
  
  
    lightHolder.position.copy(position);
  
  
    const light =
      new THREE.PointLight(
        mainColor,
        30,
        6
      );
  
  
    lightHolder.add(light);
  
    this.scene.add(lightHolder);
  
  
    this._add(
      lightHolder,
      0.2,
  
      (t, mesh) => {
  
        const pointLight =
          mesh.children[0];
  
  
        pointLight.intensity =
          30 * (1 - t);
      }
    );
  }


  // ============================================================
  // 💥 敵に弾が当たった
  // ============================================================

  _spawnHitSpark(position) {

    const COUNT = 18;

    const VELOCITY_SCALE = 7;


    // ----------------------------------------------------------
    // ① 命中した瞬間の白い光
    // ----------------------------------------------------------

    const flash =
      new THREE.Mesh(

        new THREE.SphereGeometry(
          0.08,
          8,
          8
        ),

        new THREE.MeshBasicMaterial({

          color: 0xffffff,

          transparent: true,

          blending:
            THREE.AdditiveBlending,

          depthWrite: false,
        })
      );


    flash.position.copy(
      position
    );


    this.scene.add(
      flash
    );


    this._add(

      flash,

      0.12,

      (t, mesh) => {

        mesh.material.opacity =
          1 - t;


        mesh.scale.setScalar(
          1 + t * 5
        );
      }
    );


    // ----------------------------------------------------------
    // ② 火花
    // ----------------------------------------------------------

    for (
      let i = 0;
      i < COUNT;
      i++
    ) {

      const mesh =
        new THREE.Mesh(

          new THREE.SphereGeometry(
            0.015 +
            Math.random() * 0.015,

            4,
            4
          ),

          new THREE.MeshBasicMaterial({

            color:
              Math.random() > 0.3
                ? 0xffcc00
                : 0xff4400,

            transparent: true,

            blending:
              THREE.AdditiveBlending,

            depthWrite: false,
          })
        );


      mesh.position.copy(
        position
      );


      this.scene.add(
        mesh
      );


      const velocity =
        new THREE.Vector3(

          (Math.random() - 0.5)
            * VELOCITY_SCALE,

          Math.random()
            * VELOCITY_SCALE,

          (Math.random() - 0.5)
            * VELOCITY_SCALE
        );


      const lifetime =
        0.2 +
        Math.random() * 0.3;


      this._add(

        mesh,

        lifetime,

        (t, mesh, delta) => {

          // 重力
          velocity.y -=
            7 * delta;


          mesh.position
            .addScaledVector(
              velocity,
              delta
            );


          mesh.material.opacity =
            1 - t;


          mesh.scale.setScalar(
            1 - t * 0.7
          );
        }
      );
    }


    // ----------------------------------------------------------
    // ③ 衝撃波
    // ----------------------------------------------------------

    const ring =
      new THREE.Mesh(

        new THREE.RingGeometry(
          0.04,
          0.08,
          32
        ),

        new THREE.MeshBasicMaterial({

          color: 0xffaa00,

          transparent: true,

          side:
            THREE.DoubleSide,

          blending:
            THREE.AdditiveBlending,

          depthWrite: false,
        })
      );


    ring.position.copy(
      position
    );


    ring.rotation.x =
      Math.PI / 2;


    this.scene.add(
      ring
    );


    this._add(

      ring,

      0.22,

      (t, mesh) => {

        mesh.scale.setScalar(
          1 + t * 5
        );


        mesh.material.opacity =
          (1 - t) * 0.8;
      }
    );
  }


  // ============================================================
  // ☠️ 敵を倒した
  // ============================================================

  _spawnDefeatBurst(position) {

    // ----------------------------------------------------------
    // ① 大きい爆発
    // ----------------------------------------------------------

    const burst =
      new THREE.Mesh(

        new THREE.SphereGeometry(
          0.18,
          12,
          12
        ),

        new THREE.MeshBasicMaterial({

          color: 0xffffff,

          transparent: true,

          blending:
            THREE.AdditiveBlending,

          depthWrite: false,
        })
      );


    burst.position.copy(
      position
    );


    this.scene.add(
      burst
    );


    this._add(

      burst,

      0.25,

      (t, mesh) => {

        mesh.scale.setScalar(
          1 + t * 8
        );


        mesh.material.opacity =
          (1 - t) *
          (1 - t);
      }
    );


    // ----------------------------------------------------------
    // ② 衝撃波
    // ----------------------------------------------------------

    const shockwave =
      new THREE.Mesh(

        new THREE.RingGeometry(
          0.12,
          0.18,
          32
        ),

        new THREE.MeshBasicMaterial({

          color: 0xff6600,

          transparent: true,

          side:
            THREE.DoubleSide,

          blending:
            THREE.AdditiveBlending,

          depthWrite: false,
        })
      );


    shockwave.position.copy(
      position
    );


    shockwave.rotation.x =
      Math.PI / 2;


    this.scene.add(
      shockwave
    );


    this._add(

      shockwave,

      0.4,

      (t, mesh) => {

        mesh.scale.setScalar(
          1 + t * 10
        );


        mesh.material.opacity =
          (1 - t) * 0.8;
      }
    );


    // ----------------------------------------------------------
    // ③ 飛び散る破片
    // ----------------------------------------------------------

    const COUNT = 20;


    for (
      let i = 0;
      i < COUNT;
      i++
    ) {

      const hue =
        Math.random();


      const mesh =
        new THREE.Mesh(

          new THREE.OctahedronGeometry(
            0.04 +
            Math.random() * 0.06,

            0
          ),

          new THREE.MeshBasicMaterial({

            color:
              new THREE.Color()
                .setHSL(
                  hue,
                  1,
                  0.6
                ),

            transparent: true,

            blending:
              THREE.AdditiveBlending,

            depthWrite: false,
          })
        );


      mesh.position.copy(
        position
      );


      this.scene.add(
        mesh
      );


      const velocity =
        new THREE.Vector3(

          (Math.random() - 0.5)
            * 8,

          Math.random() * 6 + 1,

          (Math.random() - 0.5)
            * 8
        );


      const spin =
        new THREE.Vector3(

          (Math.random() - 0.5)
            * 15,

          (Math.random() - 0.5)
            * 15,

          (Math.random() - 0.5)
            * 15
        );


      const lifetime =
        0.5 +
        Math.random() * 0.5;


      this._add(

        mesh,

        lifetime,

        (t, mesh, delta) => {

          // 重力
          velocity.y -=
            9.8 * delta;


          mesh.position
            .addScaledVector(
              velocity,
              delta
            );


          // 回転
          mesh.rotation.x +=
            spin.x * delta;

          mesh.rotation.y +=
            spin.y * delta;

          mesh.rotation.z +=
            spin.z * delta;


          // 徐々に消える
          mesh.material.opacity =
            1 - t;
        }
      );
    }
  }


  // ============================================================
  // 内部処理
  // ============================================================

  _add(
    mesh,
    lifetime,
    onUpdate
  ) {

    this._effects.push({

      mesh,

      lifetime,

      maxLifetime:
        lifetime,

      onUpdate,
    });
  }
}
