import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLibrary } from '../platforms/windows/library.mjs';
import { createNativePlatform } from '../src/platform/native.js';
import { createController } from '../src/controller.js';
import { createNewSave, validateSave } from '../src/core/model.js';

// 只用独立临时档和内存假响应。真实 SQLite / bridge / controller 保留，
// 闸门只控制异步响应先后，验证开放台面操作不会覆盖合成或清掉待存答案。
const ROOT = process.env.WXGC3_TEST_DIR || path.join(tmpdir(), 'infinitefactory3-tests');
const IDS = ['base:metal', 'base:wood'];
const CARD = { name: '工具', emoji: '🛠️', category: '科技', description: '让双手更有办法。' };
const CONFIG = { baseUrl: 'https://fixture.invalid/v1', model: 'fixture', key: 'synthetic-test-credential-only' };
const copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(CARD) } }] }), { status: 200 });
const node = (id, cardId, x, y = 0) => ({ id, cardId, x, y, pinned: false });
const ORIGINAL = [node('table:metal', IDS[0], -120), node('table:wood', IDS[1], 0), node('table:water', 'base:water', 120)];

async function harness(t) {
  fs.mkdirSync(ROOT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(ROOT, 'case-'));
  const calls = { requests: 0, generates: 0, saves: [] };
  let fetcher = async () => response(), beforeSave = null, afterGenerate = null, afterGenerateError = null, sequence = 0;
  const library = createLibrary({
    dataDir, encrypt: text => Buffer.from(text), decrypt: bytes => Buffer.from(bytes).toString('utf8'),
    fetchImpl: async (...args) => { calls.requests++; return fetcher(...args); },
  });
  t.after(() => library.close());
  const target = { wxgcNative: { async invoke(command, args) {
    if (command !== 'library_status') library.assertSlot(args.slotId);
    switch (command) {
      case 'library_status': return library.status();
      case 'load_save': return library.load(args.slotId);
      case 'initialize_save': return library.initialize(args.save, args.slotId);
      case 'config_status': return library.configStatus(args.slotId);
      case 'configure_ai': return library.configure(args.config, args.slotId);
      case 'load_pending': return library.loadPending(args.slotId,args.operationId);
      case 'list_pending': return library.listPending(args.slotId);
      case 'recovery_status': return library.recoveryStatus(args.slotId);
      case 'save_snapshot':
        calls.saves.push({ slotId: args.slotId, save: copy(args.save) });
        if (beforeSave) await beforeSave(args);
        return library.save(args.save, args.expectedRevision, args.slotId);
      case 'generate_card': {
        calls.generates++;
        try {
          const result = await library.generate(args);
          if (afterGenerate) await afterGenerate(args);
          return result;
        } catch (error) { if (afterGenerateError) await afterGenerateError(args); throw error; }
      }
      case 'cancel_request': return library.cancel(args.slotId,args.operationId);
      case 'create_slot': return library.createSlot(args);
      case 'switch_slot': return library.switchSlot(args);
      default: assert.fail('未覆盖命令：' + command);
    }
  } } };
  const platform = createNativePlatform(target);
  const controller = createController(platform, () => {}, { uuid: () => `feel:${++sequence}` });
  await controller.start();
  await controller.callbacks.onConfigure({ ...CONFIG });
  assert.equal(controller.state.error, '');
  await controller.callbacks.onSaveLayout(copy(ORIGINAL));
  return {
    controller, callbacks: controller.callbacks, library, calls, dataDir,
    setFetcher(value) { fetcher = value; },
    setBeforeSave(value) { beforeSave = value; },
    setAfterGenerate(value) { afterGenerate = value; },
    setAfterGenerateError(value) { afterGenerateError = value; },
    disk() { return library.load(controller.state.library.activeSlotId); },
  };
}

test('等待 AI 时取卡、拖动与缩放写入后，两组合成各请求一次并保留最新台面', async t => {
  const h = await harness(t), entered = deferred(), answer = deferred();
  h.setFetcher(async () => { entered.resolve(); await answer.promise; return response(); });
  const combining = h.callbacks.onCombine(IDS);
  await entered.promise;
  const moved = [...copy(ORIGINAL).map(item => item.cardId === 'base:water' ? { ...item, x: 210, y: 80 } : item), node('table:fire', 'base:fire', 310)];
  await h.callbacks.onSaveLayout(moved);
  await h.callbacks.onSavePreferences({ zoom: 1.2 });
  const second = h.callbacks.onCombine(['base:water', 'base:fire']);
  assert.equal(h.calls.generates, 2, '两个不同组合各有自己的请求');
  assert.deepEqual(h.disk().layout, moved);
  assert.equal(h.disk().stats.synthesisCount, 0);
  answer.resolve(); await Promise.all([combining, second]);
  assert.equal(h.controller.state.error, '');
  assert.deepEqual(h.disk().layout, moved);
  assert.equal(h.disk().preferences.zoom, 1.2);
  assert.equal(h.disk().stats.synthesisCount, 2);
  assert.equal(h.disk().recipes.length, 2);
  assert.equal(h.calls.requests, 3, '一次配置检测加两个组合的生成');
});

