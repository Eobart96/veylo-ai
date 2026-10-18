import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, toolEnvironment } from './toolchain.mjs';
const cli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: root, env: toolEnvironment(), stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
