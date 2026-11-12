import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, session } from 'electron';
import { readFile, writeFile, open, mkdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLibrary } from './library.mjs';
import { importSave, SAVE_LIMITS } from '../../src/core/model.js';
import { validateModPackage, MOD_LIMITS } from '../../src/core/mods.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const web = path.join(root, '.build/web');
const origin = 'wxgc://game';
const page = `${origin}/index.html`;
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self'; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
let window, service, activeRequest = 0, configuring = false, fileDialog = false, quitting = false;

protocol.registerSchemesAsPrivileged([{ scheme: 'wxgc', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName('无限工厂3');
app.setPath('userData', path.join(app.getPath('appData'), 'InfiniteFactory3'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(start).catch(() => {
    dialog.showErrorBox('无限工厂3', '游戏未能启动。请保留本地存档，并重新安装应用。');
    app.exit(1);
  });
}

function safeError(error) {
  // 原生异常可能含服务响应、路径或凭据。窗口只接收固定格式错误码。
  return /^[A-Z][A-Z0-9_]{1,79}$/u.test(error?.code ?? '') ? error.code : 'STORAGE_ERROR';
}
async function encrypt(value) {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw Error('KEY_UNAVAILABLE');
  return safeStorage.encryptStringAsync(value);
}
async function decrypt(value) {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw Error('KEY_UNAVAILABLE');
  const result = await safeStorage.decryptStringAsync(Buffer.from(value));
  if (typeof result.result !== 'string') throw Error('KEY_UNAVAILABLE');
  return result.result;
}
async function withFileDialog(action) {
  if (fileDialog || activeRequest) throw Object.assign(Error(), { code: 'BUSY' });
  fileDialog = true;
  try { return await action(); } finally { fileDialog = false; }
}
async function readSaveFile(file, limit = SAVE_LIMITS.bytes, validate = importSave) {
  const handle = await open(file, 'r');
  try {
    if ((await handle.stat()).size > limit) throw Object.assign(Error(), { code: 'SAVE_TOO_LARGE' });
    // 选择后仍受字节上限保护，防止文件在读取期间增长。
    const bytes = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < bytes.length) {
      const result = await handle.read(bytes, count, bytes.length - count, count);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    if (count > limit) throw Object.assign(Error(), { code: 'SAVE_TOO_LARGE' });
    const text = bytes.subarray(0, count).toString('utf8');
    validate(text);
    return text;
  } finally { await handle.close(); }
}
async function exportFile(slotId) {
  return withFileDialog(async () => {
    const text = service.exportJSON(slotId);
    const name = (JSON.parse(text).name || '我的世界').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_');
    const result = await dialog.showSaveDialog(window, {
      title: '导出存档', defaultPath: `无限工厂3-${name}-${new Date().toISOString().slice(0, 10)}.wxgc3-save`,
      filters: [{ name: '无限工厂3存档', extensions: ['wxgc3-save'] }],
    });
    if (result.canceled || !result.filePath) return false;
    // 完整落盘后再替换目标；写入失败不会先清空玩家已有的备份。
    const temporary = `${result.filePath}.${randomUUID()}.pending`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(text, 'utf8'); await handle.sync(); await handle.close(); handle = null;
      await rename(temporary, result.filePath);
      return true;
    } catch { throw Object.assign(Error(), { code: 'FILE_WRITE_FAILED' }); }
    finally { await handle?.close(); }
  });
}

async function command(name, args) {
  if (name === 'exit_game') { window.close(); return null; }
  if (name === 'usage_notice') {
    if (typeof args.version !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(args.version) || typeof args.accept !== 'boolean') throw Error('INVALID_NOTICE');
    const file = path.join(app.getPath('userData'), 'usage-notice.txt');
    if (args.accept) {
      await writeFile(file, args.version, { encoding: 'utf8', flush: true });
      return true;
    }
    try { return await readFile(file, 'utf8') === args.version; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  // 先完成本机协议选择，再由正常的首次游戏命令打开档案库。
  service ??= createLibrary({ dataDir: path.join(app.getPath('userData'), 'data'), encrypt, decrypt });
  if (name !== 'library_status') service.assertSlot(args.slotId);
  if (fileDialog && ['initialize_save', 'save_snapshot', 'configure_ai', 'generate_card', 'import_save', 'restore_backup', 'create_slot', 'switch_slot', 'rename_slot', 'import_as_slot', 'stage_mod_result', 'update_pending'].includes(name)) throw Object.assign(Error(), { code: 'BUSY' });
  switch (name) {
    case 'library_status': return service.status();
    case 'create_slot': return service.createSlot(args);
    case 'switch_slot': return service.switchSlot(args);
    case 'rename_slot': return service.renameSlot(args);
    case 'import_as_slot': return service.importAsSlot(args);
    case 'load_save': return service.load(args.slotId);
    case 'initialize_save': return service.initialize(args.save, args.slotId);
    case 'save_snapshot': return service.save(args.save, args.expectedRevision, args.slotId);
    case 'config_status': return service.configStatus(args.slotId);
    case 'configure_ai': {
      if (activeRequest || fileDialog) throw Object.assign(Error(), { code: 'BUSY' });
      activeRequest++; configuring = true;
      try { return await service.configure(args.config, args.slotId); }
      finally { activeRequest--; configuring = false; }
    }
    case 'generate_card': {
      if (configuring || fileDialog) throw Object.assign(Error(), { code: 'BUSY' });
      activeRequest++;
      try { return await service.generate(args); }
      finally { activeRequest--; }
    }
    case 'cancel_request': service.cancel(args.slotId, args.operationId); return null;
    case 'load_pending': return service.loadPending(args.slotId, args.operationId);
    case 'list_pending': return service.listPending(args.slotId);
    case 'stage_mod_result': return service.stageModResult(args);
    case 'update_pending': return service.updatePending(args);
    case 'recovery_status': return service.recoveryStatus(args.slotId);
    case 'list_backups': return service.listBackups(args.slotId);
    case 'restore_backup': return service.restoreBackup(args.id, args.slotId);
    case 'export_save_file': return exportFile(args.slotId);
    case 'choose_import_file': return withFileDialog(async () => {
      const result = await dialog.showOpenDialog(window, { title: '导入存档', properties: ['openFile'], filters: [{ name: '无限工厂3存档', extensions: ['wxgc3-save', 'json'] }] });
      if (result.canceled || !result.filePaths[0]) return null;
      try { return await readSaveFile(result.filePaths[0]); }
      catch (error) { if (/^[A-Z][A-Z0-9_]+$/u.test(error?.code ?? '') && !/^E[A-Z]+$/u.test(error.code)) throw error; throw Object.assign(Error(), { code: 'FILE_READ_FAILED' }); }
    });
    case 'choose_mod_file': return withFileDialog(async () => {
      const result = await dialog.showOpenDialog(window, { title: '安装 Mod', properties: ['openFile'], filters: [{ name: '无限工厂3 Mod', extensions: ['wxgc3-mod', 'json'] }] });
      if (result.canceled || !result.filePaths[0]) return null;
      try { return await readSaveFile(result.filePaths[0], MOD_LIMITS.bytes, text => { let value; try { value = JSON.parse(text); } catch { throw Object.assign(Error(), { code: 'INVALID_MOD' }); } validateModPackage(value); }); }
      catch (error) { if (/^[A-Z][A-Z0-9_]+$/u.test(error?.code ?? '') && !/^E[A-Z]+$/u.test(error.code)) throw error; throw Object.assign(Error(), { code: 'FILE_READ_FAILED' }); }
    });
    case 'confirm_import': {
      const cards = args.cardCount;
      const recipes = args.recipeCount;
      const mods = args.modCount ?? 0, scripts = args.enabledScriptCount ?? 0;
      if (!Number.isSafeInteger(cards) || cards < 0 || cards > 25000 || !Number.isSafeInteger(recipes) || recipes < 0 || recipes > 100000 || !Number.isSafeInteger(mods) || mods < 0 || mods > 16 || !Number.isSafeInteger(scripts) || scripts < 0 || scripts > mods) throw Object.assign(Error(), { code: 'INVALID_SAVE' });
      const detail = `${cards} 张卡牌 · ${recipes} 条配方 · ${mods} 个 Mod${scripts ? `\n包含 ${scripts} 个已启用的玩法脚本，导入后会在这份存档中运行。` : ''}`;
      const result = await dialog.showMessageBox(window, { type: 'question', title: '导入存档', message: '将这份进度添加为新存档？', detail, buttons: ['取消', '添加存档'], defaultId: 0, cancelId: 0 });
      return result.response === 1;
    }
    case 'import_save': return service.importSave(args.save, args.slotId);
    default: throw Object.assign(Error(), { code: 'COMMAND_NOT_ALLOWED' });
  }
}

async function start() {
  const manifest = JSON.parse(await readFile(path.join(web, 'build-manifest.json'), 'utf8'));
  const allowed = new Set(manifest.files);
  protocol.handle('wxgc', async request => {
    const url = new URL(request.url);
    let file;
    try { file = decodeURIComponent(url.pathname).replace(/^\//u, ''); } catch { return new Response('', { status: 400 }); }
    if (request.method !== 'GET' || url.host !== 'game' || !allowed.has(file)) return new Response('', { status: 404 });
    try {
      return new Response(await readFile(path.join(web, file)), { headers: { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response('', { status: 404 }); }
  });
  await mkdir(app.getPath('userData'), { recursive: true });
  ipcMain.handle('wxgc:command', async (event, name, args = {}) => {
    try {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== page) throw Object.assign(Error(), { code: 'COMMAND_NOT_ALLOWED' });
      if (!args || typeof args !== 'object' || Array.isArray(args) || Buffer.byteLength(JSON.stringify(args)) > SAVE_LIMITS.bytes + 64 * 1024) throw Object.assign(Error(), { code: 'INVALID_SAVE' });
      return { ok: true, data: await command(name, args) };
    } catch (error) { return { ok: false, error: safeError(error) }; }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(`${origin}/`) && !details.url.startsWith('blob:wxgc://game/') && !details.url.startsWith('data:') }));
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1200, height: 760, minWidth: 640, minHeight: 360, title: '无限工厂3',
    backgroundColor: '#f3ecdf', icon: path.join(root, 'assets/app/icon.ico'), show: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, webSecurity: true, devTools: false, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (!quitting && activeRequest) {
      event.preventDefault();
      const choice = dialog.showMessageBoxSync(window, { type: 'question', title: '退出游戏', message: '正在等待 AI 回答，仍要退出吗？', detail: '退出会取消等待，服务商可能已计费。', buttons: ['继续等待', '退出'], defaultId: 0, cancelId: 0 });
      if (choice === 1) { quitting = true; service.cancel(service.status().activeSlotId); window.close(); }
    }
  });
  window.on('closed', () => { window = null; });
  await window.loadURL(page);
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => service?.close());
