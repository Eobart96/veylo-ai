import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, toolEnvironment } from './toolchain.mjs';
const result = spawnSync('cargo', ['test', '--locked', '--lib', 'translation::tests::live_english_pairs', '--', '--ignored', '--nocapture'], {
  cwd: path.join(root, 'src-tauri'), env: toolEnvironment(), stdio: 'inherit',
});
process.exit(result.status ?? 1);
