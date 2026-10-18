import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, toolEnvironment } from './toolchain.mjs';
const result = spawnSync('cargo', ['test', '--lib', 'translation::tests::live_translation_both_directions', '--', '--ignored', '--nocapture'], { cwd: path.join(root, 'src-tauri'), env: toolEnvironment(), stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('LIVE_TRANSLATION_OK');
