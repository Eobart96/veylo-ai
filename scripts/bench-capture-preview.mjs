import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import { root, toolEnvironment } from './toolchain.mjs';
const result = spawnSync('cargo', ['test', '--locked', '--lib', 'screen_image::tests::synthetic_preview_benchmark', '--', '--ignored', '--nocapture'], {
  cwd: path.join(root, 'src-tauri'), env: toolEnvironment(), encoding:'utf8',maxBuffer:1024*1024,
});
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
if(result.error) console.error(result.error.message);
if(result.status===0 && process.argv.includes('--compare-prep')) {
  const match=result.stdout.match(/PREVIEW_BENCH old_mean_ms=(\d+) fast_mean_ms=(\d+)/);
  assert(match,'Benchmark must report measured means');
  const before=JSON.parse(readFileSync(path.join(root,'.cache/preview-before.json'),'utf8'));
  const after={oldMeanMs:Number(match[1]),fastMeanMs:Number(match[2])};
  assert(after.fastMeanMs<before.fastMeanMs*.8,'Preparation must improve by more than measurement noise');
  writeFileSync(path.join(root,'.cache/preview-after.json'),JSON.stringify(after,null,2));
  console.log('PREP_PERFORMANCE_OK',JSON.stringify({before,after}));
}
process.exit(result.status ?? 1);