test('答案已进原生待存日志但响应尚未到达时，普通布局写入保留原答案', async t => {
  const h = await harness(t), journalReady = deferred(), release = deferred();
  h.setAfterGenerate(async () => { journalReady.resolve(); await release.promise; });
  const combining = h.callbacks.onCombine(IDS);
  await journalReady.promise;
  const slot = h.controller.state.library.activeSlotId, pending = h.library.loadPending(slot);
  assert.ok(pending?.operationId);
  const arranged = ORIGINAL.map((item, index) => ({ ...item, x: index * 92, y: 116 }));
  await h.callbacks.onSaveLayout(arranged);
  await h.callbacks.onSavePreferences({ zoom: 0.8 });
  assert.deepEqual(h.library.loadPending(slot), pending, '台面保存不能把付费答案当已提交清除');
  assert.equal(h.disk().stats.synthesisCount, 0);
  release.resolve(); await combining;
  assert.deepEqual(h.disk().layout, arranged);
  assert.equal(h.disk().stats.synthesisCount, 1);
  assert.equal(h.library.loadPending(slot), null);
});

test('慢合成提交期间排队的布局、偏好和结果落台面不会回退卡牌配方统计', async t => {
  const h = await harness(t), committing = deferred(), release = deferred();
  h.setBeforeSave(async ({ save }) => { if (save.stats.synthesisCount === 1 && h.disk().stats.synthesisCount === 0) { committing.resolve(); await release.promise; } });
  const combining = h.callbacks.onCombine(IDS);
  await committing.promise;
  const moved = [...copy(ORIGINAL), node('table:extra', 'base:water', 240, 200)];
  const layoutWrite = h.callbacks.onSaveLayout(moved), preferenceWrite = h.callbacks.onSavePreferences({ zoom: 1.1 });
  release.resolve(); await Promise.all([combining, layoutWrite, preferenceWrite]);
  assert.equal(h.controller.state.error, '');
  assert.deepEqual(h.disk().layout, moved);
  assert.equal(h.disk().stats.synthesisCount, 1);
  assert.equal(h.disk().cards.length, 6);
  assert.equal(h.disk().recipes.length, 1);
  // 结果揭晓由画布提交布局：只移除具体参与实例，保留等待时取出的副本。
  const resultId = h.controller.state.lastResult.card.id;
  const revealed = moved.filter(item => !['table:metal', 'table:wood'].includes(item.id)).concat(node('table:result', resultId, -60));
  await h.callbacks.onSaveLayout(revealed);
  assert.deepEqual(h.disk().layout, revealed);
  assert.equal(h.disk().stats.synthesisCount, 1);
  assert.equal(h.calls.generates, 1);
});

test('结果保存失败后仍可整理，重试保留新布局与同一答案且不重发 AI', async t => {
  const h = await harness(t); let failCommit = true;
  h.setBeforeSave(async ({ save }) => { if (failCommit && save.stats.synthesisCount === 1) { failCommit = false; throw Error('STORAGE_ERROR'); } });
  await h.callbacks.onCombine(IDS);
  assert.equal(h.controller.state.canRetrySave, true);
  const slot = h.controller.state.library.activeSlotId, pending = h.library.loadPending(slot);
  assert.ok(pending?.operationId);
  const layout = [...ORIGINAL.map((item, index) => ({ ...item, x: index * 100, y: 100 })), node('table:fire', 'base:fire', 300, 100)];
  await h.callbacks.onSaveLayout(layout);
  assert.deepEqual(h.library.loadPending(slot), pending);
  assert.equal(h.disk().stats.synthesisCount, 0);
  await h.callbacks.onRetrySave();
  assert.equal(h.controller.state.canRetrySave, false);
  assert.equal(h.controller.state.error, '');
  assert.deepEqual(h.disk().layout, layout);
  assert.equal(h.disk().operations[0].id, pending.operationId);
  assert.equal(h.disk().stats.synthesisCount, 1);
  assert.equal(h.library.loadPending(slot), null);
  assert.equal(h.calls.generates, 1);
});

