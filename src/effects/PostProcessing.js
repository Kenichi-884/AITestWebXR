/**
 * PostProcessing.js - ポストエフェクト管理
 * ============================================================
 * 担当: エフェクト担当メンバー
 *
 * 動作モード:
 *   - デスクトップ: Bloom + Vignette が有効
 *   - WebXR (Quest): 非対応のため無効 (renderer.render() 直接描画)
 *
 *   WebXR の XRWebGLLayer フレームバッファは EffectComposer の
 *   中間レンダーターゲット方式と根本的に非互換のため、
 *   XR 中はポストエフェクトを使用しない。
 *
 * 作業ガイド(デスクトップ向け):
 *   - Bloom強度   → bloomPass.strength
 *   - Bloom閾値   → bloomPass.threshold
 *   - Vignette濃さ → vignettePass.uniforms['darkness'].value
 * ============================================================
 */

import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }      from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader }  from 'three/addons/shaders/VignetteShader.js';

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

    this._composer = new EffectComposer(renderer);
    this._composer.addPass(new RenderPass(scene, camera));

    // Bloom
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.0,   // strength
      0.4,   // radius
      0.70,  // threshold
    );
    this._composer.addPass(this.bloomPass);

    // Vignette
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms['offset'].value   = 0.95;
    this.vignettePass.uniforms['darkness'].value = 1.5;
    this._composer.addPass(this.vignettePass);

    // OutputPass: Three.js r152+ 必須。トーンマッピング + 色空間変換を担当
    this._composer.addPass(new OutputPass());
  }

  /**
   * デスクトップ用レンダリング (EffectComposer)
   * XR中は App.js 側で renderer.render() を直接呼ぶこと
   */
  render(delta) {
    this._composer.render(delta);
  }

  /** リサイズ時に呼ぶ */
  setSize(width, height) {
    this._composer.setSize(width, height);
  }
}
