/**
 * PostProcessing.js - ポストエフェクト管理
 * ============================================================
 * 担当: エフェクト担当メンバー
 *
 * 使用ライブラリ: Three.js 組み込みの postprocessing アドオン
 *   (postprocessing npm パッケージではなく three/addons を使用)
 *
 * 作業ガイド:
 *   - Bloom強度    → bloomPass.strength
 *   - Bloom閾値    → bloomPass.threshold (低いほど広く光る)
 *   - Bloom半径    → bloomPass.radius
 *   - Vignette濃さ → vignettePass.uniforms['darkness'].value
 *
 * WebXR注意事項:
 *   - OutputPass が必須 (Three.js r152+): トーンマッピング + 色空間変換を担当
 *   - renderer.toneMapping は OutputPass が引き継ぐため値を保持したまま可
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
    this._fallback = false;

    this._composer = new EffectComposer(renderer);

    // ── パス構成 ──────────────────────────────────────────
    // 1. シーン描画
    this._composer.addPass(new RenderPass(scene, camera));

    // 2. Bloom (UnrealBloomPass: Three.js 組み込み)
    //    strength: 光の強さ / radius: 広がり / threshold: 光らせる輝度の閾値
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.0,   // strength
      0.4,   // radius
      0.70,  // threshold (高いほど明るいものだけ光る・負荷↓)
    );
    this._composer.addPass(this.bloomPass);

    // 3. Vignette (周辺暗化・負荷ほぼゼロ)
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms['offset'].value   = 0.95;
    this.vignettePass.uniforms['darkness'].value = 1.5;
    this._composer.addPass(this.vignettePass);

    // 4. OutputPass: トーンマッピング + リニア→sRGB色空間変換
    //    Three.js r152+ では必須。これがないと PBR マテリアルの色が壊れる
    this._composer.addPass(new OutputPass());
  }

  /** メインループから呼ぶ。renderer.render() の代わり */
  render(delta) {
    try {
      this._composer.render(delta);
    } catch (e) {
      // EffectComposer が失敗した場合は直接描画にフォールバック
      if (!this._fallback) {
        console.warn('[PostProcessing] EffectComposer failed, falling back to direct render:', e);
        this._fallback = true;
      }
      this._renderer.render(this._scene, this._camera);
    }
  }

  /** ウィンドウリサイズ時に呼ぶ */
  setSize(width, height) {
    this._composer.setSize(width, height);
  }
}
