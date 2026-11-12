import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
// 只复制运行游戏所需的前端文件，测试用平台适配器不进入安装包。
const out = path.join(root, '.build', 'web');
await mkdir(out, { recursive: true });
const files = ['index.html'];
async function collect(folder) {
  for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error('构建目录不能包含符号链接');
    const name = path.posix.join(folder, entry.name);
    if (entry.isDirectory()) await collect(name);
    else if (name !== 'src/platform/development.js' && /\.(js|css|svg|png|webp|ogg|mp3|woff2)$/.test(name)) files.push(name);
  }
}
await collect('src');
for (const file of files) {
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await writeFile(path.join(out, file), await readFile(path.join(root, file)));
}
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await writeFile(path.join(out, 'build-manifest.json'), JSON.stringify({ version: pkg.version, files }, null, 2));
console.log(`已生成前端：${files.length} 个文件。`);
