import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { root, toolEnvironment } from './toolchain.mjs';
const env = toolEnvironment();
let missing = false;
for (const tool of ['node', 'rustc', 'cargo']) {
  const result = spawnSync(tool === 'node' ? process.execPath : tool, ['--version'], { env, encoding: 'utf8' });
  const found = !result.error && result.status === 0;
  console.log(`${found ? 'OK' : 'MISSING'} ${tool}: ${found ? result.stdout.trim() : 'не установлен или отсутствует в PATH'}`);
  if (!found) missing = true;
}
if (process.platform === 'win32') {
  const candidates = [path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'), path.join(root, '.tools', 'buildtools')];
  const vswhere = candidates[0];
  let compiler = false;
  const hasCompiler = (installation) => {
    const versions = path.join(installation, 'VC', 'Tools', 'MSVC');
    if (!existsSync(versions)) return false;
    return readdirSync(versions).some(version => ['cl.exe', 'link.exe'].every(file => existsSync(path.join(versions, version, 'bin', 'Hostx64', 'x64', file))));
  };
  if (existsSync(vswhere)) {
    const result = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' });
    compiler = result.status === 0 && result.stdout.trim().split(/\r?\n/).filter(Boolean).some(hasCompiler);
  }
  compiler ||= hasCompiler(candidates[1]);
  console.log(`${compiler ? 'OK' : 'MISSING'} Microsoft C++ Build Tools`);
  missing ||= !compiler;
}
console.log(missing ? 'Интерфейс можно проверить через npm run dev. Для программы Windows нужны отсутствующие инструменты.' : 'DEV_TOOLS_OK');
process.exit(missing ? 1 : 0);
