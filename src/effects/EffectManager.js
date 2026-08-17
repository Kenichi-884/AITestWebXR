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

  _spawnMuzzleFlash(position) {

    // ----------------------------------------------------------
    // ① 白い中心光
    // ----------------------------------------------------------

    const core = new THREE.Mesh(

      new THREE.SphereGeometry(
        0.07,
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

    core.position.copy(position);

    this.scene.add(core);


    this._add(
      core,
      0.08,

      (t, mesh) => {

        mesh.material.opacity =
          1 - t;

        const scale =
          1 + t * 4;

        mesh.scale.setScalar(
          scale
        );
      }
    );


    // ----------------------------------------------------------
    // ② オレンジの爆発光
    // ----------------------------------------------------------

    const flash = new THREE.Mesh(

      new THREE.SphereGeometry(
        0.12,
        8,
        8
      ),

      new THREE.MeshBasicMaterial({

        color: 0xff8800,

        transparent: true,

        blending:
          THREE.AdditiveBlending,

        depthWrite: false,
      })
    );


    flash.position.copy(position);

    this.scene.add(flash);


    this._add(
      flash,
      0.12,

      (t, mesh) => {

        mesh.material.opacity =
          (1 - t) * 0.8;

        const scale =
          1 + t * 3;

        mesh.scale.set(
          scale,
          scale,
          scale * 1.5
        );
      }
    );


    // ----------------------------------------------------------
    // ③ 銃口から飛び散る火花
    // ----------------------------------------------------------

    const SPARK_COUNT = 12;


    for (
      let i = 0;
      i < SPARK_COUNT;
      i++
    ) {

      const spark =
        new THREE.Mesh(

          new THREE.SphereGeometry(
            0.015,
            4,
            4
          ),

          new THREE.MeshBasicMaterial({

            color:
              Math.random() > 0.5
                ? 0xffdd55
                : 0xff6600,

            transparent: true,

            blending:
              THREE.AdditiveBlending,

            depthWrite: false,
          })
        );


      spark.position.copy(
        position
      );


      this.scene.add(
        spark
      );


      // 火花の飛ぶ方向
      const velocity =
        new THREE.Vector3(

          (Math.random() - 0.5) * 5,

          (Math.random() - 0.5) * 5,

          (Math.random() - 0.5) * 5
        );


      const lifetime =
        0.08 +
        Math.random() * 0.15;


      this._add(

        spark,

        lifetime,

        (t, mesh, delta) => {

          mesh.position
            .addScaledVector(
              velocity,
              delta
            );


          mesh.material.opacity =
            1 - t;


          mesh.scale.setScalar(
            1 - t * 0.5
          );
        }
      );
    }


    // ----------------------------------------------------------
    // ④ 周囲を一瞬照らす
    // ----------------------------------------------------------

    const lightObject =
      new THREE.Object3D();


    lightObject.position.copy(
      position
    );


    const light =
      new THREE.PointLight(
        0xffaa44,
        15,
        4
      );


    lightObject.add(
      light
    );


    this.scene.add(
      lightObject
    );


    this._add(

      lightObject,

      0.1,

      (t, mesh) => {

        const pointLight =
          mesh.children[0];

        pointLight.intensity =
          15 * (1 - t);
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
