import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createController } from '../src/controller.js';
import { createLegacyBridge } from '../src/legacy/bridge.js';
import { createNewSave, installMod, toggleMod } from '../src/core/model.js';

const response = name => ({ name, emoji: '✨', category: '自然', description: `${name}的简介。` });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes;reject = no; });
  return { promise, resolve, reject };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('状态未达到预期');
}
async function harness({ initial, beforeSave = async () => {}, configured = true, durable = false, preserveCancelledResponse = false, bridgeOptions = {} } = {}) {
  let committed = initial || null, sequence = 0, bridge;
  const requests = new Map(), cancelled = [], journals = new Map();
  const platform = {
    mode: 'native-test',
    durablePending: durable,
    load: async () => committed,
    initialize: async save => { committed = structuredClone(save);return structuredClone(committed); },
    save: async save => {
      await beforeSave(save);committed = structuredClone(save);
      for (const operation of save.operations) journals.delete(operation.id);
      return structuredClone(committed);
    },
    configStatus: async () => ({ configured }),
    generate(ids, id) {
      const request = deferred();
      requests.set(id, { ...request, ids, resolve(result) {
        if (durable) journals.set(id, { saveId: committed.id, operationId: id, ingredientIds: ids, result,
          now: '2026-11-13T00:00:00.000Z', source: { kind: 'ai' }, modStates: [], modProcessed: false });
        request.resolve(result);
      } });
      return request.promise;
    },
    cancel(id) { cancelled.push(id);if (!preserveCancelledResponse) requests.get(id)?.reject(Error('CANCELLED')); },
    loadPending: async id => id ? journals.get(id) || null : journals.values().next().value || null,
    listPending: async () => [...journals.values()],
  };
  const controller = createController(platform, state => bridge?.update(state), {
    uuid: () => `operation-${++sequence}`, now: () => '2026-11-13T00:00:00.000Z',
  });
  await controller.start();
  bridge = createLegacyBridge(controller, { uuid: () => `folder-${++sequence}`, ...bridgeOptions });
  bridge.install({});
  return { controller, bridge, requests, cancelled, get committed() { return committed; } };
}

test('旧数据字段由当前存档投影，本源与索引不依赖账号或旧服务器', async () => {
  const h = await harness();
  const bases = await h.bridge.api.baseCards();
  assert.deepEqual(bases.cards.map(card => card.name), ['金', '木', '水', '火', '土']);
  assert.deepEqual(bases.cards.map(card => card.seq), [1, 2, 3, 4, 5]);
  assert.equal(bases.cards[2].id, 'base:water');
  assert.equal(bases.cards[2].rar, 9);
  assert.equal(bases.cards[2].descr, '流水之始。');
  assert.equal(bases.cards[2].holder_cnt, 0);
  const search = await h.bridge.api.meCards(0, '水', { cat: '自然', length: 1 });
  assert.equal(search.cards.length, 1);
  assert.equal(search.cards[0].name, '水');
  assert.equal(h.requests.size, 0);
  h.bridge.destroy();
});

test('四份合成同时请求，旧Promise须等实际存档提交后再揭晓', async () => {
  const saving = deferred();
  const h = await harness({ beforeSave: () => saving.promise });
  const groups = [['水', '火'], ['金', '木'], ['木', '水'], ['土', '火']];
  const thinking = [];
  const tasks = groups.map(items => h.bridge.api.combineAndWait(items, id => thinking.push(id)));
  assert.equal(h.requests.size, 4);
  assert.equal(new Set(tasks.map(task => task.operationId)).size, 4);
  assert.equal(thinking.length, 4);
  let settled = false;
  tasks[2].then(() => { settled = true; });
  h.requests.get(tasks[2].operationId).resolve(response('森林'));
  await until(() => h.controller.state.syntheses.find(job => job.id === tasks[2].operationId)?.phase === 'saving');
  assert.equal(settled, false);
  assert.equal(h.committed.stats.synthesisCount, 0);
  saving.resolve();
  const result = await tasks[2];
  assert.equal(result.ok, true);
  assert.equal(result.card.name, '森林');
  assert.equal(result.card.cat, '自然');
  assert.equal(result.card.seq, 6);
  assert.equal(result.isNew, true);
  assert.equal(h.committed.stats.synthesisCount, 1);
  assert.ok(h.committed.operations.some(operation => operation.id === result.operationId));
  for (const index of [0, 1, 3]) h.requests.get(tasks[index].operationId).resolve(response(`发现${index}`));
  const all = await Promise.all(tasks);
  assert.equal(all.every(item => item.ok), true);
  assert.equal(h.committed.stats.synthesisCount, 4);
  h.bridge.destroy();
});

test('重复组合只保留原任务，逐项取消不取消其他材料组合', async () => {
  const h = await harness();
  const first = h.bridge.api.combineAndWait(['水', '火']);
  const other = h.bridge.api.combineAndWait(['金', '木']);
  const duplicate = await h.bridge.api.combineAndWait(['火', '水']);
  assert.equal(duplicate.error, 'SYNTHESIS_ALREADY_RUNNING');
  assert.equal(h.requests.size, 2);
  await h.bridge.api.cancel(first.operationId);
  assert.deepEqual(h.cancelled, [first.operationId]);
  assert.equal((await first).error, 'CANCELLED');
  assert.equal(h.controller.state.syntheses.find(job => job.id === other.operationId).phase, 'requesting');
  h.requests.get(other.operationId).resolve(response('合金'));
  assert.equal((await other).ok, true);
  assert.equal(h.committed.stats.synthesisCount, 1);
  h.bridge.destroy();
});

