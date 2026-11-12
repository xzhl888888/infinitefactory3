import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createLibrary } from '../platforms/windows/library.mjs';
import { createService } from '../platforms/windows/service.mjs';
import { createNewSave, commitSynthesis } from '../src/core/model.js';

const ROOT = process.env.WXGC3_TEST_DIR || path.join(tmpdir(), 'infinitefactory3-tests');
fs.mkdirSync(ROOT, { recursive: true });
const TIME = '2026-10-27T07:00:00.000Z';
const CONFIG = { baseUrl: 'https://fixture.invalid', model: 'fixture', key: 'synthetic-library-credential' };
const IDS = ['base:fire', 'base:water'];
const CARD = { name: '云', emoji: '☁️', category: '自然', description: '聚在天空的水汽。' };
const fresh = (id = 'save:fixture') => createNewSave({ id, now: TIME });
const response = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(CARD) } }] }));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness(t, overrides = {}) {
  const dataDir = overrides.dataDir || fs.mkdtempSync(path.join(ROOT, 'case-'));
  let fetcher = overrides.fetchImpl || (() => response()), requests = 0;
  const settings = { dataDir,
    encrypt: text => Buffer.from(text).map(byte => byte ^ 91),
    decrypt: bytes => Buffer.from(bytes).map(byte => byte ^ 91).toString('utf8'),
    fetchImpl: async (...args) => { requests++; return fetcher(...args); }, ...overrides };
  const library = createLibrary(settings); t.after(() => library.close());
  return { library, dataDir, settings, get requests() { return requests; }, setFetch(next) { fetcher = next; } };
}
function initialize(h) { const status = h.library.status(); assert.equal(status.activeSlotId, 'legacy'); return h.library.initialize(fresh(), 'legacy'); }

test('档案层允许并行生成与分项提交，仍在途的请求可单独取消且不能切档', async t => {
  const h = harness(t); initialize(h);
  const created = h.library.createSlot({ slotId: 'legacy', name: '另一个世界', save: fresh('save:parallel-other') });
  const other = created.library.activeSlotId;
  h.library.switchSlot({ slotId: other, id: 'legacy' });
  await h.library.configure(CONFIG, 'legacy');
  const network = [], entered = deferred();
  h.setFetch(() => { const gate = deferred(); network.push(gate); if (network.length === 2) entered.resolve(); return gate.promise; });
  const first = h.library.generate({ slotId: 'legacy', ingredientIds: IDS, operationId: 'library:first' });
  const second = h.library.generate({ slotId: 'legacy', ingredientIds: ['base:metal', 'base:wood'], operationId: 'library:second' });
  const cancelled = assert.rejects(second, { code: 'CANCELLED' });
  await entered.promise;
  network[0].resolve(response()); await first;
  const original = h.library.loadPending('legacy', 'library:first');
  const updated = h.library.updatePending({ slotId: 'legacy', operationId: original.operationId, result: original.result, source: original.source, modStates: [] });
  assert.equal(updated.modProcessed, true, '另一项仍在请求时也能完成本项处理');
  const current = h.library.load('legacy');
  h.library.save(commitSynthesis(current, updated).save, current.revision, 'legacy');
  assert.deepEqual(h.library.listPending('legacy'), []);
  assert.throws(() => h.library.switchSlot({ slotId: 'legacy', id: other }), { code: 'BUSY' });
  h.library.cancel('legacy', 'library:second');
  network[1].resolve(response()); await cancelled;
  assert.deepEqual(h.library.listPending('legacy'), []);
  assert.equal(h.library.load('legacy').stats.synthesisCount, 1);
  assert.equal(h.library.switchSlot({ slotId: 'legacy', id: other }).save.stats.synthesisCount, 0);
  assert.equal(h.requests, 3, '一项检测和两项合成');
});

test('legacy 原路径接管，登记和读取不重写旧快照，API密文原样共享', async t => {
  const dataDir = fs.mkdtempSync(path.join(ROOT, 'legacy-'));
  const options = { dataDir, encrypt: text => Buffer.from(text).map(byte => byte ^ 91), decrypt: bytes => Buffer.from(bytes).map(byte => byte ^ 91).toString('utf8'), fetchImpl: async () => response() };
  const old = createService(options); old.initialize(fresh()); await old.configure(CONFIG); old.close();
  const db = new DatabaseSync(path.join(dataDir, 'world.sqlite3'));
  const before = db.prepare('SELECT document FROM current_save').get().document; db.close();
  const encrypted = fs.readFileSync(path.join(dataDir, 'ai-config.encrypted'));
  const h = harness(t, options);
  assert.equal(h.library.status().slots[0].saveId, 'save:fixture'); assert.equal(h.library.load('legacy').cards.length, 5);
  assert.equal((await h.library.configStatus('legacy')).configured, true);
  const after = new DatabaseSync(path.join(dataDir, 'world.sqlite3'));
  assert.equal(after.prepare('SELECT document FROM current_save').get().document, before); after.close();
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'ai-config.encrypted')), encrypted);
});

