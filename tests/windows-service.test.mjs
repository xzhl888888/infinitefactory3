import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createService, normalizeConfig } from '../platforms/windows/service.mjs';
import { createNewSave, commitSynthesis, serializeSave, installMod, toggleMod, applyModAction } from '../src/core/model.js';
import { buildSystemPrompt } from '../src/ai/prompt.js';

const ROOT = process.env.WXGC3_TEST_DIR || path.join(tmpdir(), 'infinitefactory3-tests');
fs.mkdirSync(ROOT, { recursive: true });
const TIME = '2026-10-27T05:00:00.000Z';
const IDS = ['base:fire', 'base:water'];
const CARD = { name: '蒸汽', emoji: '♨️', category: '自然', description: '热水升起的轻雾。' };
const CONFIG = { baseUrl: 'https://fixture.invalid/v1', model: 'fixture', key: 'synthetic-test-credential-only' };
const fresh = (id = 'save:fixture') => createNewSave({ id, now: TIME });
const response = (card = CARD) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(card) } }] }), { status: 200 });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function cryptoFixture() {
  const key = randomBytes(32);
  return {
    encrypt(text) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]); },
    decrypt(bytes) { const input = Buffer.from(bytes), decipher = createDecipheriv('aes-256-gcm', key, input.subarray(0, 12)); decipher.setAuthTag(input.subarray(-16)); return Buffer.concat([decipher.update(input.subarray(12, -16)), decipher.final()]).toString('utf8'); },
  };
}
function harness(t, options = {}) {
  const dataDir = options.dataDir || fs.mkdtempSync(path.join(ROOT, 'case-'));
  const crypto = options.crypto || cryptoFixture(), calls = [];
  let fetcher = options.fetcher || (() => response());
  const settings = { dataDir, ...crypto, fetchImpl: async (url, init) => { calls.push({ url, init }); return fetcher(url, init); }, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) };
  const service = createService(settings);
  t.after(() => service.close());
  return { service, dataDir, calls, crypto, settings, setFetch(fn) { fetcher = fn; } };
}
function rawDatabase(dataDir) { return new DatabaseSync(path.join(dataDir, 'world.sqlite3')); }
function commitPending(service, now) { const pending = service.loadPending(); return commitSynthesis(service.load(), { ...pending, ...(now ? { now } : {}) }).save; }

test('Windows SQLite 新档重开、名称分类索引及 CAS 防止旧窗口覆盖', t => {
  const h = harness(t); assert.equal(h.service.load(), null);
  const original = h.service.initialize(fresh());
  assert.throws(() => h.service.initialize(fresh()), { code: 'ALREADY_INITIALIZED' });
  const next = { ...original, revision: 1, preferences: { ...original.preferences, skinId: 'sea' } };
  const second = createService(h.settings); t.after(() => second.close());
  h.service.save(next, 0);
  assert.equal(second.load().preferences.skinId, 'sea');
  assert.throws(() => second.save({ ...next, preferences: { ...next.preferences, skinId: 'hearth' } }, 0), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(second.save(next, 0), next, '丢失成功响应后确认相同快照不再次递增');
  const db = rawDatabase(h.dataDir);
  assert.equal(db.prepare('SELECT count(*) n FROM cards WHERE category=?').get('自然').n, 5);
  assert.equal(db.prepare('SELECT name FROM cards WHERE id=?').get('base:fire').name, '火'); db.close();
});

test('未来版本、预装配方和坏档不能替换当前档案，未知 Key 字段不进入导出', t => {
  const h = harness(t), original = h.service.initialize(fresh());
  assert.throws(() => h.service.importSave({ ...original, formatVersion: 99 }), { code: 'UNSUPPORTED_SAVE_VERSION' });
  assert.throws(() => h.service.importSave('{broken'), { code: 'INVALID_SAVE_JSON' });
  const input = { ...original, revision: 1, apiKey: CONFIG.key, preferences: { ...original.preferences, apiKey: CONFIG.key } };
  h.service.save(input, 0);
  assert.equal(h.service.exportJSON().includes(CONFIG.key), false);
  const separate = harness(t);
  const combined = commitSynthesis(original, { operationId: 'op:preload', ingredientIds: IDS, result: CARD, now: TIME }).save;
  assert.throws(() => separate.service.initialize({ ...combined, revision: 0 }), { code: 'INVALID_SAVE' });
  assert.equal(separate.service.load(), null);
});

test('配置检测只检测并加密配置，不产生配方、统计或待存记录', async t => {
  const h = harness(t), original = h.service.initialize(fresh());
  const status = await h.service.configure(CONFIG);
  assert.equal(status.configured, true); assert.equal(status.key, undefined);
  assert.deepEqual(h.service.load(), original); assert.equal(h.service.loadPending(), null);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].init.redirect, 'manual');
  assert.equal(h.calls[0].url, 'https://fixture.invalid/v1/chat/completions');
  assert.equal(fs.readFileSync(path.join(h.dataDir, 'ai-config.encrypted')).includes(Buffer.from(CONFIG.key)), false);
  assert.equal(h.service.exportJSON().includes(CONFIG.key), false);
  const second = createService({ ...h.settings, decrypt() { throw Error('synthetic decryption failure'); } }); t.after(() => second.close());
  assert.equal((await second.configStatus()).configured, false); assert.equal((await second.configStatus()).previouslyConfigured, true);
  assert.deepEqual(second.load(), original, '凭据失败仍能读取原档');
});

