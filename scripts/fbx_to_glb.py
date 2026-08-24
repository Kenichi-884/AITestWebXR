"""
FBX → GLB 変換スクリプト (Blenderヘッドレス実行用)
テクスチャを1024px以下にリサイズしてWebP埋め込みで出力する
使用方法: blender --background --python scripts/fbx_to_glb.py
"""

import bpy
import os

# ── パス設定 ───────────────────────────────────────────────────
BASE_DIR  = r"C:\Users\kenic\wkspaces\AITestWebXR\public\assets\pistol"
TEX_DIR   = os.path.join(BASE_DIR, "textures")
MODEL_DIR = os.path.join(BASE_DIR, "models")

TARGETS = [
    ("pistol-92.fbx",           "pistol-92.glb"),
    ("pistol-bullet-shell.fbx", "pistol-bullet-shell.glb"),
]

MAX_TEX_SIZE = 1024  # WebXR向けテクスチャ最大解像度

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def load_image(filename, is_color=False):
    """テクスチャを読み込み、MAX_TEX_SIZE以下にリサイズして返す。"""
    path = os.path.join(TEX_DIR, filename)
    if not os.path.exists(path):
        print(f"  [WARN] テクスチャ未検出: {path}")
        return None

    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'sRGB' if is_color else 'Non-Color'

    # リサイズ (アスペクト比維持、長辺をMAX_TEX_SIZEに)
    w, h = img.size
    if w > MAX_TEX_SIZE or h > MAX_TEX_SIZE:
        scale = MAX_TEX_SIZE / max(w, h)
        new_w = max(1, round(w * scale))
        new_h = max(1, round(h * scale))
        img.scale(new_w, new_h)
        print(f"  リサイズ: {filename} {w}x{h} → {new_w}x{new_h}")

    return img

def make_tex_node(nodes, image, label, loc):
    if image is None:
        return None
    n = nodes.new('ShaderNodeTexImage')
    n.image = image
    n.label = label
    n.location = loc
    return n

def setup_material(mat, img_cache):
    """
    マテリアルにPrincipled BSDFとテクスチャを設定する。
    img_cache: 同一テクスチャを複数マテリアルで共有するためのキャッシュ
    """
    mat_lower = mat.name.lower()

    # Diffuseテクスチャの選択
    if 'dark' in mat_lower:
        diffuse_file = 'pistol-dark-diffuse.png'
    elif 'white' in mat_lower:
        diffuse_file = 'pistol-white-diffuse.png'
    else:
        diffuse_file = 'pistol-black-diffuse.png'

    # 画像を共有キャッシュから取得（未ロードなら読み込む）
    def get_img(fname, is_color):
        if fname not in img_cache:
            img_cache[fname] = load_image(fname, is_color)
        return img_cache[fname]

    img_diffuse  = get_img(diffuse_file,         is_color=True)
    img_normal   = get_img('pistol-normal.png',  is_color=False)
    img_metallic = get_img('pistol-metallic.png',is_color=False)
    img_emission = get_img('pistol-emission.png',is_color=True)

    # ノード初期化
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    # Principled BSDF
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (0, 300)
    bsdf.inputs['Roughness'].default_value = 0.4
    bsdf.inputs['Metallic'].default_value  = 0.7

    out = nodes.new('ShaderNodeOutputMaterial')
    out.location = (350, 300)
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # Diffuse
    n = make_tex_node(nodes, img_diffuse, 'Diffuse', (-600, 500))
    if n:
        links.new(n.outputs['Color'], bsdf.inputs['Base Color'])

    # Metallic (Roughnessは別ノードで繋がないことでWARNINGを回避)
    n = make_tex_node(nodes, img_metallic, 'Metallic', (-600, 200))
    if n:
        links.new(n.outputs['Color'], bsdf.inputs['Metallic'])
        # Roughnessは定数のまま (マップ共有のWARNINGを避けるため)

    # Normal
    n = make_tex_node(nodes, img_normal, 'Normal', (-700, -100))
    if n:
        nm = nodes.new('ShaderNodeNormalMap')
        nm.location = (-350, -100)
        nm.inputs['Strength'].default_value = 1.2
        links.new(n.outputs['Color'], nm.inputs['Color'])
        links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])

    # Emission
    n = make_tex_node(nodes, img_emission, 'Emission', (-600, -400))
    if n:
        links.new(n.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 0.1

    print(f"  マテリアル: {mat.name} (diffuse={diffuse_file})")

def convert(fbx_name, glb_name):
    print(f"\n=== 変換開始: {fbx_name} → {glb_name} ===")
    clear_scene()

    fbx_path = os.path.join(MODEL_DIR, fbx_name)
    glb_path = os.path.join(MODEL_DIR, glb_name)

    if not os.path.exists(fbx_path):
        print(f"[ERROR] FBX未検出: {fbx_path}")
        return False

    # FBX インポート
    bpy.ops.import_scene.fbx(filepath=fbx_path)
    print("  FBXインポート完了")

    # マテリアルにテクスチャを適用（画像を共有キャッシュで管理）
    img_cache = {}
    done = set()
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        for slot in obj.material_slots:
            mat = slot.material
            if mat and mat.name not in done:
                setup_material(mat, img_cache)
                done.add(mat.name)

    # GLB エクスポート (WebP埋め込み)
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format='GLB',
        export_image_format='WEBP',       # WebP圧縮で埋め込み
        export_image_quality=85,          # WebP品質 (0-100)
        export_materials='EXPORT',
        export_apply=False,
    )

    size_kb = os.path.getsize(glb_path) // 1024
    print(f"  完了: {glb_path} ({size_kb} KB)")
    return True

# ── メイン ────────────────────────────────────────────────────
success = 0
for fbx_name, glb_name in TARGETS:
    if convert(fbx_name, glb_name):
        success += 1

print(f"\n完了: {success}/{len(TARGETS)} ファイル変換")
