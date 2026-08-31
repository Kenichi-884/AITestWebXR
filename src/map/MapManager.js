/**
 * MapManager - フィールド(マップ)と、敵以外のインタラクション可能オブジェクト
 * ============================================================
 * 担当: マップ・フィールド担当メンバー
 *
 * 世界観: ファイナルファンタジー風「クリスタルと古代遺跡」
 *   - 足元に魔法陣、周囲に浮遊クリスタル、外周に古代遺跡の石柱
 *   - 天空に大クリスタルと光の柱、空間にライフストリーム風の光の粒
 *
 * 敵以外のインタラクション対象(撃つと反応する):
 *   宝箱(TreasureChest)  - 開くと光が溢れる。1回きり。報酬あり
 *   魔法の壺(MagicPot)   - 割れる。一定時間で復活。報酬あり
 *   セーブポイント        - 光の柱が脈動する。クールダウンあり
 *
 * 作業ガイド:
 *   - 配置・個数・報酬は下の MAP_CONFIG を変えるだけで調整できる
 *   - オブジェクトを増やすには _buildXxx() を作って _build() から呼ぶ
 *   - 当たり判定は自前のレイキャスト(_onWeaponFired)なので Weapon.js の変更は不要
 *   - 毎フレーム更新は scene.onBeforeRender にぶら下げているので App.js の
 *     ゲームループに手を入れる必要はない(XRセッション中も呼ばれる)
 *
 * 発火するイベント:
 *   map:reward      - 報酬を獲得 { points, kind, position }
 *   map:save-point  - セーブポイントを起動 { position }
 *
 * NOTE: map:reward はまだスコアに接続していない。接続するには
 *       ScoreManager 側で購読するか、App.js の _addScore を呼ぶ必要がある。
 *
 * このファイルで触るもの: このファイル + App.js の生成1行のみ
 * ============================================================
 */

import * as THREE from 'three';
import EventBus from '../common/EventBus.js';
import Config from '../common/Config.js';

/** 配置・見た目・報酬の調整値。ここだけ変えれば挙動が変わる */
const MAP_CONFIG = {
  FLOOR_Y: -1.5,          // 床の高さ(layout.json の floor と合わせる)

  CIRCLE_RADIUS: 5.5,     // 足元の魔法陣の半径
  CIRCLE_SPIN: 0.05,      // 魔法陣の回転速度(ラジアン/秒)

  CRYSTAL_COUNT: 6,       // 浮遊クリスタルの数
  CRYSTAL_RADIUS: 7.5,    // 配置半径
  CRYSTAL_HEIGHT: 0.4,    // 浮遊する高さの基準

  PILLAR_COUNT: 8,        // 古代遺跡の石柱の数
  PILLAR_RADIUS: 10.5,    // 配置半径

  MOTE_COUNT: 160,        // 光の粒の数
  MOTE_AREA: 14,          // 光の粒が漂う範囲
  MOTE_SPEED: 0.35,       // 上昇速度

  SKY_CRYSTAL_Y: 11,      // 天空のクリスタルの高さ

  // 敵のスポーンは半径3〜6mなので、それを避けて配置する
  CHEST_POSITIONS: [[-6.2, 0, -5.0], [6.6, 0, -3.4], [-0.8, 0, 7.2]],
  POT_POSITIONS:   [[-7.4, 0, 1.6], [7.6, 0, 2.4], [3.0, 0, -7.6], [-3.4, 0, -7.2]],
  SAVE_POINT_POS:  [0, 0, -9.0],

  CHEST_REWARD: 500,      // 宝箱の報酬
  POT_REWARD: 150,        // 魔法の壺の報酬
  POT_RESPAWN_SEC: 12,    // 壺が復活するまでの秒数
  SAVE_COOLDOWN_SEC: 20,  // セーブポイントの再起動までの秒数

  RAY_FAR: 40,            // レイキャストの到達距離(m)
  HIT_PAD: 0.25,          // 当たり判定の余裕(m) 小さすぎると当てにくい
};

/**
 * 効果音。SoundManager に既にあるIDを流用している。
 * TODO: 専用の音を作る場合はサウンド担当と相談して _soundDefs にIDを追加する
 *       (未定義IDを指定してもコンソール警告が出るだけでゲームは壊れない)
 */