test('保存失败持续保留等待，重试保存原答案只计数一次', async () => {
  let failSave = true;
  const h = await harness({ beforeSave: async () => { if (failSave) throw Error('SAVE_WRITE_FAILED'); } });
  const task = h.bridge.api.combineAndWait(['水', '火']);
  let settled = false;task.then(() => { settled = true; });
  h.requests.get(task.operationId).resolve(response('蒸汽'));
  await until(() => h.controller.state.canRetrySave);
  assert.equal(settled, false);
  assert.equal(h.committed.stats.synthesisCount, 0);
  failSave = false;
  await h.bridge.ui.retrySave(task.operationId);
  assert.equal((await task).ok, true);
  assert.equal(h.requests.size, 1);
  assert.equal(h.committed.stats.synthesisCount, 1);
  h.bridge.destroy();
});

test('取消与模型答案抵达交错时，旧等待Promise继续保留原生待存结果', async () => {
  const h = await harness({ durable: true, preserveCancelledResponse: true });
  const task = h.bridge.api.combineAndWait(['水', '火']);
  let settled = false;task.then(() => { settled = true; });
  await h.bridge.api.cancel(task.operationId);
  assert.equal(settled, false);
  h.requests.get(task.operationId).resolve(response('蒸汽'));
  await until(() => h.controller.state.canRetrySave);
  assert.equal(settled, false);
  assert.equal(h.committed.stats.synthesisCount, 0);
  await h.bridge.ui.retrySave(task.operationId);
  assert.equal((await task).ok, true);
  assert.equal(h.requests.size, 1);
  assert.equal(h.committed.stats.synthesisCount, 1);
  h.bridge.destroy();
});

test('旧收藏夹与原生favorites同源，改名保留身份，非法卡不覆盖已有收藏', async () => {
  const h = await harness();
  assert.equal((await h.bridge.api.updateFavorites([{ name: '喜欢', cards: ['水', '火'] }])).ok, true);
  const id = h.committed.favorites[0].id;
  assert.deepEqual(h.committed.favorites[0].cardIds, ['base:water', 'base:fire']);
  assert.equal((await h.bridge.api.updateFavorites([{ name: '材料', cards: ['水'] }])).ok, true);
  assert.equal(h.committed.favorites[0].id, id);
  const prefs = await h.bridge.api.prefsGet();
  assert.equal(prefs.data, prefs.prefs);
  assert.deepEqual(prefs.data.favFolders.folders[0].cards, ['水']);
  const collected = await h.bridge.api.meCollections();
  assert.deepEqual(collected.collectedNames, ['水']);
  assert.equal((await h.bridge.api.updateFavorites([{ name: '材料', cards: ['不存在'] }])).ok, false);
  assert.deepEqual(h.committed.favorites[0].cardIds, ['base:water']);
  h.bridge.destroy();
});

test('管理入口实时读取弹层开合，不遗留台面阻塞，销毁只恢复本次安装的globals', async () => {
  const opened = [], snapshots = [], blocks = [];
  let modalOpen = false;
  const h = await harness({ configured: false, bridgeOptions: {
    canAccess: () => false, isModalOpen: () => modalOpen,
    onOpen: name => { opened.push(name);modalOpen = true; },
  } });
  const old = { original: true }, target = { WXGC2_API: old };
  h.bridge.install(target);
  const release = target.WXGC3_UI.bindFactory({ setSnapshot: state => snapshots.push(state), blockInput: value => blocks.push(value) });
  assert.equal(target.WXGC3_UI.ensurePlay(), false);
  assert.deepEqual(opened, ['api']);
  assert.equal(target.WXGC3_UI.isModalOpen(), true);
  // 关闭管理页不修改任何业务数据，也不依赖下一次保存来解除输入阻塞。
  modalOpen = false;
  assert.equal(target.WXGC3_UI.isModalOpen(), false);
  assert.deepEqual(blocks, []);
  assert.equal(snapshots[0].save.cards.length, 5);
  release();h.bridge.destroy();
  assert.equal(target.WXGC2_API, old);
  assert.equal(target.WXGC3_UI, undefined);
});

test('Mod外观和玩法入口从当前存档读取，保持原资源字段', async () => {
  const manifest = JSON.parse(await readFile(new URL('../examples/mods/苔光花园.wxgc3-mod', import.meta.url), 'utf8'));
  const fresh = createNewSave({ id: 'mod-world', now: '2026-11-12T00:00:00.000Z' });
  const installed = installMod(fresh, manifest, { now: '2026-11-12T00:00:01.000Z' });
  const active = toggleMod(installed, manifest.id, true, '2026-11-12T00:00:02.000Z');
  const h = await harness({ initial: active });
  const skins = h.bridge.ui.getModAppearances('skins');
  assert.ok(skins.length > 0);
  const selected = h.bridge.ui.getAppearance('skins', skins[0].id);
  assert.equal(selected.id, skins[0].id);
  assert.equal(selected.image, skins[0].image);
  assert.ok(h.bridge.ui.getModActions().every(action => action.modId === manifest.id));
  assert.equal(h.bridge.api.settings.all().skinId, active.preferences.skinId);
  h.bridge.destroy();
});
