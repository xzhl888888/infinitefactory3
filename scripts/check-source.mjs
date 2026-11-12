import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = [];
async function collect(folder) {
  for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error(`源码不接受符号链接：${folder}/${entry.name}`);
    const file = path.posix.join(folder, entry.name);
    if (entry.isDirectory()) await collect(file);
    else files.push(file);
  }
}
await collect('src'); await collect('scripts'); await collect('tests'); await collect('platforms/windows');
for (const file of files.filter(f => /\.(c?m?js)$/.test(f))) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw Error(`语法检查失败：${file}\n${result.stderr}`);
  const source = await readFile(path.join(root, file), 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"\n]+)\1/g)) {
    // ES 模块测试可用 query 隔离缓存；文件存在性只检查 URL 的实际路径。
    const resolved = fileURLToPath(new URL(match[2], pathToFileURL(path.join(root, file))));
    if (!resolved.startsWith(root + path.sep) || !(await stat(resolved)).isFile()) throw Error(`引用不可用：${file}`);
  }
  if (file.startsWith('src/') && /ADMIN_KEY|PRIVATE KEY|sk-proj-[A-Za-z0-9_-]{12,}/i.test(source)) {
    // 只输出文件位置，不把潜在敏感内容复制进日志。
    throw Error(`源码中发现疑似凭据，请检查：${file}`);
  }
}
const manifest = JSON.parse(await readFile(path.join(root, '.build/web/build-manifest.json'), 'utf8'));
if (!manifest.files.includes('src/main.js') || manifest.files.includes('src/platform/development.js')) throw Error('前端打包清单不符合正式入口要求');
for (const file of manifest.files) {
  const src = await readFile(path.join(root, file));
  const built = await readFile(path.join(root, '.build/web', file));
  if (!src.equals(built)) throw Error(`打包内容与源码不一致：${file}`);
}
// 打包程序不自动删除旧文件；发现残留时阻止发行，避免旧夹具混进原生包。
async function inspectBuild(folder = '') {
  for (const entry of await readdir(path.join(root, '.build/web', folder), { withFileTypes: true })) {
    const file = path.posix.join(folder, entry.name);
    if (entry.isSymbolicLink()) throw Error('构建产物不能包含符号链接');
    if (entry.isDirectory()) await inspectBuild(file);
    else if (file !== 'build-manifest.json' && !manifest.files.includes(file)) throw Error(`构建目录含清单外文件：${file}`);
  }
}
await inspectBuild();
const config = JSON.parse(await readFile(path.join(root, 'electron-builder.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version || config.productName !== '无限工厂3') throw Error('应用名称或版本不一致');
console.log(`源码检查通过：${files.length} 个源文件；${manifest.files.length} 个前端文件与打包清单一致。`);