const SOUND_IDS = {
  chest: 'wave-up',
  pot:   'hit',
  save:  'spawn',
};

/** FF風の配色 */
const COLORS = {
  crystalA:  0x66e0ff,   // 水色のクリスタル
  crystalB:  0xc07bff,   // 紫のクリスタル
  circle:    0x7fd8ff,   // 魔法陣
  stone:     0x3a3a48,   // 遺跡の石
  rune:      0x8fe3ff,   // 石柱の紋様
  gold:      0xd9a441,   // 宝箱の金具
  wood:      0x6b4423,   // 宝箱の木部
  pot:       0x4fc4a0,   // 魔法の壺
  save:      0x9ad9ff,   // セーブポイント
  mote:      0x9ef0d8,   // 光の粒
};

export class MapManager {
  /**
   * @param {THREE.Scene} scene SceneManager が持つシーン
   */
  constructor(scene) {
    this.scene = scene;

    /** マップ全体をまとめる親。show/hide や破棄をこれ一つで行える */
    this.root = new THREE.Group();
    this.root.name = 'map-root';
    this.scene.add(this.root);

    /** 毎フレーム更新するもの { obj, fn } */
    this._animated = [];
    /** 撃てるオブジェクト(レイキャスト対象) */
    this._hitTargets = [];
    /** 生成したジオメトリ/マテリアル(破棄用) */
    this._disposables = [];

    this._time = 0;
    this._lastTick = 0;

    this._build();
    this._hookRenderTick();

    EventBus.on('weapon:fired', (d) => this._onWeaponFired(d));
    EventBus.on('game:start', () => this._resetInteractives());
  }

  // ── 毎フレーム更新 ───────────────────────────────────────

  /**
   * scene.onBeforeRender にぶら下がって毎フレーム呼ばれるようにする。
   * NOTE: window.requestAnimationFrame はXRセッション中に止まるため使えない。
   *       renderer.render() が必ず呼ぶ onBeforeRender なら XR でも動く。
   *       既存のコールバックがあれば壊さないよう先に呼ぶ。
   */
  _hookRenderTick() {
    const prev = this.scene.onBeforeRender;
    this.scene.onBeforeRender = (renderer, scene, camera, renderTarget) => {
      if (typeof prev === 'function') {
        prev.call(scene, renderer, scene, camera, renderTarget);
      }
      const now = performance.now() / 1000;
      const delta = this._lastTick ? Math.min(0.1, now - this._lastTick) : 0;
      this._lastTick = now;
      this._update(delta);
    };
  }

  _update(delta) {
    if (delta <= 0) return;
    this._time += delta;
    for (const a of this._animated) a(delta, this._time);
  }

  // ── マップの構築 ─────────────────────────────────────────

  _build() {
    this._buildMagicCircle();
    this._buildCrystals();
    this._buildPillars();
    this._buildMotes();
    this._buildSkyCrystal();

    this._buildTreasureChests();
    this._buildMagicPots();
    this._buildSavePoint();
  }