test('保存的提示词用于未知配方，检测仍用默认，改写提示不重发待存或已知配方', async t => {
  const h = harness(t), initial = h.service.initialize(fresh()), custom = '  用童话风格创作。\n简介是一句短诗。\t';
  h.service.save({ ...initial, revision: 1, preferences: { ...initial.preferences, synthesisPrompt: custom } }, 0);
  await h.service.configure(CONFIG);
  assert.equal(JSON.parse(h.calls[0].init.body).messages[0].content, buildSystemPrompt());
  assert.equal(h.service.load().cards.length, 5); assert.equal(h.service.load().stats.synthesisCount, 0); assert.equal(h.service.loadPending(), null);
  await h.service.generate({ ingredientIds: IDS, operationId: 'op:custom-prompt' });
  assert.equal(JSON.parse(h.calls[1].init.body).messages[0].content, buildSystemPrompt(custom));
  const current = h.service.load(), changed = '用轻松幽默的风格创作。';
  h.service.save({ ...current, revision: current.revision + 1, preferences: { ...current.preferences, synthesisPrompt: changed } }, current.revision);
  await h.service.generate({ ingredientIds: IDS, operationId: 'op:custom-prompt' });
  assert.equal(h.calls.length, 2, '提示词改变也必须沿用已付费取得的待存答案');
  const revision = h.service.load().revision; h.service.save(commitPending(h.service), revision);
  await h.service.generate({ ingredientIds: IDS, operationId: 'op:known-custom' });
  assert.equal(h.calls.length, 2, '已知配方答案保持不变');
  assert.equal(h.service.loadPending(), null);
  await h.service.generate({ ingredientIds: ['base:water', 'base:water'], operationId: 'op:next-unknown' });
  assert.equal(JSON.parse(h.calls[2].init.body).messages[0].content, buildSystemPrompt(changed));
  assert.equal(h.service.load().preferences.synthesisPrompt, changed);
});

test('异步密钥加解密可用，加密期间取消不替换旧配置', async t => {
  const crypto = cryptoFixture();
  const h = harness(t, { crypto: { encrypt: async text => crypto.encrypt(text), decrypt: async bytes => crypto.decrypt(bytes) } });
  await h.service.configure(CONFIG);
  assert.equal((await h.service.configStatus()).configured, true);
  const oldBytes = fs.readFileSync(path.join(h.dataDir, 'ai-config.encrypted'));
  h.service.close();
  const entered = deferred(), release = deferred();
  const delayed = createService({ ...h.settings, encrypt: async text => { entered.resolve(); await release.promise; return crypto.encrypt(text); } });
  t.after(() => delayed.close());
  const configuring = delayed.configure({ ...CONFIG, model: 'another-model' });
  const rejected = assert.rejects(configuring, { code: 'CANCELLED' });
  await entered.promise; delayed.cancel(); release.resolve(); await rejected;
  assert.deepEqual(fs.readFileSync(path.join(h.dataDir, 'ai-config.encrypted')), oldBytes);
  assert.equal((await delayed.configStatus()).model, CONFIG.model);
});

test('复用 Key 的异步解密期间取消，不发检测请求', async t => {
  const h = harness(t); await h.service.configure(CONFIG); h.service.close();
  const entered = deferred(), release = deferred();
  const delayed = createService({ ...h.settings, decrypt: async bytes => { entered.resolve(); await release.promise; return h.crypto.decrypt(bytes); } });
  t.after(() => delayed.close());
  const configuring = delayed.configure({ ...CONFIG, key: '' });
  const rejected = assert.rejects(configuring, { code: 'CANCELLED' });
  await entered.promise; delayed.cancel(); release.resolve(); await rejected;
  assert.equal(h.calls.length, 1, '只保留初次配置请求，取消后不新请求');
});

