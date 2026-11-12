import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createLibrary} from '../platforms/windows/library.mjs';
import {createNativePlatform} from '../src/platform/native.js';
import {createController} from '../src/controller.js';

const ROOT = process.env.WXGC3_TEST_DIR || path.join(tmpdir(), 'infinitefactory3-tests');
fs.mkdirSync(ROOT,{recursive:true});
const MOD={modFormat:1,id:'integration',name:'整合工坊',version:'1',cards:[{name:'工具',emoji:'🛠️',category:'科技',description:'让双手更有办法。'}],recipes:[{ingredients:['木','金'],result:'工具'}]};

test('真实SQLite库接正式bridge与controller：首次空槽初始化、Mod合成、切档与整档分享导入',async t=>{
  const dataDir=fs.mkdtempSync(path.join(ROOT,'case-'));let requests=0,input=JSON.stringify(MOD),exported=null,sequence=0,confirmation=null;
  const library=createLibrary({dataDir,encrypt:text=>Buffer.from(text),decrypt:bytes=>Buffer.from(bytes).toString('utf8'),fetchImpl:async()=>{requests++;throw Error('不应访问网络');}});t.after(()=>library.close());
  const target={wxgcNative:{async invoke(command,args){
    if(command!=='library_status')library.assertSlot(args.slotId);
    switch(command){
      case 'library_status':return library.status();case 'load_save':return library.load(args.slotId);case 'initialize_save':return library.initialize(args.save,args.slotId);
      case 'config_status':return library.configStatus(args.slotId);case 'load_pending':return library.loadPending(args.slotId,args.operationId);case 'list_pending':return library.listPending(args.slotId);case 'recovery_status':return library.recoveryStatus(args.slotId);
      case 'save_snapshot':return library.save(args.save,args.expectedRevision,args.slotId);case 'stage_mod_result':return library.stageModResult(args);case 'update_pending':return library.updatePending(args);
      case 'create_slot':return library.createSlot(args);case 'switch_slot':return library.switchSlot(args);case 'rename_slot':return library.renameSlot(args);case 'import_as_slot':return library.importAsSlot(args);
      case 'choose_mod_file':case 'choose_import_file':return input;case 'confirm_import':confirmation=args;return true;
      case 'export_save_file':exported=library.exportJSON(args.slotId);return true;case 'generate_card':return library.generate(args);
      default:assert.fail('未覆盖原生命令 '+command);
    }
  }}};
  const platform=createNativePlatform(target),controller=createController(platform,()=>{},{uuid:()=>`integration:${++sequence}`,confirmImport:save=>platform.confirmImport(save)});
  await controller.start();assert.equal(controller.state.error,'');assert.equal(controller.state.save.cards.length,5);assert.equal(controller.state.library.activeSlotId,'legacy');assert.equal(controller.state.library.slots[0].cardCount,5);
  await controller.callbacks.onChooseMod();await controller.callbacks.onInstallMod();await controller.callbacks.onToggleMod('integration',true);assert.equal(controller.state.save.mods[0].enabled,true);
  await controller.callbacks.onCombine(['base:wood','base:metal']);assert.equal(controller.state.error,'');assert.equal(controller.state.save.stats.synthesisCount,1);assert.equal(controller.state.save.operations[0].source.kind,'mod');assert.equal(library.loadPending('legacy'),null);assert.equal(requests,0);
  const originalId=controller.state.save.id;await controller.callbacks.onCreateSlot('新世界');assert.equal(controller.state.save.cards.length,5);assert.equal(controller.state.save.mods.length,0);assert.notEqual(controller.state.library.activeSlotId,'legacy');
  await controller.callbacks.onSwitchSlot('legacy');assert.equal(controller.state.save.stats.synthesisCount,1);assert.equal(controller.state.save.mods[0].manifest.name,'整合工坊');
  await controller.callbacks.onExport();input=exported;await controller.callbacks.onImport();assert.equal(controller.state.error,'');assert.notEqual(controller.state.save.id,originalId);assert.equal(controller.state.library.slots.length,3);assert.equal(controller.state.save.mods.length,1);assert.equal(controller.state.save.stats.synthesisCount,1);assert.equal(confirmation.modCount,1);assert.equal(confirmation.enabledScriptCount,0);assert.equal(requests,0);
});