test('真实v1文档读成v2但原文件字节不变，首次正常保存才写入升级字段', t => {
  const h = harness(t); const old = initialize(h); h.library.close();
  const combined = commitSynthesis(old, { operationId: 'old:operation', ingredientIds: IDS, result: CARD, now: TIME }).save;
  const v1 = { ...combined, formatVersion: 1 }; delete v1.name; delete v1.mods; v1.operations = v1.operations.map(({ source, ...operation }) => operation);
  const raw = JSON.stringify(v1), db = new DatabaseSync(path.join(h.dataDir, 'world.sqlite3'));
  db.prepare('UPDATE current_save SET revision=?,document=?').run(v1.revision, raw); db.close();
  const reopened = createLibrary(h.settings); t.after(() => reopened.close());
  const projected = reopened.load('legacy'); assert.equal(projected.formatVersion, 2); assert.equal(projected.operations[0].source.kind, 'unknown');
  const check = new DatabaseSync(path.join(h.dataDir, 'world.sqlite3'));
  assert.equal(check.prepare('SELECT document FROM current_save').get().document, raw);
  reopened.save({ ...projected, revision: projected.revision + 1 }, projected.revision, 'legacy');
  assert.equal(JSON.parse(check.prepare('SELECT document FROM current_save').get().document).formatVersion, 2); check.close();
  assert.equal(fs.readFileSync(path.join(h.dataDir, 'migration-v1.wxgc3'), 'utf8'), raw);
  for (let i = 0; i < 6; i++) { const current = reopened.load('legacy'); reopened.save({ ...current, revision: current.revision + 1 }, current.revision, 'legacy'); }
  assert.equal(fs.readFileSync(path.join(h.dataDir, 'migration-v1.wxgc3'), 'utf8'), raw, '普通副本轮换不能覆盖迁移原文');
});

test('v1原文备份写入失败拒绝升级，旧数据库文档完整保留', t => {
  const h = harness(t); const original = initialize(h); h.library.close();
  const v1 = { ...original, formatVersion: 1 }; delete v1.name; delete v1.mods;
  const raw = JSON.stringify(v1), db = new DatabaseSync(path.join(h.dataDir, 'world.sqlite3'));
  db.prepare('UPDATE current_save SET document=?').run(raw);
  const reopened = createLibrary(h.settings); t.after(() => reopened.close()); const projected = reopened.load('legacy');
  const builtin = createRequire(import.meta.url)('node:fs'), open = builtin.openSync;
  builtin.openSync = (file, flags, ...args) => { if (String(file).endsWith('migration-v1.wxgc3') && flags === 'wx') throw Object.assign(Error('synthetic migration fault'), { code: 'EACCES' }); return open(file, flags, ...args); };
  syncBuiltinESMExports();
  try { assert.throws(() => reopened.save({ ...projected, revision: 1 }, 0, 'legacy'), { code: 'MIGRATION_BACKUP_FAILED' }); }
  finally { builtin.openSync = open; syncBuiltinESMExports(); }
  assert.equal(db.prepare('SELECT document FROM current_save').get().document, raw); db.close();
});

test('新建与切换使用独立数据库，迟到的所有写入都因槽号不符拒绝', async t => {
  const h = harness(t), original = initialize(h);
  const created = h.library.createSlot({ slotId: 'legacy', name: '第二个世界', save: fresh('save:two') });
  const id = created.library.activeSlotId;
  assert.notEqual(id, 'legacy'); assert.equal(created.save.id, 'save:two');
  assert.throws(() => h.library.save({ ...original, revision: 1 }, 0, 'legacy'), { code: 'SLOT_CHANGED' });
  assert.throws(() => h.library.importSave(fresh(), 'legacy'), { code: 'SLOT_CHANGED' });
  assert.throws(() => h.library.restoreBackup('auto-0', 'legacy'), { code: 'SLOT_CHANGED' });
  assert.throws(() => h.library.stageModResult({ slotId: 'legacy' }), { code: 'SLOT_CHANGED' });
  assert.throws(() => h.library.updatePending({ slotId: 'legacy' }), { code: 'SLOT_CHANGED' });
  assert.throws(() => h.library.generate({ slotId: 'legacy', ingredientIds: IDS, operationId: 'op:late' }), { code: 'SLOT_CHANGED' });
  await assert.rejects(h.library.configure(CONFIG, 'legacy'), { code: 'SLOT_CHANGED' });
  assert.throws(() => h.library.switchSlot({ slotId: 'legacy', id: 'legacy' }), { code: 'SLOT_CHANGED' });
  const next = { ...created.save, revision: 1, preferences: { ...created.save.preferences, skinId: 'sea' } };
  h.library.save(next, 0, id);
  assert.equal(h.library.switchSlot({ slotId: id, id: 'legacy' }).save.preferences.skinId, original.preferences.skinId);
  assert.equal(h.library.switchSlot({ slotId: 'legacy', id }).save.preferences.skinId, 'sea');
  assert.equal(fs.existsSync(path.join(h.dataDir, 'slots', id, 'world.sqlite3')), true);
});