test('AI 答案先持久化，重开续存沿用操作，不再次请求并原子清理 pending', async t => {
  const h = harness(t); h.service.initialize(fresh()); await h.service.configure(CONFIG);
  assert.deepEqual(await h.service.generate({ ingredientIds: IDS, operationId: 'op:one' }), CARD);
  assert.equal(h.service.load().stats.synthesisCount, 0);
  h.service.close();
  const reopened = createService(h.settings); t.after(() => reopened.close());
  const pending = reopened.loadPending();
  assert.equal(pending.operationId, 'op:one'); assert.equal(pending.saveId, 'save:fixture');
  assert.deepEqual(await reopened.generate({ ingredientIds: [...IDS].reverse(), operationId: 'op:one' }), CARD);
  assert.equal(h.calls.length, 2, '只有一次配置检测和一次未知合成');
  assert.throws(() => reopened.importSave(fresh('save:other')), { code: 'PENDING_SAVE_REQUIRED' });
  const candidate = commitPending(reopened, new Date(Date.now() + 10).toISOString());
  reopened.save(candidate, 0);
  assert.equal(reopened.loadPending(), null); assert.equal(reopened.load().stats.synthesisCount, 1);
  assert.deepEqual(reopened.save(candidate, 0), candidate);
  await reopened.generate({ ingredientIds: IDS, operationId: 'op:cached' });
  assert.equal(h.calls.length, 2, '已知配方使用本地结果');
});

test('SQLite 索引写入故障同时回滚快照和 pending，重试不再次请求 AI', async t => {
  const h = harness(t); h.service.initialize(fresh()); await h.service.configure(CONFIG);
  await h.service.generate({ ingredientIds: IDS, operationId: 'op:write-fail' });
  const candidate = commitPending(h.service), db = rawDatabase(h.dataDir);
  db.exec("CREATE TRIGGER reject_new BEFORE INSERT ON cards WHEN NEW.id='card:op:write-fail' BEGIN SELECT RAISE(ABORT,'synthetic write fault'); END;");
  assert.throws(() => h.service.save(candidate, 0), { code: 'STORAGE_ERROR' });
  assert.equal(h.service.load().cards.length, 5); assert.equal(h.service.load().stats.synthesisCount, 0);
  assert.equal(h.service.loadPending().operationId, 'op:write-fail');
  assert.equal(db.prepare('SELECT count(*) n FROM recipes').get().n, 0);
  db.exec('DROP TRIGGER reject_new'); db.close();
  h.service.save(candidate, 0);
  assert.equal(h.service.loadPending(), null); assert.equal(h.calls.length, 2);
});

test('篡改待存结果指纹不能清除真实答案', async t => {
  const h = harness(t); h.service.initialize(fresh()); await h.service.configure(CONFIG);
  await h.service.generate({ ingredientIds: IDS, operationId: 'op:answer' });
  const pending = h.service.loadPending();
  const tampered = commitSynthesis(h.service.load(), { ...pending, result: { ...CARD, name: '别的答案' } }).save;
  assert.throws(() => h.service.save(tampered, 0), { code: 'OPERATION_CONFLICT' });
  assert.equal(h.service.loadPending().result.name, CARD.name); assert.equal(h.service.load().cards.length, 5);
});

test('普通布局保存不能删除已发现卡牌、配方和操作历史', t => {
  const h = harness(t), old = h.service.initialize(fresh());
  const combined = commitSynthesis(old, { operationId: 'op:history', ingredientIds: IDS, result: CARD, now: TIME }).save;
  h.service.importSave(combined);
  assert.throws(() => h.service.save({ ...old, revision: 2 }, 1), { code: 'INVALID_SAVE' });
  assert.equal(h.service.load().stats.synthesisCount, 1);
});

test('配置限制 HTTPS、凭据 URL、完整 endpoint 和总长度；换 origin 不复用旧 Key', async t => {
  const h = harness(t); h.service.initialize(fresh()); await h.service.configure(CONFIG);
  for (const baseUrl of ['http://fixture.invalid', 'https://user:password@fixture.invalid', 'https://fixture.invalid/?q=1', 'https://fixture.invalid/#x', 'https://fixture.invalid/chat/completions']) assert.throws(() => normalizeConfig({ baseUrl, model: 'x' }));
  assert.deepEqual(normalizeConfig({ baseUrl: 'https://fixture.invalid:443/v1///', model: ' x ' }), { baseUrl: 'https://fixture.invalid/v1', model: 'x' });
  await assert.rejects(h.service.configure({ ...CONFIG, key: '', baseUrl: 'https://different.invalid' }), { code: 'SERVICE_CHANGED_KEY_REQUIRED' });
  await assert.rejects(h.service.configure({ ...CONFIG, key: 'x'.repeat(8192) }), { code: 'CONFIG_TOO_LARGE' });
  await assert.rejects(h.service.configure({ ...CONFIG, key: 'invalid\r\nheader' }), { code: 'INVALID_KEY' });
  assert.equal(h.calls.length, 1);
  await h.service.configure({ ...CONFIG, baseUrl: 'https://fixture.invalid/v2', key: '' });
  assert.equal(h.calls.length, 2);
});

