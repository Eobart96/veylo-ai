import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, toolEnvironment } from './toolchain.mjs';
for (const args of [['check', '--locked'], ['test', '--locked', '--lib']]) {
  const result = spawnSync('cargo', args, { cwd: path.join(root, 'src-tauri'), env: toolEnvironment(), stdio: 'inherit' });
  if (result.error) console.error('Rust не установлен или не доступен: ' + result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('RUST_CHECK_OK');
