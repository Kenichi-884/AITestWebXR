【UI素材フォルダ】
=================

icons/       - アイコン画像（クロスヘア、HP・弾薬アイコンなど）
backgrounds/ - 背景画像（メニュー画面背景など）

対応フォーマット: PNG（透過あり推奨） / JPG / WebP
推奨サイズ:
  icons/      : 64x64 〜 256x256 px (PNG透過推奨)
  backgrounds/: 1920x1080 px

使い方 (HTML / CSS から):
  <img src="/assets/ui/icons/crosshair.png" />
  background-image: url('/assets/ui/backgrounds/menu-bg.jpg');

使い方 (Three.js Texture として):
  const tex = new THREE.TextureLoader().load('/assets/ui/icons/icon.png');

配置例:
  public/assets/ui/icons/crosshair.png   - 照準カーソル
  public/assets/ui/icons/heart.png       - HPアイコン
  public/assets/ui/icons/bullet.png      - 弾薬アイコン
  public/assets/ui/backgrounds/menu.jpg  - メニュー背景