test('HTTP 状态与重定向只返回机器码，不泄漏供应商错误正文', async t => {
  const h = harness(t);
  for (const [status, code] of [[302, 'REDIRECT_REJECTED'], [401, 'AUTH_FAILED'], [402, 'NO_BALANCE'], [404, 'MODEL_NOT_FOUND'], [429, 'RATE_LIMITED'], [500, 'SERVER_ERROR']]) {
    h.setFetch(() => new Response(`synthetic-body-${CONFIG.key}`, { status, headers: { location: 'https://other.invalid' } }));
    await assert.rejects(h.service.configure(CONFIG), error => error.code === code && error.message === code);
  }
  assert.equal(h.calls.length, 6); assert.equal((await h.service.configStatus()).configured, false);
});

test('过长响应、截断、坏 JSON、分类和回显 Key 均不保存配置或答案', async t => {
  const h = harness(t);
  const cases = [
    [() => new Response('x'.repeat(1024 * 1024 + 1)), 'RESPONSE_TOO_LARGE'],
    [() => new Response('x', { headers: { 'content-length': String(1024 * 1024 + 1) } }), 'RESPONSE_TOO_LARGE'],
    [() => new Response('{broken'), 'INVALID_RESPONSE'],
    [() => response({ ...CARD, category: '全服唯一' }), 'INVALID_CARD_RESULT'],
    [() => response({ ...CARD, description: CONFIG.key }), 'AI_SENSITIVE_RESPONSE'],
    [() => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(CARD) } }] })), 'AI_OUTPUT_TRUNCATED'],
  ];
  for (const [fetcher, code] of cases) { h.setFetch(fetcher); await assert.rejects(h.service.configure(CONFIG), { code }); }
  assert.equal((await h.service.configStatus()).configured, false);
});

test('取消后迟到的成功响应不写 pending，新请求可正常完成', async t => {
  const h = harness(t); h.service.initialize(fresh()); await h.service.configure(CONFIG);
  const slow = deferred(); h.setFetch(() => slow.promise);
  const first = h.service.generate({ ingredientIds: IDS, operationId: 'op:cancelled' });
  const rejected = assert.rejects(first, { code: 'CANCELLED' });
  await assert.rejects(h.service.generate({ ingredientIds: IDS, operationId: 'op:busy' }), { code: 'SYNTHESIS_ALREADY_RUNNING' });
  h.service.cancel(); h.setFetch(() => response());
  await h.service.generate({ ingredientIds: IDS, operationId: 'op:new' });
  slow.resolve(response()); await rejected;
  assert.equal(h.service.loadPending().operationId, 'op:new'); assert.equal(h.service.load().stats.synthesisCount, 0);
});

test('请求超时只尝试一次且不泄漏传输错误', async t => {
  const h = harness(t, { timeoutMs: 5, fetcher: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Error(`synthetic-transport-${CONFIG.key}`)), { once: true })) });
  await assert.rejects(h.service.configure(CONFIG), error => error.code === 'REQUEST_TIMEOUT' && error.message === 'REQUEST_TIMEOUT');
  assert.equal(h.calls.length, 1); assert.equal((await h.service.configStatus()).configured, false);
});

test('导入创建库外恢复副本；失败事务保留原档，恢复使用新本机版本', t => {
  const h = harness(t), old = h.service.initialize(fresh());
  const imported = h.service.importSave(fresh('save:second'));
  assert.equal(imported.revision, 1); assert.equal(imported.id, 'save:second');
  const backup = h.service.listBackups().find(item => item.id.startsWith('before-import-') && item.saveId === old.id);
  assert.ok(backup); assert.equal(h.service.restoreBackup(backup.id).id, old.id);
  assert.equal(h.service.load().revision, 2);
  const db = rawDatabase(h.dataDir); db.exec("CREATE TRIGGER reject_import BEFORE INSERT ON current_save BEGIN SELECT RAISE(ABORT,'synthetic import fault'); END;");
  assert.throws(() => h.service.importSave(fresh('save:third')), { code: 'STORAGE_ERROR' });
  assert.equal(h.service.load().id, old.id); db.close();
});

