/**
 * SceneManager - Three.jsシーン・ライティング・静的オブジェクトの管理
 * ============================================================
 * 担当: シーン・アセット管理担当メンバー
 *
 * 作業ガイド:
 *   - ライティング変更 → _setupLighting()
 *   - layout.json からの静的オブジェクト読み込み → _loadLayout()
 *   - 3Dモデル(GLTFLoader) → _loadWeaponModel()
 *   - コントローラーのビジュアル → _setupControllers()
 *
 * このファイルで触るもの: このファイルのみ
 * ============================================================
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import Config from '../common/Config.js';

export class SceneManager {
  /**
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);

    /** @type {THREE.Group|null} モデルロード済みの武器グループ */
    this.weaponModel = null;

    this._controllerGrips = [];
    this._controllerRays = [];

    this._setupScene();
    this._setupLighting();
    this._setupControllers();
    this._loadLayout();

    window.addEventListener('resize', this._onResize.bind(this));
  }

  /**
   * シーンの基本設定
   */
  _setupScene() {
    this.scene.background = null; // AR(パススルー)用に透明
    // デスクトップデバッグ用のフォグ(AR中は見えない)
    this.scene.fog = new THREE.Fog(
      Config.SCENE.FOG_NEAR,
      Config.SCENE.FOG_FAR,
    );
  }

  /**
   * ライティングのセットアップ
   * TODO: ここを変えて雰囲気を変えられる
   */
  _setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, Config.SCENE.AMBIENT_LIGHT_INTENSITY);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, Config.SCENE.DIR_LIGHT_INTENSITY);
    dirLight.position.set(3, 5, 3);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    // アクセント用の青いライト(未来感)
    const accentLight = new THREE.PointLight(0x0044ff, 0.3, 10);
    accentLight.position.set(-3, 2, -3);
    this.scene.add(accentLight);
  }

  /**
   * XRコントローラーのビジュアルセットアップ
   * コントローラーの先端から照準線を表示
   */
  _setupControllers() {
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      this.scene.add(controller);

      // 照準線(レーザーポインター)
      const ray = this._createControllerRay();
      controller.add(ray);
      this._controllerRays.push(ray);

      // コントローラーグリップ(将来的に武器モデルをアタッチする用)
      const grip = this.renderer.xr.getControllerGrip(i);
      this.scene.add(grip);
      this._controllerGrips.push(grip);
    }
  }

  /**
   * コントローラーの照準線メッシュを作成
   * @returns {THREE.Line}
   */
  _createControllerRay() {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -10),
    ]);
    const material = new THREE.LineBasicMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0.6,
    });
    return new THREE.Line(geometry, material);
  }

  /**
   * layout.json を読み込んで静的オブジェクトを配置する
   */
  async _loadLayout() {
    try {
      const res = await fetch('/assets/layout.json');
      const layout = await res.json();

      for (const obj of layout.staticObjects ?? []) {
        if (!obj.visible) continue;
        const mesh = this._createStaticObject(obj);
        if (mesh) this.scene.add(mesh);
      }

      // 武器モデルのパスを layout.json から取得してロード
      if (layout.weapon?.modelFile) {
        const modelPath = `${layout.weapon.modelPath}${layout.weapon.modelFile}`;
        await this._loadWeaponModel(modelPath, layout.weapon);
      }
    } catch (e) {
      console.warn('[SceneManager] layout.json の読み込みに失敗:', e);
    }
  }

  /**
   * layout.json の定義から THREE.Mesh を生成する
   * @param {object} def
   * @returns {THREE.Mesh|null}
   */
  _createStaticObject(def) {
    let geometry;
    switch (def.type) {
      case 'plane': geometry = new THREE.PlaneGeometry(1, 1); break;
      case 'box':   geometry = new THREE.BoxGeometry(1, 1, 1); break;
      case 'sphere':geometry = new THREE.SphereGeometry(0.5, 16, 16); break;
      default: return null;
    }

    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color(def.color ?? '#888888'),
    });
    const mesh = new THREE.Mesh(geometry, material);

    if (def.position) mesh.position.set(...def.position);
    if (def.rotation) {
      mesh.rotation.set(
        THREE.MathUtils.degToRad(def.rotation[0]),
        THREE.MathUtils.degToRad(def.rotation[1]),
        THREE.MathUtils.degToRad(def.rotation[2]),
      );
    }
    if (def.scale) mesh.scale.set(...def.scale);

    return mesh;
  }

  /**
   * 武器モデル(FBX/GLB)をロードしてコントローラーグリップにアタッチする
   * @param {string} path - モデルファイルのパス
   * @param {object} weaponConfig - layout.json の weapon 設定
   *
   * NOTE: FBX は Three.js の FBXLoader で読み込める。
   *   ただしファイルサイズが大きい場合は Blender で GLB に変換すると
   *   読み込みが速く、テクスチャも自動でまとめられるのでオススメ。
   *   変換方法: Blender → File → Export → glTF2.0(.glb)
   */
  async _loadWeaponModel(path, weaponConfig) {
    const ext = path.split('.').pop().toLowerCase();
    const loader = ext === 'fbx' ? new FBXLoader() : new GLTFLoader();

    try {
      let model;
      if (ext === 'fbx') {
        // FBXLoaderは直接GroupオブジェクトをPromiseで返さないため変換
        model = await new Promise((resolve, reject) => {
          loader.load(path, resolve, undefined, reject);
        });
      } else {
        const gltf = await loader.loadAsync(path);
        model = gltf.scene;
      }

      // テクスチャを適用(FBXの場合、テクスチャパスが相対参照になることがあるため手動設定)
      if (ext === 'fbx' && weaponConfig.texturesPath) {
        this._applyFbxTextures(model, weaponConfig.texturesPath);
      }

      // スケール・位置・回転を layout.json の設定から適用
      if (weaponConfig.scale) model.scale.set(...weaponConfig.scale);
      if (weaponConfig.position) model.position.set(...weaponConfig.position);
      if (weaponConfig.rotation) {
        model.rotation.set(
          THREE.MathUtils.degToRad(weaponConfig.rotation[0]),
          THREE.MathUtils.degToRad(weaponConfig.rotation[1]),
          THREE.MathUtils.degToRad(weaponConfig.rotation[2]),
        );
      }

      // 右手コントローラーグリップにアタッチ(handedness: 'right' = index 1)
      const gripIndex = weaponConfig.hand === 'left' ? 0 : 1;
      if (this._controllerGrips[gripIndex]) {
        this._controllerGrips[gripIndex].add(model);
      }

      this.weaponModel = model;
      console.log('[SceneManager] 武器モデルをロードしました:', path);
    } catch (e) {
      console.warn('[SceneManager] 武器モデルのロードに失敗(プレースホルダーを使用):', e);
      this._createPlaceholderWeapon(weaponConfig);
    }
  }

  /**
   * FBXモデルにテクスチャを手動で適用する
   * FBXのマテリアルがテクスチャを見つけられない場合のフォールバック
   * @param {THREE.Group} model
   * @param {string} texturesPath
   */
  _applyFbxTextures(model, texturesPath) {
    const loader = new THREE.TextureLoader();
    model.traverse((child) => {
      if (!child.isMesh) return;
      const mat = child.material;
      if (!mat) return;

      // Diffuseテクスチャ: マテリアル名に Black/Dark/White が含まれるか判定
      const name = (mat.name || '').toLowerCase();
      let diffuseFile = 'Pistol Black Diffuse.png'; // デフォルト
      if (name.includes('dark'))  diffuseFile = 'Pistol Dark Diffuse.png';
      if (name.includes('white')) diffuseFile = 'Pistol White Diffuse.png';

      loader.load(
        `${texturesPath}${diffuseFile}`,
        (tex) => { mat.map = tex; mat.needsUpdate = true; },
        undefined,
        () => {} // テクスチャが見つからなくても無視
      );

      // Normalマップ
      loader.load(
        `${texturesPath}Pistol Normal.png`,
        (tex) => { mat.normalMap = tex; mat.needsUpdate = true; },
      );

      // Metallicマップ
      loader.load(
        `${texturesPath}Pistol Metallic.png`,
        (tex) => { mat.metalnessMap = tex; mat.roughnessMap = tex; mat.needsUpdate = true; },
      );

      // Emissionマップ
      loader.load(
        `${texturesPath}Pistol Emission.png`,
        (tex) => { mat.emissiveMap = tex; mat.emissive = new THREE.Color(0x111111); mat.needsUpdate = true; },
      );
    });
  }

  /**
   * モデルが無い場合のプレースホルダー武器(Box)
   * @param {object} weaponConfig
   */
  _createPlaceholderWeapon(weaponConfig) {
    const geometry = new THREE.BoxGeometry(0.05, 0.08, 0.2);
    const material = new THREE.MeshPhongMaterial({ color: 0x444444 });
    const mesh = new THREE.Mesh(geometry, material);

    if (weaponConfig.position) mesh.position.set(...weaponConfig.position);

    const gripIndex = weaponConfig.hand === 'left' ? 0 : 1;
    if (this._controllerGrips[gripIndex]) {
      this._controllerGrips[gripIndex].add(mesh);
    }
  }

  /**
   * ウィンドウリサイズ対応
   */
  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * シーンをリセットする
   */
  reset() {
    // 動的に追加されたオブジェクトを除去(ライト・コントローラーは残す)
    // 敵と弾は各モジュールで管理されているので、ここでは何もしない
  }
}