  /**
   * 足元の魔法陣。
   * NOTE: ARパススルーを潰さないよう、加算合成の半透明にして
   *       「床を塗る」のではなく「光を重ねる」表現にしている。
   */
  _buildMagicCircle() {
    const tex = new THREE.CanvasTexture(this._createMagicCircleCanvas());
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const r = MAP_CONFIG.CIRCLE_RADIUS;
    const geo = new THREE.PlaneGeometry(r * 2, r * 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = MAP_CONFIG.FLOOR_Y + 0.01;
    this.root.add(mesh);
    this._disposables.push(geo, mat, tex);

    this._animated.push((d) => { mesh.rotation.z += MAP_CONFIG.CIRCLE_SPIN * d; });
  }

  /** 魔法陣の模様をキャンバスに描く(画像アセット不要) */
  _createMagicCircleCanvas() {
    const S = 512, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const cx = S / 2, cy = S / 2;
    const col = '#' + COLORS.circle.toString(16).padStart(6, '0');

    g.clearRect(0, 0, S, S);
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = 2.5;

    // 同心円
    for (const rr of [0.96, 0.88, 0.62, 0.56, 0.24]) {
      g.beginPath();
      g.arc(cx, cy, S * 0.5 * rr, 0, Math.PI * 2);
      g.stroke();
    }
    // 外周の目盛り
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const r0 = S * 0.5 * 0.88, r1 = S * 0.5 * (i % 4 === 0 ? 0.80 : 0.845);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
    // 二重三角形(FF的な紋章感)
    g.lineWidth = 3.5;
    for (const off of [0, Math.PI / 3]) {
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = off + (i / 3) * Math.PI * 2 - Math.PI / 2;
        const r = S * 0.5 * 0.56;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.closePath();
      g.stroke();
    }
    // 円周上の小さなルーン(丸)
    g.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = S * 0.5 * 0.72;
      g.beginPath();
      g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 9, 0, Math.PI * 2);
      g.stroke();
    }
    return c;
  }

  /** 浮遊するクリスタル。FFの象徴なのでマップの主役に置く */
  _buildCrystals() {
    const geo = new THREE.OctahedronGeometry(0.42, 0);
    this._disposables.push(geo);

    for (let i = 0; i < MAP_CONFIG.CRYSTAL_COUNT; i++) {
      const t = i / MAP_CONFIG.CRYSTAL_COUNT;
      const a = t * Math.PI * 2;
      const color = i % 2 === 0 ? COLORS.crystalA : COLORS.crystalB;

      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.9,
        roughness: 0.15, metalness: 0.0,
        transparent: true, opacity: 0.85, flatShading: true,
      });
      this._disposables.push(mat);

      const m = new THREE.Mesh(geo, mat);
      m.scale.set(1, 1.9, 1);
      m.position.set(
        Math.cos(a) * MAP_CONFIG.CRYSTAL_RADIUS,
        MAP_CONFIG.FLOOR_Y + 1.6 + MAP_CONFIG.CRYSTAL_HEIGHT,
        Math.sin(a) * MAP_CONFIG.CRYSTAL_RADIUS,
      );
      this.root.add(m);

      const baseY = m.position.y;
      const phase = t * Math.PI * 2;
      this._animated.push((d, time) => {
        m.rotation.y += d * 0.5;
        m.position.y = baseY + Math.sin(time * 0.8 + phase) * 0.22;
        mat.emissiveIntensity = 0.75 + Math.sin(time * 1.4 + phase) * 0.25;
      });
    }
  }

  /** 古代遺跡の石柱。高さをバラして「崩れた遺跡」に見せる */
  _buildPillars() {
    for (let i = 0; i < MAP_CONFIG.PILLAR_COUNT; i++) {
      const a = (i / MAP_CONFIG.PILLAR_COUNT) * Math.PI * 2 + 0.35;
      const h = 1.6 + ((i * 7) % 5) * 0.55;   // 1.6〜3.8m を規則的にばらす

      const geo = new THREE.CylinderGeometry(0.34, 0.42, h, 7);
      const mat = new THREE.MeshStandardMaterial({
        color: COLORS.stone, roughness: 0.9, metalness: 0.05, flatShading: true,
      });
      this._disposables.push(geo, mat);

      const p = new THREE.Mesh(geo, mat);
      p.position.set(
        Math.cos(a) * MAP_CONFIG.PILLAR_RADIUS,
        MAP_CONFIG.FLOOR_Y + h / 2,
        Math.sin(a) * MAP_CONFIG.PILLAR_RADIUS,
      );
      p.rotation.y = a;
      p.rotation.z = (((i % 3) - 1) * 0.035);   // わずかに傾けて崩壊感を出す
      p.castShadow = true;
      this.root.add(p);

      // 石柱に光る紋様の帯を巻く
      const rgeo = new THREE.TorusGeometry(0.38, 0.035, 6, 20);
      const rmat = new THREE.MeshBasicMaterial({
        color: COLORS.rune, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this._disposables.push(rgeo, rmat);

      const ring = new THREE.Mesh(rgeo, rmat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = h * 0.28;
      p.add(ring);

      const phase = i * 0.7;
      this._animated.push((d, time) => {
        rmat.opacity = 0.45 + Math.sin(time * 1.1 + phase) * 0.35;
      });
    }
  }

  /** ライフストリーム風に漂う光の粒 */
  _buildMotes() {
    const n = MAP_CONFIG.MOTE_COUNT;
    const area = MAP_CONFIG.MOTE_AREA;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * area;
      pos[i * 3 + 1] = MAP_CONFIG.FLOOR_Y + Math.random() * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * area;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color: COLORS.mote, size: 0.07, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this._disposables.push(geo, mat);

    const points = new THREE.Points(geo, mat);
    this.root.add(points);

    const attr = geo.getAttribute('position');
    const topY = MAP_CONFIG.FLOOR_Y + 8;
    this._animated.push((d) => {
      for (let i = 0; i < n; i++) {
        let y = attr.getY(i) + MAP_CONFIG.MOTE_SPEED * d;
        if (y > topY) y = MAP_CONFIG.FLOOR_Y;   // 上まで行ったら足元へ戻す
        attr.setY(i, y);
      }
      attr.needsUpdate = true;
    });
  }

  /** 天空の大クリスタルと、そこから降りる光の柱 */
  _buildSkyCrystal() {
    const geo = new THREE.OctahedronGeometry(1.5, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.crystalA, emissive: COLORS.crystalA, emissiveIntensity: 1.1,
      roughness: 0.1, metalness: 0.0,
      transparent: true, opacity: 0.7, flatShading: true,
    });
    this._disposables.push(geo, mat);

    const m = new THREE.Mesh(geo, mat);
    m.scale.set(1, 1.7, 1);
    m.position.set(0, MAP_CONFIG.SKY_CRYSTAL_Y, -2);
    this.root.add(m);

    // 光の柱(下ほど広がる円錐)
    const bh = MAP_CONFIG.SKY_CRYSTAL_Y - MAP_CONFIG.FLOOR_Y;
    const bgeo = new THREE.CylinderGeometry(0.5, 2.6, bh, 20, 1, true);
    const bmat = new THREE.MeshBasicMaterial({
      color: COLORS.crystalA, transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this._disposables.push(bgeo, bmat);

    const beam = new THREE.Mesh(bgeo, bmat);
    beam.position.set(0, MAP_CONFIG.FLOOR_Y + bh / 2, -2);
    this.root.add(beam);

    this._animated.push((d, time) => {
      m.rotation.y += d * 0.18;
      m.position.y = MAP_CONFIG.SKY_CRYSTAL_Y + Math.sin(time * 0.4) * 0.35;
      bmat.opacity = 0.05 + Math.sin(time * 0.7) * 0.025;
    });
  }

  // ── インタラクション可能オブジェクト ──────────────────────

  /** 宝箱: 撃つと蓋が開いて光が溢れる。1ゲームにつき1回 */
  _buildTreasureChests() {
    for (const [x, , z] of MAP_CONFIG.CHEST_POSITIONS) {
      const g = new THREE.Group();
      g.position.set(x, MAP_CONFIG.FLOOR_Y, z);
      g.rotation.y = Math.atan2(-x, -z);   // プレイヤー(原点)の方を向かせる
      this.root.add(g);

      const woodMat = new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.8 });
      const goldMat = new THREE.MeshStandardMaterial({
        color: COLORS.gold, roughness: 0.35, metalness: 0.8,
        emissive: COLORS.gold, emissiveIntensity: 0.15,
      });
      this._disposables.push(woodMat, goldMat);

      const bodyGeo = new THREE.BoxGeometry(0.7, 0.42, 0.5);
      const body = new THREE.Mesh(bodyGeo, woodMat);
      body.position.y = 0.21;
      g.add(body);

      const bandGeo = new THREE.BoxGeometry(0.74, 0.08, 0.54);
      const band = new THREE.Mesh(bandGeo, goldMat);
      band.position.y = 0.21;
      g.add(band);

      // 蓋は後ろ端を軸に回転させたいので、ピボット用のGroupに入れる
      const lidPivot = new THREE.Group();
      lidPivot.position.set(0, 0.42, -0.25);
      g.add(lidPivot);

      const lidGeo = new THREE.BoxGeometry(0.7, 0.14, 0.5);
      const lid = new THREE.Mesh(lidGeo, woodMat);
      lid.position.set(0, 0.07, 0.25);
      lidPivot.add(lid);

      this._disposables.push(bodyGeo, bandGeo, lidGeo);

      // 開いたときに溢れる光
      const glowGeo = new THREE.SphereGeometry(0.3, 12, 10);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xffe9a8, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this._disposables.push(glowGeo, glowMat);
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.y = 0.4;
      g.add(glow);

      const state = { kind: 'chest', opened: false, lidPivot, glow, glowMat, group: g, t: 0 };
      this._registerTarget(body, state);
      this._registerTarget(lid, state);

      this._animated.push((d, time) => {
        if (!state.opened) {
          // 未開封は金具がゆっくり明滅して「触れる物」だと示す
          goldMat.emissiveIntensity = 0.12 + Math.sin(time * 1.6) * 0.10;
          return;
        }
        state.t += d;
        const p = Math.min(1, state.t / 0.45);
        lidPivot.rotation.x = -THREE.MathUtils.lerp(0, 1.9, this._easeOut(p));
        const gp = Math.min(1, state.t / 0.9);
        glow.scale.setScalar(0.5 + gp * 2.4);
        glowMat.opacity = (1 - gp) * 0.85;
      });
    }
  }

  /** 魔法の壺: 撃つと割れて、一定時間後に復活する */
  _buildMagicPots() {
    for (const [x, , z] of MAP_CONFIG.POT_POSITIONS) {
      const geo = new THREE.SphereGeometry(0.3, 14, 10);
      const mat = new THREE.MeshStandardMaterial({
        color: COLORS.pot, emissive: COLORS.pot, emissiveIntensity: 0.35,
        roughness: 0.5, metalness: 0.1,
      });
      const rimGeo = new THREE.TorusGeometry(0.16, 0.045, 6, 16);
      const rimMat = new THREE.MeshStandardMaterial({
        color: COLORS.gold, roughness: 0.4, metalness: 0.7,
      });
      this._disposables.push(geo, mat, rimGeo, rimMat);

      const g = new THREE.Group();
      g.position.set(x, MAP_CONFIG.FLOOR_Y + 0.3, z);
      this.root.add(g);

      const body = new THREE.Mesh(geo, mat);
      body.scale.set(1, 1.15, 1);
      g.add(body);

      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.3;
      g.add(rim);

      const state = { kind: 'pot', broken: false, group: g, mat, timer: 0, baseY: g.position.y };
      this._registerTarget(body, state);

      const phase = x + z;
      this._animated.push((d, time) => {
        if (state.broken) {
          state.timer -= d;
          // 割れた直後は縮みながら消える
          const s = Math.max(0, Math.min(1, state.timer / MAP_CONFIG.POT_RESPAWN_SEC));
          g.scale.setScalar(state.timer > MAP_CONFIG.POT_RESPAWN_SEC - 0.3
            ? (state.timer - (MAP_CONFIG.POT_RESPAWN_SEC - 0.3)) / 0.3
            : 0);
          if (state.timer <= 0) {
            state.broken = false;
            g.scale.setScalar(1);
            g.visible = true;
          } else if (s <= 0) {
            g.visible = false;
          }
          return;
        }
        g.position.y = state.baseY + Math.sin(time * 1.2 + phase) * 0.06;
        g.rotation.y += d * 0.4;
        state.mat.emissiveIntensity = 0.3 + Math.sin(time * 2 + phase) * 0.15;
      });
    }
  }

  /** セーブポイント: FFでおなじみの光の柱。撃つと脈動する */
  _buildSavePoint() {
    const [x, , z] = MAP_CONFIG.SAVE_POINT_POS;
    const g = new THREE.Group();
    g.position.set(x, MAP_CONFIG.FLOOR_Y, z);
    this.root.add(g);

    const pgeo = new THREE.CylinderGeometry(0.45, 0.45, 2.6, 20, 1, true);
    const pmat = new THREE.MeshBasicMaterial({
      color: COLORS.save, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this._disposables.push(pgeo, pmat);
    const pillar = new THREE.Mesh(pgeo, pmat);
    pillar.position.y = 1.3;
    g.add(pillar);

    const rgeo = new THREE.RingGeometry(0.5, 0.75, 28);
    const rmat = new THREE.MeshBasicMaterial({
      color: COLORS.save, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this._disposables.push(rgeo, rmat);
    const ring = new THREE.Mesh(rgeo, rmat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);

    const light = new THREE.PointLight(COLORS.save, 1.2, 6);
    light.position.set(0, 1.0, 0);
    g.add(light);

    const state = { kind: 'save', cooldown: 0, pulse: 0 };
    this._registerTarget(pillar, state);

    this._animated.push((d, time) => {
      if (state.cooldown > 0) state.cooldown -= d;
      if (state.pulse > 0) state.pulse -= d;

      const active = state.cooldown <= 0;
      const pulse = state.pulse > 0 ? state.pulse / 0.8 : 0;
      ring.rotation.z += d * 0.6;
      pmat.opacity = (active ? 0.20 : 0.07) + Math.sin(time * 2.2) * 0.05 + pulse * 0.5;
      rmat.opacity = (active ? 0.65 : 0.25) + pulse * 0.35;
      light.intensity = (active ? 1.1 : 0.4) + pulse * 2.5;
    });
  }

  // ── 当たり判定 ───────────────────────────────────────────

  /** レイキャスト対象として登録する */
  _registerTarget(mesh, state) {
    mesh.userData.mapState = state;
    this._hitTargets.push(mesh);
  }

  /**
   * 射撃イベントを受けて、自前のレイキャストで当たりを判定する。
   * NOTE: Weapon.js の弾は実際に飛ぶので、当たった瞬間ではなく
   *       弾が届くまでの時間を置いてから反応させて違和感を減らす。
   */
  _onWeaponFired({ position, direction }) {
    if (!position || !direction) return;

    const ray = new THREE.Raycaster(
      position.clone(),
      direction.clone().normalize(),
      0,
      MAP_CONFIG.RAY_FAR,
    );
    const hits = ray.intersectObjects(this._hitTargets, false);
    if (hits.length === 0) return;

    const hit = hits.find((h) => this._isHittable(h.object));
    if (!hit) return;

    const travelSec = hit.distance / Config.WEAPON.BULLET_SPEED;
    setTimeout(() => this._applyHit(hit.object, hit.point), travelSec * 1000);
  }

  /** 既に開封済み/破壊済み/クールダウン中のものは当たらない扱いにする */
  _isHittable(mesh) {
    const s = mesh.userData.mapState;
    if (!s) return false;
    if (s.kind === 'chest') return !s.opened;
    if (s.kind === 'pot') return !s.broken;
    if (s.kind === 'save') return s.cooldown <= 0;
    return false;
  }

  _applyHit(mesh, point) {
    const s = mesh.userData.mapState;
    if (!s || !this._isHittable(mesh)) return;

    if (s.kind === 'chest') {
      s.opened = true;
      s.t = 0;
      s.glowMat.opacity = 0.85;
      EventBus.emit('sound:play', { id: SOUND_IDS.chest });
      EventBus.emit('map:reward', {
        points: MAP_CONFIG.CHEST_REWARD, kind: 'chest', position: point,
      });
      return;
    }

    if (s.kind === 'pot') {
      s.broken = true;
      s.timer = MAP_CONFIG.POT_RESPAWN_SEC;
      EventBus.emit('sound:play', { id: SOUND_IDS.pot });
      EventBus.emit('map:reward', {
        points: MAP_CONFIG.POT_REWARD, kind: 'pot', position: point,
      });
      return;
    }

    if (s.kind === 'save') {
      s.cooldown = MAP_CONFIG.SAVE_COOLDOWN_SEC;
      s.pulse = 0.8;
      EventBus.emit('sound:play', { id: SOUND_IDS.save });
      EventBus.emit('map:save-point', { position: point });
    }
  }

  /** ゲーム開始/リスタート時に宝箱と壺を元に戻す */
  _resetInteractives() {
    for (const mesh of this._hitTargets) {
      const s = mesh.userData.mapState;
      if (!s) continue;
      if (s.kind === 'chest') {
        s.opened = false;
        s.t = 0;
        s.lidPivot.rotation.x = 0;
        s.glowMat.opacity = 0;
        s.glow.scale.setScalar(1);
      } else if (s.kind === 'pot') {
        s.broken = false;
        s.timer = 0;
        s.group.visible = true;
        s.group.scale.setScalar(1);
      } else if (s.kind === 'save') {
        s.cooldown = 0;
        s.pulse = 0;
      }
    }
  }

  // ── ユーティリティ ───────────────────────────────────────

  _easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  /** マップの表示/非表示(メニュー中に隠したい場合など) */
  setVisible(visible) { this.root.visible = visible; }

  /** 破棄してGPUリソースを解放する */
  dispose() {
    this.scene.remove(this.root);
    for (const d of this._disposables) d.dispose?.();
    this._disposables.length = 0;
    this._animated.length = 0;
    this._hitTargets.length = 0;
  }
}
