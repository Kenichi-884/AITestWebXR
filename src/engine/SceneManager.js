/**
 * SceneManager - Three.jsシーン・ライティング・静的オブジェクトの管理
 * ============================================================
 * 担当: シーン・アセット管理担当メンバー
 *
 * 作業ガイド:
 *   - ライティング変更         → _setupLighting()
 *   - 武器の位置・サイズ調整   → public/assets/layout.json の xr / desktop セクション
 *   - 3Dモデル差し替え        → layout.json の modelFile を変更
 *   - デスクトップ/XR切替     → App.js から setWeaponMode() を呼ぶ
 *
 * このファイルで触るもの: このファイルのみ
 * ============================================================
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import Config from '../common/Config.js';
import EventBus from '../common/EventBus.js';

export class SceneManager {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);

    /** @type {THREE.Object3D|null} */
    this.weaponModel = null;
    /** @type {object|null} layout.json の weapon 設定 */
    this._weaponConfig = null;
    /** @type {'xr'|'desktop'} */
    this._weaponMode = 'xr';

    // スライドアニメーション
    /** @type {THREE.Object3D|null} */
    this._slideNode = null;
    this._slideBase = 0;   // スライド軸の初期値
    this._slideAxis = 'x'; // 移動軸 ('x'|'y'|'z'|'-x'|'-y'|'-z')
    this._slideAnim = null; // { elapsed, duration }

    EventBus.on('weapon:fired', () => this._triggerSlideAnim());

    this._controllers = [];
    this._controllerGrips = [];
    this._controllerRays = [];
    /** @type {THREE.Line|null} 武器モデルの子として銃口に追従するレーザー */
    this._muzzleRay = null;

    // デスクトップ用: カメラに追従する武器ホルダー
    this._desktopWeaponHolder = new THREE.Group();
    this.camera.add(this._desktopWeaponHolder);

    this._setupScene();
    this._setupLighting();
    this._setupEnvironment();
    this._setupControllers();
    this._loadLayout();

    window.addEventListener('resize', this._onResize.bind(this));
  }

  // ─── シーン基本設定 ───────────────────────────────────────

  _setupScene() {
    this.scene.background = null; // AR(パススルー)用に透明
    this.scene.fog = new THREE.Fog(0x111122, Config.SCENE.FOG_NEAR, Config.SCENE.FOG_FAR);
  }

  _setupLighting() {
    // HemisphereLight: MeshStandardMaterial の PBR に必要な環境光
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444466, 0.8);
    this.scene.add(hemi);

    this.scene.add(new THREE.AmbientLight(0xffffff, Config.SCENE.AMBIENT_LIGHT_INTENSITY));

    const dirLight = new THREE.DirectionalLight(0xffffff, Config.SCENE.DIR_LIGHT_INTENSITY);
    dirLight.position.set(3, 5, 3);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    const accentLight = new THREE.PointLight(0x0044ff, 0.3, 10);
    accentLight.position.set(-3, 2, -3);
    this.scene.add(accentLight);
  }

  /**
   * PBR 用の環境マップをセットアップする
   * 金属面の反射品質が向上する
   */
  _setupEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
    pmrem.dispose();
  }

  // ─── XR コントローラー ────────────────────────────────────

  _setupControllers() {
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      this.scene.add(controller);
      this._controllers.push(controller);

      const ray = this._createControllerRay();
      controller.add(ray);
      this._controllerRays.push(ray);

      const grip = this.renderer.xr.getControllerGrip(i);
      this.scene.add(grip);
      this._controllerGrips.push(grip);
    }
  }

  _createControllerRay() {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -10),
    ]);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xff4444, transparent: true, opacity: 0.6,
    }));
  }

  /**
   * 銃口から出るレーザーを武器モデルの子として生成する
   * (layout.json の muzzleOffset = モデルローカル座標での銃口位置/向き。
   *  GLB頂点データ解析で求めた値。武器の position/rotation/scale をどう調整しても自動追従する)
   */
  _createMuzzleRay(weaponConfig) {
    const off = weaponConfig.muzzleOffset;
    if (!off || !this.weaponModel) return;

    const start = new THREE.Vector3(...off.position);
    const dir = new THREE.Vector3(...off.direction).normalize();
    // レイの長さ(ローカル単位): 現在のscaleでワールド換算 約10mになるよう逆算
    const scale = weaponConfig.xr?.scale?.[0] || 1;
    const end = start.clone().addScaledVector(dir, 10 / scale);

    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    this._muzzleRay = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xff4444, transparent: true, opacity: 0.6,
    }));
    this._muzzleRay.visible = this._weaponMode === 'xr';
    this.weaponModel.add(this._muzzleRay);

    // 元のコントローラーレーザーは銃口レーザーと重複するので、武器を持つ手の分は非表示にする
    const handIndex = weaponConfig.hand === 'left' ? 0 : 1;
    const oldRay = this._controllerRays[handIndex];
    if (oldRay) {
      this._controllers[handIndex]?.remove(oldRay);
      this._controllerRays[handIndex] = null;
    }
  }

  // ─── 武器モード切替 (App.js から呼ぶ) ────────────────────

  /**
   * 武器をXR用/デスクトップ用に切り替える
   * @param {'xr'|'desktop'} mode
   */
  setWeaponMode(mode) {
    this._weaponMode = mode;

    // デスクトップではコントローラーのレーザーを非表示
    for (const ray of this._controllerRays) {
      if (ray) ray.visible = mode === 'xr';
    }
    if (this._muzzleRay) this._muzzleRay.visible = mode === 'xr';

    if (this.weaponModel) this._attachWeapon(mode);
  }

  /**
   * 武器モデルを指定モードの親にアタッチし、位置・回転・スケールを適用する
   * 位置などの数値は layout.json の xr / desktop セクションで管理
   * @param {'xr'|'desktop'} mode
   */
  _attachWeapon(mode) {
    if (!this.weaponModel || !this._weaponConfig) return;

    // 現在の親から切り離す
    this.weaponModel.parent?.remove(this.weaponModel);

    const cfg = this._weaponConfig[mode] ?? this._weaponConfig.xr;

    if (mode === 'desktop') {
      this._desktopWeaponHolder.add(this.weaponModel);
    } else {
      const handIndex = this._weaponConfig.hand === 'left' ? 0 : 1;
      this._controllerGrips[handIndex]?.add(this.weaponModel);
    }

    this.weaponModel.position.set(...cfg.position);
    this.weaponModel.rotation.set(
      THREE.MathUtils.degToRad(cfg.rotation[0]),
      THREE.MathUtils.degToRad(cfg.rotation[1]),
      THREE.MathUtils.degToRad(cfg.rotation[2]),
    );
    this.weaponModel.scale.set(...cfg.scale);
  }

  // ─── レイアウト / モデル読み込み ─────────────────────────

  async _loadLayout() {
    try {
      const res = await fetch('/assets/layout.json');
      const layout = await res.json();

      for (const obj of layout.staticObjects ?? []) {
        if (!obj.visible) continue;
        const mesh = this._createStaticObject(obj);
        if (mesh) this.scene.add(mesh);
      }

      if (layout.weapon?.modelFile) {
        const path = `${layout.weapon.modelPath}${layout.weapon.modelFile}`;
        await this._loadWeaponModel(path, layout.weapon);
      }
    } catch (e) {
      console.warn('[SceneManager] layout.json load failed:', e);
    }
  }

  _createStaticObject(def) {
    let geometry;
    switch (def.type) {
      case 'plane':  geometry = new THREE.PlaneGeometry(1, 1); break;
      case 'box':    geometry = new THREE.BoxGeometry(1, 1, 1); break;
      case 'sphere': geometry = new THREE.SphereGeometry(0.5, 16, 16); break;
      default: return null;
    }
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color ?? '#888888') }),
    );
    if (def.position) mesh.position.set(...def.position);
    if (def.rotation) mesh.rotation.set(
      ...def.rotation.map(THREE.MathUtils.degToRad),
    );
    if (def.scale) mesh.scale.set(...def.scale);
    return mesh;
  }

  /**
   * FBX / GLB モデルを読み込んでコントローラーまたはカメラにアタッチする
   *
   * NOTE: FBX → GLB 変換(Blender: File → Export → glTF 2.0)で
   *       読み込みが速くなり、テクスチャも自動でまとめられる。
   */
  async _loadWeaponModel(path, weaponConfig) {
    const ext = path.split('.').pop().toLowerCase();
    const loader = ext === 'fbx' ? new FBXLoader() : new GLTFLoader();

    try {
      let model;
      if (ext === 'fbx') {
        model = await new Promise((resolve, reject) =>
          loader.load(path, resolve, undefined, reject),
        );
        this._applyFbxMaterials(model, weaponConfig.texturesPath);
      } else {
        model = (await loader.loadAsync(path)).scene;
      }

      this.weaponModel = model;
      this._weaponConfig = weaponConfig;
      this._slideAxis = weaponConfig.slideAxis ?? 'x';
      this._findSlideNode(model, weaponConfig.slideNodeName ?? '');
      this._attachWeapon(this._weaponMode);
      this._createMuzzleRay(weaponConfig);
      console.log('[SceneManager] Weapon loaded:', path);
    } catch (e) {
      console.warn('[SceneManager] Weapon load failed, using placeholder:', e);
      this._createPlaceholderWeapon(weaponConfig);
    }
  }

  /**
   * FBX モデルの全マテリアルを MeshStandardMaterial (PBR) に置き換え、
   * テクスチャを適用する
   *
   * MeshStandardMaterial を使う理由:
   *   - 環境マップによる金属反射が自動で適用される
   *   - roughness / metalness で物理ベースのリアルな質感が出る
   *   - MeshPhongMaterial より照明の計算が正確
   */
  _applyFbxMaterials(model, texturesPath) {
    const texLoader = new THREE.TextureLoader();

    const load = (file, colorSpace = false) => new Promise((resolve) => {
      texLoader.load(
        texturesPath + file,
        (tex) => {
          if (colorSpace) tex.colorSpace = THREE.SRGBColorSpace;
          resolve(tex);
        },
        undefined,
        (err) => {
          console.warn('[SceneManager] Texture load failed:', texturesPath + file, err);
          resolve(null);
        },
      );
    });

    model.traverse(async (child) => {
      if (!child.isMesh) return;

      const oldMat = Array.isArray(child.material) ? child.material[0] : child.material;
      const matName = (oldMat?.name ?? '').toLowerCase();

      // デフォルト色を暗いグレーにする(テクスチャ未適用時に真っ白にならないよう)
      const stdMat = new THREE.MeshStandardMaterial({
        name: oldMat?.name ?? '',
        color: 0x333333,
        roughness: 0.4,
        metalness: 0.7,
        envMapIntensity: 0.8,
      });
      oldMat?.dispose();
      child.material = stdMat;
      child.castShadow = true;
      child.receiveShadow = true;

      // Diffuse: マテリアル名で色バリエーションを判定
      let diffuseFile = 'pistol-black-diffuse.png';
      if (matName.includes('dark'))  diffuseFile = 'pistol-dark-diffuse.png';
      if (matName.includes('white')) diffuseFile = 'pistol-white-diffuse.png';

      const [diffuse, normal, metallic, emission] = await Promise.all([
        load(diffuseFile, true),
        load('pistol-normal.png'),
        load('pistol-metallic.png'),
        load('pistol-emission.png', true),
      ]);

      if (diffuse)  { stdMat.map = diffuse; }
      if (normal)   { stdMat.normalMap = normal; stdMat.normalScale.set(1.2, 1.2); }
      if (metallic) { stdMat.metalnessMap = metallic; stdMat.roughnessMap = metallic; }
      if (emission) { stdMat.emissiveMap = emission; stdMat.emissive = new THREE.Color(0x111111); }

      stdMat.needsUpdate = true;
    });
  }

  /**
   * モデルが読み込めない場合のプレースホルダー(灰色のBox)
   */
  _createPlaceholderWeapon(weaponConfig) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.08, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.8 }),
    );
    this.weaponModel = mesh;
    this._weaponConfig = weaponConfig;
    this._attachWeapon(this._weaponMode);
  }

  // ─── スライドアニメーション ───────────────────────────────

  /**
   * モデル内からスライドノードを探してキャッシュする
   *
   * 優先順位:
   *   1. layout.json の weapon.slideNodeName が設定されている場合はその名前で検索
   *   2. キーワード ("slide" / "bolt" など) を含む名前を自動検索
   *   3. 見つからない場合は全ノード名をコンソールに出力する
   *
   * @param {THREE.Object3D} model
   * @param {string} [overrideName] layout.json の slideNodeName
   */
  _findSlideNode(model, overrideName = '') {
    const SLIDE_KEYWORDS = ['slide', 'slider', 'bolt', 'action', 'reciprocating'];

    model.traverse((child) => {
      if (this._slideNode) return;
      const name = child.name;
      if (overrideName) {
        if (name === overrideName) {
          this._slideNode = child;
          this._slideBase = this._getPosOnAxis(child.position);
        }
      } else if (name) {
        const lower = name.toLowerCase();
        if (SLIDE_KEYWORDS.some((kw) => lower.includes(kw))) {
          this._slideNode = child;
          this._slideBase = this._getPosOnAxis(child.position);
        }
      }
    });
  }

  /** 指定軸の現在値を取得する */
  _getPosOnAxis(pos) {
    const ax = this._slideAxis.replace('-', '');
    return pos[ax] ?? pos.x;
  }

  _triggerSlideAnim() {
    if (!this._slideNode) return;
    this._slideAnim = { elapsed: 0, duration: 0.12 };
  }

  /**
   * @param {number} delta 秒
   */
  update(delta) {
    if (!this._slideAnim || !this._slideNode) return;
    const anim = this._slideAnim;
    anim.elapsed += delta;
    const t = Math.min(anim.elapsed / anim.duration, 1);

    // 前半40%: スライドが後退、後半60%: 前進して戻る
    const TRAVEL = 90; // FBX単位 (scale 0.0002 適用後 ≈ 1.8cm)
    const offset = t < 0.4
      ? (t / 0.4) * TRAVEL
      : ((1 - t) / 0.6) * TRAVEL;

    const negative = this._slideAxis.startsWith('-');
    const ax = this._slideAxis.replace('-', '');
    this._slideNode.position[ax] = this._slideBase + (negative ? -offset : offset);

    if (t >= 1) {
      this._slideNode.position[ax] = this._slideBase;
      this._slideAnim = null;
    }
  }

  // ─── リサイズ / リセット ──────────────────────────────────

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  reset() {}
}