test('导入永远新建槽并赋新save.id，修改名称仅更新注册表和导出投影', t => {
  const h = harness(t), original = initialize(h);
  const imported = h.library.importAsSlot({ slotId: 'legacy', name: '导入世界', save: original });
  const id = imported.library.activeSlotId;
  assert.notEqual(imported.save.id, original.id); assert.equal(imported.save.stats.synthesisCount, 0);
  const db = new DatabaseSync(path.join(h.dataDir, 'slots', id, 'world.sqlite3'));
  const before = db.prepare('SELECT document FROM current_save').get().document;
  const renamed = h.library.renameSlot({ slotId: id, id, name: '改后的世界' });
  assert.equal(renamed.library.slots.find(slot => slot.id === id).name, '改后的世界');
  assert.equal(db.prepare('SELECT document FROM current_save').get().document, before); db.close();
  if (Object.hasOwn(renamed.save, 'name')) assert.equal(JSON.parse(h.library.exportJSON(id)).name, '改后的世界');
  assert.equal(h.library.switchSlot({ slotId: id, id: 'legacy' }).save.id, original.id);
});

test('提示词跟随独立档案及导出导入，新档保持默认且导入不改原档', t => {
  const h = harness(t), initial = initialize(h), custom = '  用童话风格创作。\n保留此行换行。\t';
  h.library.save({ ...initial, revision: 1, preferences: { ...initial.preferences, synthesisPrompt: custom } }, 0, 'legacy');
  const exported = JSON.parse(h.library.exportJSON('legacy'));
  assert.equal(exported.preferences.synthesisPrompt, custom);
  const created = h.library.createSlot({ slotId: 'legacy', name: '默认世界', save: fresh('save:default-prompt') }), newId = created.library.activeSlotId;
  assert.equal(created.save.preferences.synthesisPrompt, '');
  const imported = h.library.importAsSlot({ slotId: newId, name: '带提示的世界', save: exported }), importedId = imported.library.activeSlotId;
  assert.equal(imported.save.preferences.synthesisPrompt, custom);
  h.library.save({ ...imported.save, revision: imported.save.revision + 1, preferences: { ...imported.save.preferences, synthesisPrompt: '' } }, imported.save.revision, importedId);
  assert.equal(h.library.switchSlot({ slotId: importedId, id: 'legacy' }).save.preferences.synthesisPrompt, custom);
  assert.equal(h.library.switchSlot({ slotId: 'legacy', id: newId }).save.preferences.synthesisPrompt, '');
  assert.equal(h.library.switchSlot({ slotId: newId, id: importedId }).save.preferences.synthesisPrompt, '');
});

test('设备共用Key，但每槽的pending、统计与备份独立', async t => {
  const h = harness(t); initialize(h); await h.library.configure(CONFIG, 'legacy');
  const created = h.library.createSlot({ slotId: 'legacy', name: '共享配置独立进度', save: fresh('save:two') }), id = created.library.activeSlotId;
  assert.equal((await h.library.configStatus(id)).configured, true);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'slots', id, 'ai-config.encrypted')), false);
  await h.library.generate({ slotId: id, ingredientIds: IDS, operationId: 'op:slot' });
  assert.throws(() => h.library.switchSlot({ slotId: id, id: 'legacy' }), { code: 'PENDING_SAVE_REQUIRED' });
  assert.throws(() => h.library.createSlot({ slotId: id, name: '不能丢待存答案', save: fresh('save:three') }), { code: 'PENDING_SAVE_REQUIRED' });
  const pending = h.library.loadPending(id), next = commitSynthesis(h.library.load(id), pending).save;
  h.library.save(next, 0, id);
  assert.equal(h.library.loadPending(id), null);
  assert.equal(h.library.switchSlot({ slotId: id, id: 'legacy' }).save.stats.synthesisCount, 0);
  assert.equal(h.library.loadPending('legacy'), null);
  assert.equal(h.requests, 2, '跨槽只共用配置，不重新检测Key');
  assert.ok(h.library.listBackups('legacy').every(item => item.saveId === 'save:fixture'));
});

