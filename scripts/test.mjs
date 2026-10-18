import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root } from './toolchain.mjs';
const tests = readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.test.ts')).map(file => path.join(root, 'tests', file));
if (tests.length === 0) throw new Error('No test files found');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('tests passed');