const PARALLEL_MATERIALS = [
  ['base:metal', 'base:wood'],
  ['base:water', 'base:fire'],
  ['base:earth', 'base:wood'],
  ['base:metal', 'base:fire'],
];
function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function modelResponse(name) {
  const card = { name, emoji: '✨', category: '自然', description: '隔离环境中的合成结果。' };
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(card) } }] }));
}
async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('未到达期望的异步阶段');
}
async function parallelHarness(t, { modRuntime } = {}) {
  const dataDir = fs.mkdtempSync(path.join(ROOT, 'parallel-'));
  const requests = [], failOperations = new Set();
  let sequence = 0, configuring = true;
  const library = createLibrary({
    dataDir, timeoutMs: 5000,
    encrypt: text => Buffer.from(text),
    decrypt: bytes => Buffer.from(bytes).toString('utf8'),
    fetchImpl: async (_url, options) => {
      if (configuring) return modelResponse('检测结果');
      const deferred = gate();
      options.signal.addEventListener('abort', () => deferred.reject(new DOMException('cancelled', 'AbortError')), { once: true });
      requests.push(deferred);
      return deferred.promise;
    },
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
      case 'generate_card': return library.generate(args);
      case 'cancel_request': return library.cancel(args.slotId, args.operationId);
      case 'load_pending': return library.loadPending(args.slotId, args.operationId);
      case 'list_pending': return library.listPending(args.slotId);
      case 'update_pending': return library.updatePending(args);
      case 'stage_mod_result': return library.stageModResult(args);
      case 'recovery_status': return library.recoveryStatus(args.slotId);
      case 'list_backups': return library.listBackups(args.slotId);
      case 'restore_backup': return library.restoreBackup(args.id, args.slotId);
      case 'save_snapshot': {
        const current = library.load(args.slotId);
        const added = args.save.operations.find(op => !current.operations.some(old => old.id === op.id));
        if (added && failOperations.delete(added.id)) throw Error('SAVE_WRITE_FAILED');
        return library.save(args.save, args.expectedRevision, args.slotId);
      }
      case 'choose_mod_file': return JSON.stringify({
        modFormat: 1, id: 'parallel.counter', name: '计数世界', version: '1',
        script: 'registerMod({});',
      });
      default: assert.fail('未覆盖命令 ' + command);
    }
  } } };
  const controller = createController(createNativePlatform(target), () => {}, {
    uuid: () => 'parallel:' + (++sequence), ...(modRuntime ? { modRuntime } : {}),
  });
  await controller.start();
  await controller.callbacks.onConfigure({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', key: 'parallel-fixture-only' });
  assert.equal(controller.state.configStatus.configured, true);
  assert.equal(controller.state.save.stats.synthesisCount, 0);
  configuring = false;
  return { controller, library, requests, failOperations,
    reopenController: () => createController(createNativePlatform(target), () => {}, { uuid: () => 'reopened:' + (++sequence) }) };
}

test('真实桥与SQLite支持四组同时请求，乱序落盘、单组补存和本地配方互不覆盖', async t => {
  const h = await parallelHarness(t), c = h.controller;
  const running = PARALLEL_MATERIALS.map(ids => c.callbacks.onCombine(ids));
  await waitFor(() => h.requests.length === 4);
  assert.equal(c.state.activeSynthesisCount, 4);
  const duplicate = c.callbacks.onCombine(PARALLEL_MATERIALS[0]);
  assert.equal(duplicate, running[0]);
  await c.callbacks.onCombine(['base:water', 'base:earth']);
  assert.equal(h.requests.length, 4);
  const jobs = c.state.syntheses.map(job => job.id);
  h.failOperations.add(jobs[0]);
  for (const index of [2, 0, 3, 1]) {
    h.requests[index].resolve(modelResponse('发现' + ['甲', '乙', '丙', '丁'][index]));
    await running[index];
  }
  assert.equal(c.state.save.stats.synthesisCount, 3);
  assert.equal(c.state.syntheses.find(job => job.id === jobs[0]).phase, 'save-failed');
  assert.equal(h.library.listPending('legacy').length, 1);
  await c.callbacks.onRetrySave(jobs[0]);
  assert.equal(c.state.save.stats.synthesisCount, 4);
  assert.equal(c.state.save.cards.length, 9);
  assert.equal(c.state.save.recipes.length, 4);
  assert.equal(h.library.listPending('legacy').length, 0);
  assert.equal(h.requests.length, 4);
  await c.callbacks.onRetrySave(jobs[0]);
  assert.equal(c.state.save.stats.synthesisCount, 4);
  const another = c.callbacks.onCombine(['base:earth', 'base:fire']);
  await waitFor(() => h.requests.length === 5);
  await c.callbacks.onCombine(PARALLEL_MATERIALS[0]);
  assert.equal(c.state.save.stats.synthesisCount, 5);
  assert.equal(h.requests.length, 5);
  h.requests[4].resolve(modelResponse('发现戊'));
  await another;
  assert.equal(c.state.save.stats.synthesisCount, 6);
});

test('真实桥取消一组时另外三组继续，切档和Mod状态保持安全', async t => {
  const h = await parallelHarness(t), c = h.controller;
  const running = PARALLEL_MATERIALS.map(ids => c.callbacks.onCombine(ids));
  await waitFor(() => h.requests.length === 4);
  const id = c.state.syntheses[0].id;
  await c.callbacks.onCancel(id);
  await running[0];
  for (let i = 1; i < 4; i++) h.requests[i].resolve(modelResponse('保留' + ['零', '甲', '乙', '丙'][i]));
  await Promise.all(running);
  assert.equal(c.state.syntheses.find(job => job.id === id).phase, 'cancelled');
  assert.equal(c.state.save.stats.synthesisCount, 3);
  assert.equal(c.state.save.recipes.length, 3);
  assert.equal(h.library.listPending('legacy').length, 0);
});

test('多组答案按提交顺序处理Mod，同一份玩法状态累积四次', async t => {
  const modRuntime = {
    async resolve() { return null; },
    async process(save, _ids, result, meta) {
      return { result, source: meta.source,
        modStates: [{ id: 'parallel.counter', state: { count: (save.mods[0].state.count || 0) + 1 } }] };
    },
  };
  const h = await parallelHarness(t, { modRuntime }), c = h.controller;
  await c.callbacks.onChooseMod();
  await c.callbacks.onInstallMod();
  await c.callbacks.onToggleMod('parallel.counter', true);
  assert.equal(c.state.save.mods[0].enabled, true);
  const running = PARALLEL_MATERIALS.map(ids => c.callbacks.onCombine(ids));
  await waitFor(() => h.requests.length === 4);
  for (const i of [3, 1, 0, 2]) h.requests[i].resolve(modelResponse('计数' + ['甲', '乙', '丙', '丁'][i]));
  await Promise.all(running);
  assert.equal(c.state.save.stats.synthesisCount, 4);
  assert.equal(c.state.save.mods[0].state.count, 4);
  assert.equal(h.library.listPending('legacy').length, 0);
  assert.equal(c.state.error, '');
});


test('控制器重开读取四份原生待存答案，逐份补存不再请求模型', async t => {
  const h = await parallelHarness(t);
  const running = PARALLEL_MATERIALS.map((ingredientIds, index) => h.library.generate({
    slotId: 'legacy', operationId: 'interrupted:' + index, ingredientIds,
  }));
  await waitFor(() => h.requests.length === 4);
  for (let i = 0; i < 4; i++) h.requests[i].resolve(modelResponse('重开' + ['甲', '乙', '丙', '丁'][i]));
  await Promise.all(running);
  assert.equal(h.library.load('legacy').stats.synthesisCount, 0);
  assert.equal(h.library.listPending('legacy').length, 4);
  const resumed = h.reopenController();
  await resumed.start();
  assert.equal(resumed.state.syntheses.length, 4);
  assert.equal(resumed.state.canRetrySave, true);
  assert.equal(resumed.state.save.stats.synthesisCount, 0);
  await resumed.callbacks.onRetrySave();
  assert.equal(resumed.state.save.stats.synthesisCount, 4);
  assert.equal(resumed.state.save.cards.length, 9);
  assert.equal(h.library.listPending('legacy').length, 0);
  assert.equal(h.requests.length, 4);
});


test('有状态Mod提交失败后，后续答案先排队，补存后按最新状态继续', async t => {
  let hooks = 0;
  const modRuntime = {
    async resolve() { return null; },
    async process(save, _ids, result, meta) {
      hooks++;
      return { result, source: meta.source,
        modStates: [{ id: 'parallel.counter', state: { count: (save.mods[0].state.count || 0) + 1 } }] };
    },
  };
  const h = await parallelHarness(t, { modRuntime }), c = h.controller;
  await c.callbacks.onChooseMod();await c.callbacks.onInstallMod();await c.callbacks.onToggleMod('parallel.counter', true);
  const running = PARALLEL_MATERIALS.map(ids => c.callbacks.onCombine(ids));
  await waitFor(() => h.requests.length === 4);
  const ids = c.state.syntheses.map(job => job.id);
  h.failOperations.add(ids[0]);
  h.requests[0].resolve(modelResponse('排队甲'));await running[0];
  for (let i = 1; i < 4; i++) {
    h.requests[i].resolve(modelResponse('排队' + ['零', '乙', '丙', '丁'][i]));
    await running[i];
  }
  assert.equal(c.state.save.stats.synthesisCount, 0);
  assert.equal(hooks, 1, '前一个Mod状态未提交前，后续钩子不能读取旧状态并预计算');
  assert.equal(h.library.listPending('legacy').length, 4);
  assert.equal(c.state.syntheses.filter(job => job.phase === 'queued').length, 3);
  await c.callbacks.onRetrySave(ids[0]);
  await waitFor(() => c.state.save.stats.synthesisCount === 4);
  assert.equal(c.state.save.mods[0].state.count, 4);
  assert.equal(hooks, 4, '已经成功处理的首份答案不得重跑钩子');
  assert.equal(h.requests.length, 4);
  assert.equal(h.library.listPending('legacy').length, 0);
});


test('恢复较早备份后清除旧世界任务，再合成不重放先前结果', async t => {
  const h = await parallelHarness(t), c = h.controller;
  const first = c.callbacks.onCombine(PARALLEL_MATERIALS[0]);
  await waitFor(() => h.requests.length === 1);
  h.requests[0].resolve(modelResponse('旧世界结果'));await first;
  const oldId = c.state.syntheses[0].id;
  await c.callbacks.onListBackups();
  const original = c.state.backups.find(item => item.cardCount === 5);
  assert.ok(original);
  await c.callbacks.onRestoreBackup(original.id);
  assert.equal(c.state.save.stats.synthesisCount, 0);
  const next = c.callbacks.onCombine(PARALLEL_MATERIALS[0]);
  await waitFor(() => h.requests.length === 2);
  assert.equal(c.state.syntheses.length, 1);
  assert.ok(c.state.syntheses.every(item => item.id !== oldId));
  h.requests[1].resolve(modelResponse('恢复后结果'));await next;
  assert.equal(c.state.save.stats.synthesisCount, 1);
});
