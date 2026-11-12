import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// Electron 45 的 npm 包不再自动下载运行环境；首建时按已锁版本补齐。
if (!existsSync(path.join(root, 'node_modules/electron/path.txt'))) run(['node_modules/electron/install.js']);
run(['scripts/build-web.mjs']);
run(['scripts/check-source.mjs']);
run(['node_modules/electron-builder/out/cli/cli.js', '--win', '--x64', '--config', 'electron-builder.json', '--publish', 'never']);