test('生成或检测正在进行时不能切槽，取消迟到响应不产生跨槽答案', async t => {
  const h = harness(t); initialize(h); await h.library.configure(CONFIG, 'legacy');
  const other = h.library.createSlot({ slotId: 'legacy', name: '备用', save: fresh('save:two') }).library.activeSlotId;
  h.library.switchSlot({ slotId: other, id: 'legacy' });
  const delayed = deferred(), entered = deferred(); h.setFetch(() => { entered.resolve(); return delayed.promise; });
  const generating = h.library.generate({ slotId: 'legacy', ingredientIds: IDS, operationId: 'op:slow' });
  const rejected = assert.rejects(generating, { code: 'CANCELLED' }); await entered.promise;
  assert.throws(() => h.library.switchSlot({ slotId: 'legacy', id: other }), { code: 'BUSY' });
  h.library.cancel('legacy'); delayed.resolve(response()); await rejected;
  assert.equal(h.library.loadPending('legacy'), null);
  assert.equal(h.library.switchSlot({ slotId: 'legacy', id: other }).save.stats.synthesisCount, 0);
});

test('坏注册表与注册表丢失停止恢复，不重建或修改现有数据库', t => {
  const h = harness(t); initialize(h); h.library.close();
  const registry = path.join(h.dataDir, 'library.json'); fs.writeFileSync(registry, '{corrupt');
  const bad = createLibrary(h.settings); t.after(() => bad.close());
  assert.throws(() => bad.status(), { code: 'LIBRARY_CORRUPT' });
  assert.throws(() => bad.initialize(fresh(), 'legacy'), { code: 'LIBRARY_CORRUPT' });
  assert.equal(fs.readFileSync(registry, 'utf8'), '{corrupt');
  fs.renameSync(registry, `${registry}.evidence`);
  const missing = createLibrary(h.settings); t.after(() => missing.close());
  assert.throws(() => missing.status(), { code: 'LIBRARY_CORRUPT' });
  assert.equal(fs.existsSync(registry), false);
});

test('单槽损坏或主库缺失可切走，保留文件和其他槽位', t => {
  const h = harness(t); initialize(h);
  const id = h.library.createSlot({ slotId: 'legacy', name: '坏槽', save: fresh('save:two') }).library.activeSlotId;
  h.library.close(); const file = path.join(h.dataDir, 'slots', id, 'world.sqlite3');
  const damaged = Buffer.from('synthetic damaged slot'); fs.writeFileSync(file, damaged);
  const reopened = createLibrary(h.settings); t.after(() => reopened.close());
  assert.equal(reopened.status().slots.find(slot => slot.id === id).available, false);
  assert.equal(reopened.switchSlot({ slotId: id, id: 'legacy' }).save.id, 'save:fixture');
  assert.deepEqual(fs.readFileSync(file), damaged);
  assert.equal(reopened.switchSlot({ slotId: 'legacy', id }).save, null);
});

test('登记新槽失败保留当前槽与注册表，孤立新目录不覆盖已有数据', t => {
  const h = harness(t); initialize(h);
  const registry = path.join(h.dataDir, 'library.json'), before = fs.readFileSync(registry);
  const builtin = createRequire(import.meta.url)('node:fs'), rename = builtin.renameSync;
  builtin.renameSync = (from, to) => { if (to === registry) { const error = Error('synthetic registry fault'); error.code = 'EACCES'; throw error; } return rename(from, to); };
  syncBuiltinESMExports();
  try { assert.throws(() => h.library.createSlot({ slotId: 'legacy', name: '未登记', save: fresh('save:orphan') }), { code: 'LIBRARY_WRITE_FAILED' }); }
  finally { builtin.renameSync = rename; syncBuiltinESMExports(); }
  assert.deepEqual(fs.readFileSync(registry), before);
  assert.equal(h.library.status().activeSlotId, 'legacy'); assert.equal(h.library.status().slots.length, 1);
  assert.equal(h.library.load('legacy').id, 'save:fixture');
  assert.equal(fs.readdirSync(path.join(h.dataDir, 'slots')).length, 1);
});

test('注册表不允许任意路径，名称与未知槽均有边界', t => {
  const h = harness(t); initialize(h);
  assert.throws(() => h.library.createSlot({ slotId: 'legacy', name: 'x'.repeat(41), save: fresh() }), { code: 'INVALID_SLOT_NAME' });
  assert.throws(() => h.library.switchSlot({ slotId: 'legacy', id: '../../elsewhere' }), { code: 'SLOT_NOT_FOUND' });
  h.library.close();
  const file = path.join(h.dataDir, 'library.json'), registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  registry.slots[0].id = '../elsewhere'; registry.activeSlotId = '../elsewhere'; fs.writeFileSync(file, JSON.stringify(registry));
  const tampered = createLibrary(h.settings); t.after(() => tampered.close());
  assert.throws(() => tampered.status(), { code: 'LIBRARY_CORRUPT' });
});