test('物理损坏库不妨碍启动服务和列出副本，恢复保留损坏原件', t => {
  const h = harness(t); h.service.initialize(fresh()); h.service.close();
  const damaged = Buffer.from('synthetic damaged database; preserve this evidence');
  fs.writeFileSync(path.join(h.dataDir, 'world.sqlite3'), damaged);
  const reopened = createService(h.settings); t.after(() => reopened.close());
  assert.throws(() => reopened.load(), { code: 'STORAGE_CORRUPT' });
  assert.equal(reopened.recoveryStatus().storageAvailable, false);
  const backup = reopened.listBackups()[0]; assert.ok(backup);
  assert.equal(reopened.restoreBackup(backup.id).cards.length, 5);
  const preserved = fs.readdirSync(h.dataDir).find(file => /^world\.sqlite3\.damaged-/u.test(file));
  assert.ok(preserved); assert.deepEqual(fs.readFileSync(path.join(h.dataDir, preserved)), damaged);
  assert.equal(reopened.load().cards.length, 5);
});

test('当前 snapshot 损坏可从外部好档恢复，拒绝坏恢复输入且保留数据库原件', t => {
  const h = harness(t); h.service.initialize(fresh());
  const db = rawDatabase(h.dataDir); db.prepare('UPDATE current_save SET document=?').run('{corrupt'); db.close();
  assert.throws(() => h.service.load(), { code: 'STORAGE_CORRUPT' });
  assert.equal(h.service.recoveryStatus().storageAvailable, false);
  assert.throws(() => h.service.importSave('{bad'), { code: 'INVALID_SAVE_JSON' });
  assert.throws(() => h.service.load(), { code: 'STORAGE_CORRUPT' });
  const recovered = h.service.importSave(serializeSave(fresh('save:rescued')));
  assert.equal(recovered.id, 'save:rescued');
  assert.ok(fs.readdirSync(h.dataDir).some(file => /^world\.sqlite3\.damaged-/u.test(file)));
});

test('恢复换名失败撤回原件；主库丢失时不能自动创建空档', t => {
  const h = harness(t); h.service.initialize(fresh()); h.service.close();
  const dbFile = path.join(h.dataDir, 'world.sqlite3'), damaged = Buffer.from('synthetic recovery failure evidence');
  fs.writeFileSync(dbFile, damaged);
  const reopened = createService(h.settings); t.after(() => reopened.close());
  const builtinFs = createRequire(import.meta.url)('node:fs'), originalRename = builtinFs.renameSync;
  builtinFs.renameSync = (from, to) => {
    if (String(from).includes('recovered-') && to === dbFile) { const error = Error('synthetic rename fault'); error.code = 'EACCES'; throw error; }
    return originalRename(from, to);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => reopened.importSave(fresh('save:rescue')), { code: 'STORAGE_ERROR' }); }
  finally { builtinFs.renameSync = originalRename; syncBuiltinESMExports(); }
  assert.deepEqual(fs.readFileSync(dbFile), damaged, '恢复写入失败后坏原件仍在原路径');
  reopened.close();
  fs.renameSync(dbFile, `${dbFile}.missing-test-evidence`);
  const missing = createService(h.settings); t.after(() => missing.close());
  assert.throws(() => missing.load(), { code: 'STORAGE_CORRUPT' });
  assert.equal(fs.existsSync(dbFile), false, '缺失主库但有备份时不自动建空库');
  assert.equal(missing.restoreBackup(missing.listBackups()[0].id).cards.length, 5);
});

test('畸形 pending 不能重放或被新请求覆盖', async t => {
  const h = harness(t); h.service.initialize(fresh()); await h.service.configure(CONFIG);
  const db = rawDatabase(h.dataDir); db.prepare('INSERT INTO pending VALUES(1,?)').run(JSON.stringify({ saveId: 'other', operationId: 'op:bad' })); db.close();
  assert.throws(() => h.service.loadPending(), { code: 'STORAGE_CORRUPT' });
  await assert.rejects(h.service.generate({ ingredientIds: IDS, operationId: 'op:new' }), { code: 'STORAGE_CORRUPT' });
  assert.equal(h.calls.length, 1); assert.equal(h.service.load().cards.length, 5);
});

const MOD = { modFormat: 1, id: 'fixture-world', name: '测试世界', version: '1', theme: '所有新发现都带有海洋气息。',
  cards: [{ name: '贝壳', emoji: '🐚', category: '自然', description: '留住海潮的外壳。' }], startingCards: ['贝壳'] };
