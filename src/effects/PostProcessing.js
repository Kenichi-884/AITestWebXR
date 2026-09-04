/**
 * PostProcessing.js - ポストエフェクト管理
 * ============================================================
 * 担当: エフェクト担当メンバー
 *
 * 作業ガイド:
 *   - Bloom強度   → bloomEffect.intensity
 *   - Bloom閾値   → bloomEffect.luminanceMaterial.threshold
 *   - Vignette濃さ → vignetteEffect の darkness
 *   - エフェクト追加 → EffectPass に追加する
 *
 * WebXR注意事項:
 *   - Quest GPU 負荷を考慮し mipmapBlur: true を使用
 *   - luminanceThreshold を高めにして明るいものだけを光らせる
 * ============================================================
 */

import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  VignetteEffect,
} from 'postprocessing';

export class PostProcessing {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  constructor(renderer, scene, camera) {
    this._renderer = renderer;
    this._camera   = camera;

    // HDR レンダーターゲット (ブルームの精度向上)
    this._composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0, // Quest では MSAA を切って負荷削減
    });

    // ── パス構成 ──────────────────────────────────────────
    const renderPass = new RenderPass(scene, camera);

    // Bloom: mipmapBlur=true が Quest で最も効率的なアルゴリズム
    this.bloomEffect = new BloomEffect({
      intensity: 1.2,
      luminanceThreshold: 0.65, // これ以上の輝度だけ光る(高いほど負荷↓)
      luminanceSmoothing: 0.08,
      mipmapBlur: true,         // Quest 向け軽量ブラー
      levels: 6,                // ブラーのミップマップ段数
    });

    // Vignette: 周辺暗化(負荷ほぼゼロ)
    this.vignetteEffect = new VignetteEffect({
      offset: 0.35,
      darkness: 0.5,
    });

    const effectPass = new EffectPass(camera, this.bloomEffect, this.vignetteEffect);

    this._composer.addPass(renderPass);
    this._composer.addPass(effectPass);
  }

  /** メインループから呼ぶ。renderer.render() の代わり */
  render(delta) {
    this._composer.render(delta);
  }

  /** ウィンドウリサイズ時に呼ぶ */
  setSize(width, height) {
    this._composer.setSize(width, height);
  }
}
