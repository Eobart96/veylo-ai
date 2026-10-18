import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function toolEnvironment() {
  const env = { ...process.env };
  // Windows treats PATH/Path as one key; child_process must not receive both.
  const inheritedPath = process.env.PATH ?? process.env.Path ?? '';
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.PATH = inheritedPath;
  const devCmd = path.join(root, '.tools', 'buildtools', 'Common7', 'Tools', 'VsDevCmd.bat');
  if (process.platform === 'win32' && existsSync(devCmd)) {
    // Capture the official build environment without printing environment values.
    const initialized = spawnSync(`call "${devCmd}" -no_logo -arch=x64 -host_arch=x64 >nul && set`, { shell: process.env.ComSpec ?? 'cmd.exe', env, encoding: 'utf8', timeout: 30_000 });
    if (initialized.status !== 0) throw new Error('Не удалось подготовить окружение Microsoft Build Tools.');
    for (const line of initialized.stdout.split(/\r?\n/)) {
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator);
      if (key.toLowerCase() === 'path') env.PATH = line.slice(separator + 1);
      else env[key] = line.slice(separator + 1);
    }
  }
  const local = path.join(root, '.tools', 'cargo', 'bin');
  if (existsSync(path.join(local, 'cargo.exe'))) {
    env.CARGO_HOME = path.join(root, '.tools', 'cargo');
    env.RUSTUP_HOME = path.join(root, '.tools', 'rustup');
    env.PATH = local + path.delimiter + env.PATH;
  }
  return env;
}