function installEnabled(service) {
  const old = service.load(), installed = installMod(old, MOD, { now: TIME });
  service.save(installed, old.revision);
  const enabled = toggleMod(service.load(), MOD.id, true, TIME); service.save(enabled, installed.revision);
  return enabled;
}

test('Mod安装、启用和玩法动作只增发现，不伪造合成次数', t => {
  const h = harness(t); h.service.initialize(fresh()); installEnabled(h.service);
  assert.equal(h.service.load().cards.length, 6); assert.equal(h.service.load().stats.synthesisCount, 0);
  const old = h.service.load(), action = applyModAction(old, MOD.id, { cards: [CARD], state: { presses: 1 } }, TIME);
  h.service.save(action, old.revision);
  assert.equal(h.service.load().cards.length, 7); assert.equal(h.service.load().stats.synthesisCount, 0);
  assert.equal(h.service.load().mods[0].state.presses, 1); assert.equal(h.calls.length, 0);
});

test('Mod本地答案与状态先持久化，重开原子提交且不调用AI', t => {
  const h = harness(t); h.service.initialize(fresh()); installEnabled(h.service);
  const args = { ingredientIds: IDS, operationId: 'op:mod', result: CARD,
    source: { kind: 'mod', modId: MOD.id, modName: MOD.name }, modStates: [{ id: MOD.id, state: { count: 1 } }] };
  const pending = h.service.stageModResult(args);
  assert.equal(pending.modProcessed, true);
  assert.deepEqual(h.service.stageModResult(args), pending);
  assert.throws(() => h.service.stageModResult({ ...args, result: { ...CARD, name: '另一张卡' } }), { code: 'OPERATION_CONFLICT' });
  h.service.close(); const reopened = createService(h.settings); t.after(() => reopened.close());
  const journal = reopened.loadPending(), old = reopened.load(), next = commitSynthesis(old, journal).save;
  assert.equal(journal.source.modId, MOD.id); assert.equal(journal.modStates[0].state.count, 1); assert.equal(journal.modProcessed, true);
  const tamperedState = structuredClone(next); tamperedState.mods[0].state.count = 9;
  assert.throws(() => reopened.save(tamperedState, old.revision), { code: 'OPERATION_CONFLICT' });
  const tamperedSource = structuredClone(next); tamperedSource.operations.at(-1).source = { kind: 'ai' };
  assert.throws(() => reopened.save(tamperedSource, old.revision), { code: 'OPERATION_CONFLICT' });
  reopened.save(next, old.revision);
  assert.equal(reopened.load().mods[0].state.count, 1); assert.equal(reopened.load().stats.synthesisCount, 1);
  assert.equal(reopened.loadPending(), null); assert.equal(h.calls.length, 0);
});

test('AI主题仅进入材料数据，变换更新pending失败保留原答案', async t => {
  const h = harness(t); h.service.initialize(fresh()); installEnabled(h.service); await h.service.configure(CONFIG);
  await h.service.generate({ ingredientIds: IDS, operationId: 'op:transform' });
  const request = JSON.parse(h.calls[1].init.body), user = JSON.parse(request.messages[1].content);
  assert.deepEqual(user.worldThemes, [MOD.theme]); assert.equal(h.calls[1].url, `${CONFIG.baseUrl}/chat/completions`);
  const original = h.service.loadPending();
  assert.equal(original.modProcessed, false);
  assert.throws(() => h.service.save(commitPending(h.service), h.service.load().revision), { code: 'PENDING_MOD_PROCESSING' });
  assert.throws(() => h.service.updatePending({ operationId: 'op:wrong', result: CARD }), { code: 'PENDING_NOT_FOUND' });
  assert.throws(() => h.service.updatePending({ operationId: original.operationId, result: CARD, modStates: [{ id: 'not-installed', state: {} }] }));
  assert.deepEqual(h.service.loadPending(), original);
  const transformed = h.service.updatePending({ operationId: original.operationId, result: { ...CARD, name: '海雾' }, source: { kind: 'ai' }, modStates: [{ id: MOD.id, state: { transformed: true } }] });
  assert.equal(transformed.now, original.now); assert.equal(transformed.result.name, '海雾'); assert.equal(transformed.modProcessed, true);
  const current = h.service.load();
  assert.throws(() => h.service.save(toggleMod(current, MOD.id, false, TIME), current.revision), { code: 'PENDING_SAVE_REQUIRED' });
  h.service.save(commitSynthesis(current, transformed).save, current.revision);
  assert.equal(h.service.load().mods[0].state.transformed, true); assert.equal(h.calls.length, 2);
});

