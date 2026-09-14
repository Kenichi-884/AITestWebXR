import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  plugins: [
    basicSsl(),
  ],
  // OneDrive等でクラウド同期されるフォルダ内にプロジェクトがある場合、
  // node_modules/.vite への書き込みが同期プロセスとロック競合し
  // esbuildの依存事前バンドルが "Access is denied" で失敗することがあるため、
  // キャッシュ先を同期対象外のOS一時ディレクトリに逃がす
  cacheDir: join(tmpdir(), 'aitestwebxr-vite-cache'),
  server: {
    https: true,
    host: true,
  },
  build: {
    target: 'esnext',
  },
});