test('取消合成保留等待时的台面修改，切档后迟到响应不写入新档', async t => {
  const h = await harness(t), oldSlot = h.controller.state.library.activeSlotId;
  await h.callbacks.onCreateSlot('隔离新档');
  const newSlot = h.controller.state.library.activeSlotId;
  await h.callbacks.onSwitchSlot(oldSlot);
  const entered = deferred(), replyParked = deferred(), replyRelease = deferred();
  h.setFetcher(async (_, { signal }) => { entered.resolve(); return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('cancelled fixture request')), { once: true })); });
  // 原生取消已完成，但旧 IPC 拒绝响应稍后才交给前端，模拟跨槽迟到回调。
  h.setAfterGenerateError(async () => { replyParked.resolve(); await replyRelease.promise; });
  const combining = h.callbacks.onCombine(IDS); await entered.promise;
  const layout = [...copy(ORIGINAL), node('table:extra', 'base:water', 220, 100)];
  await h.callbacks.onSaveLayout(layout);
  await h.callbacks.onCancel();
  await replyParked.promise;
  assert.equal(h.controller.state.synthesis.phase, 'cancelled');
  assert.deepEqual(h.disk().layout, layout);
  await h.callbacks.onSwitchSlot(newSlot);
  replyRelease.resolve(); await combining;
  assert.equal(h.controller.state.library.activeSlotId, newSlot);
  assert.equal(h.disk().stats.synthesisCount, 0);
  assert.equal(h.disk().cards.length, 5);
  assert.equal(h.library.loadPending(newSlot), null);
  await h.callbacks.onSwitchSlot(oldSlot);
  assert.deepEqual(h.disk().layout, layout);
  assert.equal(h.disk().stats.synthesisCount, 0);
  assert.equal(h.library.loadPending(oldSlot), null);
  assert.equal(h.calls.generates, 1);
});

test('切档等待已接受的布局写入完成，切档中的新布局请求不能串到目标档', async t => {
  const h = await harness(t), oldSlot = h.controller.state.library.activeSlotId;
  await h.callbacks.onCreateSlot('另一个世界');
  const newSlot = h.controller.state.library.activeSlotId;
  await h.callbacks.onSwitchSlot(oldSlot);
  const writing = deferred(), release = deferred();
  h.setBeforeSave(async () => { writing.resolve(); await release.promise; });
  const layout = [...copy(ORIGINAL), node('table:extra', 'base:water', 240)];
  const save = h.callbacks.onSaveLayout(layout); await writing.promise;
  const switching = h.callbacks.onSwitchSlot(newSlot);
  await h.callbacks.onSaveLayout([node('must-not-cross', 'base:fire', 999)]);
  release.resolve(); await Promise.all([save, switching]);
  h.setBeforeSave(null);
  assert.equal(h.controller.state.library.activeSlotId, newSlot);
  assert.deepEqual(h.disk().layout, []);
  await h.callbacks.onSwitchSlot(oldSlot);
  assert.deepEqual(h.disk().layout, layout);
});

test('收空台面的标记和布局一起落盘，数据库重开与导出保持空台面', async t => {
  const h = await harness(t), slot = h.controller.state.library.activeSlotId;
  await h.callbacks.onSaveLayout([]);
  assert.deepEqual(h.disk().layout, []);
  assert.equal(h.disk().preferences.layoutInitialized, true);
  assert.equal(h.disk().cards.length, 5, '收回台面实例不删词典里的本源');
  h.library.close();
  const reopened = createLibrary({ dataDir: h.dataDir });
  t.after(() => reopened.close());
  const recovered = reopened.load(slot), exported = validateSave(JSON.parse(reopened.exportJSON(slot)));
  assert.deepEqual(recovered.layout, []);
  assert.equal(recovered.preferences.layoutInitialized, true);
  assert.deepEqual(exported.layout, []);
  assert.equal(exported.preferences.layoutInitialized, true);
  const legacy = createNewSave({ id: 'legacy-layout', now: new Date().toISOString() });
  delete legacy.preferences.layoutInitialized;
  assert.equal(validateSave(legacy).preferences.layoutInitialized, false, '无标记旧档保持原来首次铺本源的语义');
  assert.throws(() => validateSave({ ...legacy, preferences: { ...legacy.preferences, layoutInitialized: 'true' } }), { code: 'INVALID_SAVE' });
});