test('缓存配方可携带Mod afterCombine状态落盘，不再次请求AI', t => {
  const h = harness(t); h.service.initialize(fresh()); installEnabled(h.service);
  const old = h.service.load(), first = commitSynthesis(old, { operationId: 'op:first-mod', ingredientIds: IDS, result: CARD, now: TIME }).save;
  h.service.importSave(first);
  const args = { operationId: 'op:cached-mod', ingredientIds: IDS, result: CARD, source: { kind: 'recipe' }, modStates: [{ id: MOD.id, state: { repeats: 1 } }] };
  assert.throws(() => h.service.stageModResult({ ...args, result: { ...CARD, name: '不能改已知配方' } }), { code: 'OPERATION_CONFLICT' });
  const pending = h.service.stageModResult(args), current = h.service.load();
  h.service.save(commitSynthesis(current, pending).save, current.revision);
  assert.equal(h.service.load().stats.synthesisCount, 2); assert.equal(h.service.load().mods[0].state.repeats, 1);
  assert.equal(h.calls.length, 0);
});

test('旧五字段journal默认尚未处理Mod，非法处理标记不能冒充完成', t => {
  const h = harness(t); h.service.initialize(fresh());
  const legacy = { saveId: 'save:fixture', operationId: 'op:legacy', ingredientIds: IDS, result: CARD, now: TIME };
  const db = rawDatabase(h.dataDir); db.prepare('INSERT INTO pending VALUES(?,?)').run(legacy.operationId, JSON.stringify(legacy));
  assert.equal(h.service.loadPending().modProcessed, false);
  db.prepare('UPDATE pending SET document=?').run(JSON.stringify({ ...legacy, modProcessed: 'true' }));
  assert.throws(() => h.service.loadPending(), { code: 'STORAGE_CORRUPT' }); db.close();
});

test('四路未知配方乱序完成，布局可保存，分项提交和重开不会覆盖其他待存答案', async t => {
  const h = harness(t); h.service.initialize(fresh()); await h.service.configure(CONFIG);
  const combinations = [IDS, ['base:metal', 'base:wood'], ['base:earth', 'base:water'], ['base:fire', 'base:wood']];
  const network = [], entered = deferred();
  h.setFetch(() => {
    const gate = deferred(); network.push(gate);
    if (network.length === 4) entered.resolve();
    return gate.promise;
  });
  const operations = combinations.map((ingredientIds, i) => h.service.generate({ ingredientIds, operationId: `parallel:${i}` }));
  const repeated = h.service.generate({ ingredientIds: [...IDS].reverse(), operationId: 'parallel:0' });
  await entered.promise;
  await assert.rejects(h.service.generate({ ingredientIds: IDS, operationId: 'parallel:duplicate' }), { code: 'SYNTHESIS_ALREADY_RUNNING' });
  await assert.rejects(h.service.generate({ ingredientIds: ['base:metal', 'base:earth'], operationId: 'parallel:overflow' }), { code: 'SYNTHESIS_LIMIT' });
  await assert.rejects(h.service.configure(CONFIG), { code: 'BUSY' });
  const beforeLayout = h.service.load();
  h.service.save({ ...beforeLayout, revision: 1, layout: [{ id: 'table:kept', cardId: 'base:metal', x: 23, y: 17, pinned: false }] }, 0);
  assert.equal(h.service.load().layout[0].x, 23);
  for (const i of [2, 0, 3, 1]) {
    network[i].resolve(response({ ...CARD, name: `新卡${i}` }));
    await operations[i];
  }
  assert.deepEqual(await repeated, { ...CARD, name: '新卡0' });
  assert.equal(h.calls.length, 5, '一次配置检测，四次独立生成，重复操作没有第二次收费');
  assert.deepEqual(h.service.listPending().map(item => item.operationId), ['parallel:2', 'parallel:0', 'parallel:3', 'parallel:1']);
  assert.equal(h.service.loadPending('parallel:1').result.name, '新卡1');
  const current = h.service.load(), selected = h.service.loadPending('parallel:1');
  h.service.save(commitSynthesis(current, selected).save, current.revision);
  assert.equal(h.service.loadPending('parallel:1'), null);
  assert.equal(h.service.listPending().length, 3);
  h.service.close();
  const reopened = createService(h.settings); t.after(() => reopened.close());
  assert.equal(reopened.listPending().length, 3);
  for (const item of reopened.listPending()) {
    const previous = reopened.load();
    reopened.save(commitSynthesis(previous, item).save, previous.revision);
  }
  assert.equal(reopened.load().stats.synthesisCount, 4);
  assert.equal(reopened.load().cards.length, 9);
  assert.equal(reopened.load().recipes.length, 4);
  assert.equal(reopened.load().layout[0].x, 23);
  assert.deepEqual(reopened.listPending(), []);
  assert.equal(h.calls.length, 5, '重开续存不重新调用模型');
});

