/**
 * PostProcessing.js - ポストエフェクト管理
 * ============================================================
 * 担当: エフェクト担当メンバー
 *
 * 重要: renderer.toneMapping は必ず NoToneMapping にすること
 *   → トーンマッピングは ToneMappingEffect が担当する
 *   → renderer 側で適用すると中間バッファで二重処理になり PBR が壊れる
 *
 * 作業ガイド:
 *   - Bloom強度   → bloomEffect.intensity
 *   - Bloom閾値   → bloomEffect.luminanceMaterial.threshold
 *   - Vignette濃さ → vignetteEffect の darkness
 * ============================================================
 */

import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  VignetteEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';

export class PostProcessing {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  constructor(renderer, scene, camera) {
    this._renderer = renderer;
    this._scene    = scene;
    this._camera   = camera;

    // !! 重要 !!
    // renderer 側のトーンマッピングを無効化し、ToneMappingEffect に委譲する。
    // これをしないと中間バッファ描画時にトーンマップが掛かり
    // PBR マテリアル（敵・武器）が正しく描画されない。
    renderer.toneMapping = THREE.NoToneMapping;

    // HalfFloat: HDR 値を保持してブルームを正確に計算するために必要
    this._composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling:   0, // Quest: MSAA 無効で負荷削減
    });

    // ── パス構成 ──────────────────────────────────────────
    this._composer.addPass(new RenderPass(scene, camera));

    // Bloom + トーンマッピング + Vignette を1パスにまとめる（効率化）
    this.bloomEffect = new BloomEffect({
      intensity:           1.2,
      luminanceThreshold:  0.65, // これ以上の輝度だけ光る(高いほど負荷↓)
      luminanceSmoothing:  0.08,
      mipmapBlur:          true, // Quest 向け軽量ブラー
      levels:              6,
    });

    // ACESFilmic トーンマッピングを Composer 側で担当
    this.toneMappingEffect = new ToneMappingEffect({
      mode: ToneMappingMode.ACES_FILMIC,
    });

    this.vignetteEffect = new VignetteEffect({
      offset:   0.35,
      darkness: 0.5,
    });

    this._composer.addPass(new EffectPass(
      camera,
      this.bloomEffect,
      this.toneMappingEffect,
      this.vignetteEffect,
    ));
  }

  /** メインループから呼ぶ。renderer.render() の代わり */
  render(delta) {
    this._composer.render(delta);
  }

  /** ウィンドウリサイズ / XRフレームバッファサイズ変更時に呼ぶ */
  setSize(width, height) {
    this._composer.setSize(width, height);
  }
}
