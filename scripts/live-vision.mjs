// Explicit live test: sends the synthetic image fixture, never captures desktop.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, toolEnvironment } from './toolchain.mjs';
const filter = process.argv.includes('--layout-only') ? 'translation::tests::live_image_layout' : 'translation::tests::live_image_';
const result = spawnSync('cargo', ['test', '--locked', '--lib', filter, '--', '--ignored', '--nocapture'], { cwd: path.join(root, 'src-tauri'), env: toolEnvironment(), stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('LIVE_VISION_OK');