test('只取消指定生成，另一个请求仍能完成并落盘', async t => {
  const h = harness(t); h.service.initialize(fresh()); await h.service.configure(CONFIG);
  const network = [], entered = deferred();
  h.setFetch(() => { const gate = deferred(); network.push(gate); if (network.length === 2) entered.resolve(); return gate.promise; });
  const first = h.service.generate({ ingredientIds: IDS, operationId: 'cancel:first' });
  const cancelled = assert.rejects(first, { code: 'CANCELLED' });
  const second = h.service.generate({ ingredientIds: ['base:wood', 'base:earth'], operationId: 'cancel:second' });
  await entered.promise;
  h.service.cancel('cancel:first');
  network[0].resolve(response({ ...CARD, name: '取消的答案' }));
  network[1].resolve(response({ ...CARD, name: '仍然完成' }));
  await cancelled; await second;
  assert.equal(h.service.loadPending('cancel:first'), null);
  assert.equal(h.service.loadPending('cancel:second').result.name, '仍然完成');
  assert.equal(h.service.listPending().length, 1);
  assert.equal(h.calls.length, 3);
});

function downgradePendingFixture(h) {
  h.service.close();
  const db = rawDatabase(h.dataDir);
  const save = db.prepare('SELECT document FROM current_save').get().document;
  const pending = db.prepare('SELECT document FROM pending').get()?.document ?? null;
  db.exec('BEGIN IMMEDIATE; ALTER TABLE pending RENAME TO pending_v2; CREATE TABLE pending(singleton INTEGER PRIMARY KEY CHECK(singleton=1),document TEXT NOT NULL)');
  if (pending) db.prepare('INSERT INTO pending VALUES(1,?)').run(pending);
  db.exec('DROP TABLE pending_v2; PRAGMA user_version=1; COMMIT'); db.close();
  return { save, pending };
}

test('旧单项待存表迁移前保留原文，升级后仍能接着保存同一答案', async t => {
  const h = harness(t); h.service.initialize(fresh()); await h.service.configure(CONFIG);
  await h.service.generate({ ingredientIds: IDS, operationId: 'migration:kept' });
  const original = downgradePendingFixture(h);
  const reopened = createService(h.settings); t.after(() => reopened.close());
  const item = reopened.loadPending(); assert.equal(item.operationId, 'migration:kept');
  const backup = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'migration-pending-v1.json'), 'utf8'));
  assert.deepEqual(backup, { databaseVersion: 1, ...original });
  const db = rawDatabase(h.dataDir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(db.prepare('SELECT document FROM current_save').get().document, original.save); db.close();
  const current = reopened.load(); reopened.save(commitSynthesis(current, item).save, current.revision);
  assert.equal(reopened.load().stats.synthesisCount, 1); assert.deepEqual(reopened.listPending(), []);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.dataDir, 'migration-pending-v1.json'), 'utf8')), backup);
});

test('旧待存迁移备份失败时原表和原数据完整保留', async t => {
  const h = harness(t); h.service.initialize(fresh()); await h.service.configure(CONFIG);
  await h.service.generate({ ingredientIds: IDS, operationId: 'migration:blocked' });
  const original = downgradePendingFixture(h);
  fs.mkdirSync(path.join(h.dataDir, 'migration-pending-v1.json'));
  const reopened = createService(h.settings); t.after(() => reopened.close());
  assert.throws(() => reopened.load(), { code: 'MIGRATION_BACKUP_FAILED' });
  const db = rawDatabase(h.dataDir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(db.prepare('SELECT document FROM pending WHERE singleton=1').get().document, original.pending);
  assert.equal(db.prepare('SELECT document FROM current_save').get().document, original.save); db.close();
});

test('未知操作缺少自己的待存答案时拒绝快照，其他答案和统计保留', async t => {
  const h = harness(t); h.service.initialize(fresh()); await h.service.configure(CONFIG);
  await h.service.generate({ ingredientIds: IDS, operationId: 'guard:real' });
  const current = h.service.load(), original = h.service.loadPending('guard:real');
  const forged = commitSynthesis(current, { operationId: 'guard:forged', ingredientIds: IDS, result: CARD, now: TIME }).save;
  assert.throws(() => h.service.save(forged, current.revision), { code: 'RESULT_REQUIRED' });
  assert.deepEqual(h.service.load(), current); assert.deepEqual(h.service.loadPending('guard:real'), original);
});
