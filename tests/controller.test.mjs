import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, errorText } from '../src/controller.js';
import { createNewSave, serializeSave, validateSave, commitSynthesis, installMod, toggleMod } from '../src/core/model.js';

const TIME='2026-10-26T10:00:00.000Z';
const INGREDIENTS=['base:metal','base:wood'];
const RESULT={name:'工具',emoji:'🛠️',category:'科技',description:'让双手更有办法。'};
const copy=value=>structuredClone(value);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
let controllerSequence=0;

async function harness(options={}) {
  const sessionId=++controllerSequence;
  let disk=validateSave(options.initialSave??createNewSave({id:'controller-save',now:TIME})),configured=options.configured??true,sequence=0;
  const calls={generate:[],save:[],configure:[],imports:[],cancel:0,export:0,readImport:0,initialize:0},renders=[];
  let failWrites=options.failWrites||0;
  const platform={
    mode:options.mode||'native',
    async load(){if(options.loadError)throw Error(options.loadError);return copy(disk);},
    async initialize(value){calls.initialize++;disk=validateSave(value);return copy(disk);},
    async configStatus(){if(options.configStatusError)throw Error(options.configStatusError);return {configured,baseUrl:'https://example.invalid',model:'fixture'};},
    async configure(value){calls.configure.push({...value});if(options.configure)return options.configure(value,calls.configure.length);if(options.configureError)throw Error(options.configureError);configured=true;return this.configStatus();},
    async generate(ids,operationId){calls.generate.push([...ids]);calls.operationId=operationId;return options.generate?options.generate(ids,calls.generate.length,operationId):copy(RESULT);},
    async save(value,expectedRevision){
      calls.save.push({value:copy(value),expectedRevision});
      if(failWrites>0){failWrites--;throw Error('STORAGE_ERROR');}
      if(options.beforeSave)await options.beforeSave(value,calls.save.length);
      assert.equal(expectedRevision,disk.revision,'持久化必须基于最新已提交版本');
      assert.equal(value.revision,expectedRevision+1);
      disk=validateSave(value);return copy(disk);
    },
    async cancel(){calls.cancel++;if(options.cancel)return options.cancel();},
    async exportSave(){calls.export++;return options.exportSave?options.exportSave(copy(disk)):true;},
    async readImport(){calls.readImport++;return options.readImport?options.readImport():options.importText??null;},
    async importSave(value){calls.imports.push(copy(value));if(options.importError)throw Error(options.importError);disk=validateSave({...value,revision:disk.revision+1});return copy(disk);},
  };
  if(Object.hasOwn(options,'pending'))platform.loadPending=async()=>copy(options.pending);
  if(options.loadPending)platform.loadPending=options.loadPending;
  if(options.durablePending)platform.durablePending=true;
  if(options.backups)platform.listBackups=async()=>copy(options.backups);
  if(options.restoreBackup)platform.restoreBackup=options.restoreBackup;
  if(options.platform)Object.assign(platform,options.platform);
  const controller=createController(platform,s=>renders.push(copy(s)),{now:()=>TIME,uuid:()=>`controller-${sessionId}-op-${++sequence}`,confirmImport:options.confirmImport||(()=>true),...(options.modRuntime?{modRuntime:options.modRuntime}:{})});
  await controller.start();
  return {controller,callbacks:controller.callbacks,calls,renders,get disk(){return copy(disk);}};
}

const phasesFor=(renders,id)=>renders.map(s=>s.synthesis).filter(s=>s?.id===id).map(s=>s.phase).filter((phase,index,phases)=>index===0||phase!==phases[index-1]);

const journal=(patch={})=>({saveId:'controller-save',operationId:'reopened-operation',ingredientIds:INGREDIENTS,result:RESULT,now:TIME,...patch});

test('提示词保存失败保留原值，重试落盘成功后清除旧保存错误',async()=>{
  const h=await harness({failWrites:1}),before=h.disk;
  assert.equal(await h.callbacks.onSavePreferences({synthesisPrompt:'海洋世界。'}),false);
  assert.equal(h.disk.preferences.synthesisPrompt,'');assert.equal(h.controller.state.error,errorText(Error('STORAGE_ERROR')));
  assert.equal(await h.callbacks.onSavePreferences({synthesisPrompt:'海洋世界。'}),true);
  assert.equal(h.disk.preferences.synthesisPrompt,'海洋世界。');assert.equal(h.controller.state.error,'');
  assert.deepEqual(h.disk.cards,before.cards);assert.deepEqual(h.disk.recipes,before.recipes);assert.deepEqual(h.disk.stats,before.stats);
  assert.equal(h.calls.generate.length,0);assert.equal(h.calls.save.length,2);
});

test('提示词保存期间出现的新错误不会被成功响应清除',async()=>{
  for(const configureError of ['AUTH_FAILED','STORAGE_ERROR']){
    const gate=deferred(),entered=deferred();
    const h=await harness({failWrites:1,configureError,beforeSave:async()=>{entered.resolve();await gate.promise;}});
    await h.callbacks.onSavePreferences({synthesisPrompt:'海洋世界。'});
    const saving=h.callbacks.onSavePreferences({synthesisPrompt:'海洋世界。'});await entered.promise;
    await h.callbacks.onConfigure({key:'fixture'});
    assert.equal(h.controller.state.error,errorText(Error(configureError)));
    gate.resolve();assert.equal(await saving,true);
    assert.equal(h.disk.preferences.synthesisPrompt,'海洋世界。');assert.equal(h.controller.state.error,errorText(Error(configureError)));
  }
});

test('重开从待存记录恢复同一操作，只在玩家重试后保存且不请求模型',async()=>{
  const h=await harness({pending:journal(),configured:false,configStatusError:'KEY_UNAVAILABLE'}),before=h.disk;
  assert.equal(h.calls.generate.length,0);assert.equal(h.calls.save.length,0);assert.deepEqual(h.disk,before);
  assert.equal(h.controller.state.canRetrySave,true);assert.equal(h.controller.state.synthesis.id,'reopened-operation');
  assert.equal(h.controller.state.synthesis.phase,'save-failed');assert.equal(h.controller.state.lastResult,null);
  assert.match(h.controller.state.error,/上次的合成结果/);assert.equal(JSON.stringify(h.controller.state).includes(RESULT.description),false);
  await h.callbacks.onCombine(['base:water','base:fire']);assert.equal(h.calls.generate.length,0);
  await h.callbacks.onRetrySave();assert.equal(h.disk.stats.synthesisCount,1);assert.equal(h.calls.generate.length,0);
  assert.equal(h.disk.operations[0].id,'reopened-operation');assert.equal(h.controller.state.canRetrySave,false);
});

test('重开已提交记录不重复计数，也不重新显示或请求结果',async()=>{
  const initialSave=commitSynthesis(createNewSave({id:'controller-save',now:TIME}),journal()).save;
  const h=await harness({initialSave,pending:journal()});
  assert.equal(h.controller.state.canRetrySave,false);assert.equal(h.controller.state.error,'');assert.equal(h.controller.state.lastResult,null);
  await h.callbacks.onRetrySave();assert.equal(h.disk.stats.synthesisCount,1);assert.equal(h.calls.save.length,0);assert.equal(h.calls.generate.length,0);
});

test('残缺、异档、未知材料、冲突操作和非法时间的待存记录不套用且阻止再次付费',async()=>{
  const committed=commitSynthesis(createNewSave({id:'controller-save',now:TIME}),journal()).save;
  const cases=[journal({saveId:'another-save'}),journal({operationId:'bad operation'}),journal({ingredientIds:['base:metal','unknown']}),journal({now:'yesterday'}),journal({now:123}),journal({result:{...RESULT,key:'private-value'}}),{...journal(),extra:true},journal({result:null}),journal({ingredientIds:[]})];
  for(const pending of cases){
    const h=await harness({pending}),before=h.disk;assert.equal(h.controller.state.canRetrySave,false);assert.equal(h.controller.state.pendingBlocked,true);assert.ok(h.controller.state.error);
    await h.callbacks.onRetrySave();await h.callbacks.onCombine(INGREDIENTS);await h.callbacks.onSavePreferences({skinId:'sea'});
    assert.equal(h.calls.generate.length,0);assert.equal(h.calls.save.length,0);assert.deepEqual(h.disk,before);
  }
  const conflict=await harness({initialSave:committed,pending:journal({result:{...RESULT,name:'另一个结果'}})});
  assert.equal(conflict.controller.state.pendingBlocked,true);assert.equal(conflict.disk.stats.synthesisCount,1);
});

test('正式bridge生成接收同一个操作号，并用原生日志结果与时间提交',async()=>{
  let pending=null;
  const at='2026-10-26T10:01:00.000Z';
  const h=await harness({durablePending:true,loadPending:async()=>copy(pending),generate:async(ids,_,operationId)=>{
    pending=journal({operationId,ingredientIds:ids,now:at});return copy(RESULT);
  }});
  await h.callbacks.onCombine(INGREDIENTS);
  assert.equal(h.calls.operationId,h.disk.operations[0].id);assert.equal(h.disk.operations[0].completedAt,at);
  assert.equal(h.controller.state.synthesis.phase,'committed');assert.equal(h.calls.generate.length,1);
});

test('日志规范排序不拒绝反向材料顺序，也不丢掉重复材料',async()=>{
  let pending=null;const ids=['base:wood','base:metal','base:metal'];
  const h=await harness({durablePending:true,loadPending:async()=>copy(pending),generate:async(materials,_,operationId)=>{pending=journal({operationId,ingredientIds:[...materials].sort()});return copy(RESULT);}});
  await h.callbacks.onCombine(ids);assert.equal(h.controller.state.synthesis.phase,'committed');assert.equal(h.disk.stats.synthesisCount,1);assert.deepEqual(h.disk.recipes[0].ingredientIds,['base:metal','base:metal','base:wood']);
});

const MOD={modFormat:1,id:'test-mod',name:'测试工坊',version:'1',cards:[RESULT],recipes:[{ingredients:['金','木'],result:'工具'}],script:'registerMod({});'};
function modSave(){return toggleMod(installMod(createNewSave({id:'controller-save',now:TIME}),MOD,{now:TIME}),'test-mod',true,TIME);}

test('Mod本地结果先持久化再提交，来源与玩法状态同一次保存且不请求AI',async()=>{
  const staged=[],source={kind:'mod',modId:'test-mod',modName:'测试工坊'};let pending=null;
  const h=await harness({initialSave:modSave(),configured:false,durablePending:true,loadPending:async()=>copy(pending),
    modRuntime:{async resolve(){return {result:RESULT,source,modStates:[{id:'test-mod',state:{turns:1}}]};},async process(){assert.fail('resolve已处理过，不重复跑脚本');}},
    platform:{async stageModResult(operation){staged.push(copy(operation));pending=journal({...operation,modProcessed:true});return copy(pending);}}});
  await h.callbacks.onCombine(INGREDIENTS);assert.equal(h.calls.generate.length,0);assert.equal(staged.length,1);assert.equal(h.disk.stats.synthesisCount,1);assert.equal(h.disk.mods[0].state.turns,1);assert.deepEqual(h.disk.operations[0].source,source);
});

test('AI答案后的Mod失败保留原始待存结果，重试不重跑脚本或付费请求',async()=>{
  let pending=null,processed=0;
  const h=await harness({initialSave:modSave(),durablePending:true,loadPending:async()=>copy(pending),generate:async(ids,_,operationId)=>{pending=journal({operationId,ingredientIds:ids,source:{kind:'ai'}});return copy(RESULT);},
    modRuntime:{async resolve(){return null;},async process(){processed++;throw Error('MOD_SCRIPT_ERROR');}},platform:{async updatePending(operation){pending={...pending,...operation,modProcessed:true};return copy(pending);}}});
  await h.callbacks.onCombine(INGREDIENTS);assert.equal(h.controller.state.canRetrySave,true);assert.match(h.controller.state.error,/原始结果已保留/);assert.equal(h.disk.stats.synthesisCount,0);
  await h.callbacks.onRetrySave();assert.equal(h.disk.stats.synthesisCount,1);assert.equal(h.calls.generate.length,1);assert.equal(processed,1);assert.equal(h.disk.cards.at(-1).name,'工具');assert.deepEqual(h.disk.mods[0].state,{});
});

test('Mod resolve失败不偷偷转为AI；更新答案失败仍能保存原答案',async()=>{
  const failed=await harness({initialSave:modSave(),modRuntime:{async resolve(){throw Error('MOD_TIMEOUT');}}});
  await failed.callbacks.onCombine(INGREDIENTS);assert.equal(failed.calls.generate.length,0);assert.equal(failed.disk.stats.synthesisCount,0);assert.match(failed.controller.state.error,/Mod/);
  let pending=null,updates=0;
  const h=await harness({initialSave:modSave(),durablePending:true,loadPending:async()=>copy(pending),generate:async(ids,_,operationId)=>{pending=journal({operationId,ingredientIds:ids,source:{kind:'ai'}});return copy(RESULT);},
    modRuntime:{async resolve(){return null;},async process(){return {result:{...RESULT,name:'脚本结果'},source:{kind:'mod',modId:'test-mod',modName:'测试工坊'},modStates:[{id:'test-mod',state:{turns:1}}]};}},
    platform:{async updatePending(operation){if(++updates===1)throw Error('STORAGE_ERROR');pending={...pending,...operation,modProcessed:true};return copy(pending);}}});
  await h.callbacks.onCombine(INGREDIENTS);await h.callbacks.onRetrySave();assert.equal(h.disk.cards.at(-1).name,'工具');assert.deepEqual(h.disk.mods[0].state,{});assert.equal(h.calls.generate.length,1);
});

test('缓存配方的Mod后续状态同一次提交，仍不请求AI',async()=>{
  const initialSave=commitSynthesis(modSave(),{operationId:'initial-op',ingredientIds:INGREDIENTS,result:RESULT,now:TIME}).save;let pending=null,processed=0;
  const h=await harness({initialSave,configured:false,durablePending:true,loadPending:async()=>copy(pending),
    modRuntime:{async resolve(){assert.fail('缓存不走resolve');},async process(_save,_ids,result,context){processed++;assert.equal(context.cached,true);assert.deepEqual(context.source,{kind:'recipe'});return {result,source:context.source,modStates:[{id:'test-mod',state:{turns:2}}]};}},
    platform:{async stageModResult(operation){pending=journal({...operation,modProcessed:true});return copy(pending);}}});
  await h.callbacks.onCombine(INGREDIENTS);assert.equal(h.calls.generate.length,0);assert.equal(h.disk.stats.synthesisCount,2);assert.equal(h.disk.mods[0].state.turns,2);assert.equal(processed,1);assert.deepEqual(h.disk.operations.at(-1).source,{kind:'recipe'});
});

test('重开raw待存只补一次Mod处理，processed待存直接继续保存不重跑脚本',async()=>{
  for(const processed of [false,true]){
    let pending=journal({modProcessed:processed,source:{kind:'ai'},modStates:processed?[{id:'test-mod',state:{turns:1}}]:[]}),runs=0,updates=0;
    const h=await harness({initialSave:modSave(),durablePending:true,loadPending:async()=>copy(pending),
      modRuntime:{async process(_save,_ids,result,context){runs++;return {result,source:context.source,modStates:[{id:'test-mod',state:{turns:1}}]};}},
      platform:{async updatePending(operation){updates++;pending={...pending,...operation,modProcessed:true};return copy(pending);}}});
    assert.equal(runs,processed?0:1);assert.equal(updates,processed?0:1);assert.equal(h.calls.generate.length,0);assert.equal(h.disk.stats.synthesisCount,0);assert.equal(h.controller.state.canRetrySave,true);
    await h.callbacks.onRetrySave();assert.equal(h.disk.stats.synthesisCount,1);assert.equal(h.disk.mods[0].state.turns,1);assert.equal(runs,processed?0:1);assert.equal(h.calls.generate.length,0);
  }
});

test('重开raw处理失败时不自动保存，只有明确重试才标记跳过并保存原答案',async()=>{
  let pending=journal({modProcessed:false,source:{kind:'ai'},modStates:[]}),updates=0,runs=0;
  const h=await harness({initialSave:modSave(),durablePending:true,loadPending:async()=>copy(pending),
    modRuntime:{async process(){runs++;throw Error('MOD_SCRIPT_FAILED');}},platform:{async updatePending(operation){updates++;pending={...pending,...operation,modProcessed:true};return copy(pending);}}});
  assert.equal(updates,0);assert.equal(h.calls.save.length,0);assert.match(h.controller.state.error,/原始结果/);assert.equal(h.controller.state.canRetrySave,true);
  await h.callbacks.onRetrySave();assert.equal(updates,1);assert.equal(runs,1);assert.equal(h.disk.stats.synthesisCount,1);assert.deepEqual(h.disk.mods[0].state,{});assert.equal(h.calls.generate.length,0);
});

test('Mod安装默认停用，显式启用和玩法操作保存内容而不伪造合成次数',async()=>{
  const h=await harness({platform:{async chooseModFile(){return JSON.stringify({...MOD,actions:[{id:'gift',name:'礼物'}]});}},
    modRuntime:{async action(){return {cards:[RESULT],state:{gift:true},message:'已获得礼物。'};}}});
  await h.callbacks.onChooseMod();assert.equal(h.disk.mods.length,0);assert.equal(h.controller.state.modCandidate.id,'test-mod');
  await h.callbacks.onInstallMod();assert.equal(h.disk.mods[0].enabled,false);assert.equal(h.disk.stats.synthesisCount,0);
  await h.callbacks.onToggleMod('test-mod',true);await h.callbacks.onModAction('test-mod','gift');assert.equal(h.disk.mods[0].state.gift,true);assert.equal(h.disk.cards.length,6);assert.equal(h.disk.stats.synthesisCount,0);
  await h.callbacks.onRemoveMod('test-mod');assert.equal(h.disk.mods.length,0);assert.equal(h.disk.cards.length,6);assert.equal(h.disk.stats.synthesisCount,0);
});

test('收到答案但原生日志缺失或不匹配时不再次自动请求，不把未经持久化的结果报成功',async()=>{
  for(const returned of [null,journal({operationId:'different-operation'})]){
    let calls=0;const h=await harness({durablePending:true,loadPending:async()=>++calls===1?null:returned});
    await h.callbacks.onCombine(INGREDIENTS);assert.equal(h.controller.state.pendingBlocked,true);assert.equal(h.controller.state.lastResult,null);
    await h.callbacks.onCombine(INGREDIENTS);assert.equal(h.calls.generate.length,1);assert.equal(h.calls.save.length,0);assert.equal(h.disk.stats.synthesisCount,0);
  }
});

test('取消恰逢原生答案已落盘时接回待保存结果，迟到响应不重复计数',async()=>{
  const response=deferred();let pending=null;
  const h=await harness({durablePending:true,loadPending:async()=>copy(pending),generate:async(ids,_,operationId)=>{
    pending=journal({operationId,ingredientIds:ids});return response.promise;
  }});
  const request=h.callbacks.onCombine(INGREDIENTS),operationId=h.controller.state.synthesis.id;
  await h.callbacks.onCancel();assert.equal(h.controller.state.canRetrySave,true);assert.equal(h.controller.state.synthesis.id,operationId);assert.equal(h.controller.state.synthesis.phase,'save-failed');
  response.resolve(copy(RESULT));await request;assert.equal(h.calls.save.length,0);
  await h.callbacks.onRetrySave();assert.equal(h.disk.stats.synthesisCount,1);assert.equal(h.calls.generate.length,1);
});

test('原生提示尚有待存结果时恢复原操作，不把新材料写入旧答案',async()=>{
  let pending=null;
  const h=await harness({durablePending:true,loadPending:async()=>copy(pending),generate:async()=>{
    pending=journal();throw Error('PENDING_SAVE_REQUIRED');
  }});
  await h.callbacks.onCombine(['base:water','base:fire']);
  assert.equal(h.controller.state.synthesis.id,'reopened-operation');assert.deepEqual(h.controller.state.synthesis.ingredientIds,INGREDIENTS);assert.equal(h.controller.state.canRetrySave,true);
  await h.callbacks.onRetrySave();assert.equal(h.disk.operations[0].id,'reopened-operation');assert.deepEqual(h.disk.recipes[0].ingredientIds,INGREDIENTS);assert.equal(h.calls.generate.length,1);
});

test('坏库启动不新建覆盖，仍可导入合法备份恢复且失败不清理旧数据',async()=>{
  const incoming=createNewSave({id:'recovered-save',now:TIME});
  const h=await harness({loadError:'STORAGE_CORRUPT',importText:serializeSave(incoming)});
  assert.equal(h.controller.state.save,null);assert.equal(h.controller.state.recoveryRequired,true);assert.equal(h.calls.initialize,0);
  await h.callbacks.onImport();assert.equal(h.controller.state.save.id,incoming.id);assert.equal(h.controller.state.recoveryRequired,false);assert.equal(h.calls.initialize,0);
  const failed=await harness({loadError:'STORAGE_CORRUPT',importText:'broken'}),before=failed.disk;
  await failed.callbacks.onImport();assert.deepEqual(failed.disk,before);assert.equal(failed.controller.state.recoveryRequired,true);assert.equal(failed.calls.imports.length,0);
});

test('本机备份仅接受已列出的记录，恢复成功后刷新档案视图',async()=>{
  const save=createNewSave({id:'restored-backup',now:TIME}),restores=[];
  const h=await harness({loadError:'STORAGE_CORRUPT',backups:[{id:'safe-backup',createdAt:TIME,cardCount:5,recipeCount:0}],restoreBackup:async id=>{restores.push(id);return copy(save);}});
  await h.callbacks.onListBackups();await h.callbacks.onRestoreBackup('invented-id');assert.deepEqual(restores,[]);
  await h.callbacks.onRestoreBackup('safe-backup');assert.deepEqual(restores,['safe-backup']);assert.equal(h.controller.state.save.id,save.id);assert.equal(h.controller.state.recoveryRequired,false);assert.equal(h.controller.state.saveEpoch,1);
});

test('慢请求和慢保存使用同一操作ID，提交前不向动画发布结果',async()=>{
  const answer=deferred(),entered=deferred(),release=deferred();
  const h=await harness({generate:()=>answer.promise,beforeSave:async()=>{entered.resolve();await release.promise;}}),before=h.disk;
  const selected=['base:metal','base:metal','base:wood'];
  const request=h.callbacks.onCombine(selected),id=h.controller.state.synthesis.id;
  selected.splice(0,selected.length,'base:water','base:fire');
  assert.deepEqual(h.controller.state.synthesis,{id,ingredientIds:['base:metal','base:metal','base:wood'],source:'ai',phase:'requesting'});
  assert.equal(h.controller.state.lastResult,null);assert.equal(h.calls.save.length,0);assert.deepEqual(h.disk,before);
  await Promise.resolve();await Promise.resolve();
  assert.equal(h.controller.state.synthesis.phase,'requesting','没有响应就不能按经过时间自动揭晓');
  answer.resolve(copy(RESULT));await entered.promise;
  assert.equal(h.controller.state.synthesis.id,id);assert.equal(h.controller.state.synthesis.phase,'saving');
  assert.equal(h.controller.state.lastResult,null);assert.deepEqual(h.disk,before);
  assert.deepEqual(Object.keys(h.controller.state.synthesis).sort(),['id','ingredientIds','phase','source'],'未保存答案不能出现在动画状态中');
  release.resolve();await request;
  assert.equal(h.controller.state.synthesis.phase,'committed');assert.equal(h.controller.state.lastResult.operationId,id);
  assert.equal(h.disk.operations[0].id,id);assert.equal(h.disk.stats.synthesisCount,1);
  assert.deepEqual(phasesFor(h.renders,id),['requesting','saving','committed']);
  assert.ok(h.renders.filter(s=>s.lastResult).every(s=>s.synthesis.phase==='committed'&&s.save.stats.synthesisCount===1));
});

test('待保存失败和延迟重试保留操作ID及材料，不再次生成',async()=>{
  const entered=deferred(),release=deferred();
  const h=await harness({failWrites:1,beforeSave:async()=>{entered.resolve();await release.promise;}}),before=h.disk;
  await h.callbacks.onCombine(INGREDIENTS);
  const id=h.controller.state.synthesis.id;
  assert.equal(h.controller.state.synthesis.phase,'save-failed');assert.deepEqual(h.controller.state.synthesis.ingredientIds,INGREDIENTS);
  assert.equal(h.controller.state.lastResult,null);assert.equal(h.controller.state.canRetrySave,true);assert.deepEqual(h.disk,before);
  const retry=h.callbacks.onRetrySave(),duplicate=h.callbacks.onRetrySave();await entered.promise;
  assert.equal(h.controller.state.synthesis.id,id);assert.equal(h.controller.state.synthesis.phase,'saving');
  assert.equal(h.controller.state.lastResult,null);assert.equal(h.calls.generate.length,1);assert.equal(h.calls.save.length,2);
  release.resolve();await Promise.all([retry,duplicate]);
  assert.equal(h.controller.state.synthesis.phase,'committed');assert.equal(h.controller.state.lastResult.operationId,id);
  assert.equal(h.disk.stats.synthesisCount,1);assert.equal(h.calls.generate.length,1);
  assert.deepEqual(phasesFor(h.renders,id),['requesting','saving','save-failed','saving','committed']);
});

test('缓存配方直接保存，不出现模型等待阶段，仍发布独立的已提交操作',async()=>{
  const entered=deferred(),release=deferred();
  const h=await harness({beforeSave:async(_,index)=>{if(index===2){entered.resolve();await release.promise;}}});
  await h.callbacks.onCombine(INGREDIENTS);const firstId=h.controller.state.lastResult.operationId;
  const request=h.callbacks.onCombine(INGREDIENTS.toReversed()),id=h.controller.state.synthesis.id;
  await entered.promise;
  assert.notEqual(id,firstId);assert.equal(h.controller.state.synthesis.source,'cache');assert.equal(h.controller.state.synthesis.phase,'saving');
  assert.equal(h.calls.generate.length,1);assert.equal(h.controller.state.lastResult,null);assert.equal(h.disk.stats.synthesisCount,1);
  release.resolve();await request;
  assert.deepEqual(phasesFor(h.renders,id),['saving','committed']);assert.equal(h.controller.state.lastResult.operationId,id);
  assert.equal(h.disk.stats.synthesisCount,2);assert.equal(h.calls.generate.length,1);
});

test('请求超时或坏格式进入failed并保留材料，不提交也不发布成功结果',async()=>{
  for(const generate of [async()=>{throw Error('AI_TIMEOUT');},async()=>({name:'缺少必要字段'})]){
    const h=await harness({generate}),before=h.disk;
    await h.callbacks.onCombine(INGREDIENTS);const synthesis=h.controller.state.synthesis;
    assert.equal(synthesis.phase,'failed');assert.deepEqual(synthesis.ingredientIds,INGREDIENTS);assert.equal(synthesis.source,'ai');
    assert.equal(h.controller.state.lastResult,null);assert.equal(h.controller.state.canRetrySave,false);assert.equal(h.controller.state.busy,false);
    assert.equal(h.calls.save.length,0);assert.deepEqual(h.disk,before);assert.deepEqual(phasesFor(h.renders,synthesis.id),['requesting','failed']);
  }
});

test('取消同步终止合成阶段，不等待原生取消返回，迟到成功不能改写阶段',async()=>{
  const answer=deferred(),cancelled=deferred(),h=await harness({generate:()=>answer.promise,cancel:()=>cancelled.promise}),before=h.disk;
  const request=h.callbacks.onCombine(INGREDIENTS),id=h.controller.state.synthesis.id;
  const cancellation=h.callbacks.onCancel();
  assert.equal(h.controller.state.busy,'cancel');assert.equal(h.controller.state.synthesis.phase,'cancelled');assert.equal(h.controller.state.synthesis.id,id);
  answer.resolve(copy(RESULT));await request;
  assert.equal(h.controller.state.busy,'cancel');assert.equal(h.controller.state.synthesis.phase,'cancelled');assert.equal(h.calls.save.length,0);
  cancelled.resolve();await cancellation;
  assert.equal(h.controller.state.lastResult,null);assert.deepEqual(h.disk,before);assert.equal(h.controller.state.busy,false);
  assert.deepEqual(phasesFor(h.renders,id),['requesting','cancelled']);
});

test('取消配置不能把先前待保存的合成改成cancelled，随后仍可重试原结果',async()=>{
  const answer=deferred(),h=await harness({failWrites:1,configure:()=>answer.promise});
  await h.callbacks.onCombine(INGREDIENTS);const synthesis=copy(h.controller.state.synthesis);
  const configuration=h.callbacks.onConfigure({baseUrl:'https://example.invalid',model:'fixture',key:'local-fixture'});
  await h.callbacks.onCancel();assert.deepEqual(h.controller.state.synthesis,synthesis);
  answer.resolve({configured:true,model:'late-fixture'});await configuration;
  assert.deepEqual(h.controller.state.synthesis,synthesis);assert.equal(h.controller.state.lastResult,null);
  await h.callbacks.onRetrySave();assert.equal(h.controller.state.synthesis.phase,'committed');assert.equal(h.controller.state.lastResult.operationId,synthesis.id);
  assert.equal(h.calls.generate.length,1);assert.equal(h.disk.stats.synthesisCount,1);
});

test('导入成功清空旧合成状态和揭晓结果',async()=>{
  const incoming=createNewSave({id:'imported-world',now:TIME}),h=await harness({importText:serializeSave(incoming)});
  await h.callbacks.onCombine(INGREDIENTS);assert.equal(h.controller.state.synthesis.phase,'committed');assert.equal(h.controller.state.saveEpoch,0);
  await h.callbacks.onImport();assert.equal(h.controller.state.save.id,'imported-world');assert.equal(h.controller.state.synthesis,null);assert.equal(h.controller.state.lastResult,null);assert.equal(h.controller.state.saveEpoch,1);
});

test('配置检测成功或失败都不改变五本源新档和合成统计',async()=>{
  for(const configureError of [undefined,'AUTH_FAILED']){
    const h=await harness({configured:false,configureError}),before=h.disk;
    const config={baseUrl:'https://example.invalid',model:'fixture',key:'local-fixture'};
    await h.callbacks.onConfigure(config);
    assert.deepEqual(h.disk,before);assert.equal(h.calls.save.length,0);assert.equal(h.calls.generate.length,0);
    assert.equal(h.controller.state.save.cards.length,5);assert.equal(h.controller.state.save.recipes.length,0);assert.equal(h.controller.state.save.stats.synthesisCount,0);
    assert.equal(config.key,'');assert.equal(h.controller.state.configStatus.configured,!configureError);
    assert.equal(h.controller.state.busy,false);
  }
});

test('取消配置后迟到的成功或失败不能覆盖取消状态，也不能结束新的配置检测',async()=>{
  for(const lateSuccess of [true,false])for(const startNew of [false,true]){
    const oldAnswer=deferred(),newAnswer=deferred();
    const h=await harness({configured:false,configure:(_,index)=>index===1?oldAnswer.promise:newAnswer.promise});
    const oldConfig={baseUrl:'https://old.example.invalid',model:'old-fixture',key:'local-fixture'};
    const oldRequest=h.callbacks.onConfigure(oldConfig);
    await h.callbacks.onCancel();
    const newRequest=startNew?h.callbacks.onConfigure({baseUrl:'https://new.example.invalid',model:'new-fixture',key:'local-fixture'}):null;
    const stateBeforeLate=copy(h.controller.state),diskBeforeLate=h.disk;
    if(lateSuccess)oldAnswer.resolve({configured:true,baseUrl:oldConfig.baseUrl,model:oldConfig.model});
    else oldAnswer.reject(Error('AI_ACCESS_DENIED'));
    await oldRequest;
    assert.deepEqual(h.controller.state,stateBeforeLate,'旧检测的成功、错误及结束回调均不能改变当前状态');
    assert.deepEqual(h.disk,diskBeforeLate);assert.equal(h.calls.save.length,0);assert.equal(oldConfig.key,'');
    if(startNew){
      newAnswer.resolve({configured:true,baseUrl:'https://new.example.invalid',model:'new-fixture'});await newRequest;
      assert.equal(h.controller.state.configStatus.model,'new-fixture');assert.equal(h.controller.state.busy,false);assert.equal(h.controller.state.error,'');
    }
  }
});

test('合成结果正在写入时取消无效，保存仍只提交一次并正常显示结果',async()=>{
  const entered=deferred(),release=deferred();
  const h=await harness({beforeSave:async()=>{entered.resolve();await release.promise;}}),before=h.disk;
  const request=h.callbacks.onCombine(INGREDIENTS);
  await entered.promise;
  assert.equal(h.controller.state.busy,'save');
  const stateBeforeCancel=copy(h.controller.state);
  await h.callbacks.onCancel();
  assert.equal(h.calls.cancel,0,'已经开始写入的结果不能通过取消AI接口中断');
  assert.deepEqual(h.controller.state,stateBeforeCancel);assert.deepEqual(h.disk,before);
  release.resolve();await request;
  assert.equal(h.calls.save.length,1);assert.equal(h.calls.generate.length,1);assert.equal(h.disk.stats.synthesisCount,1);
  assert.equal(h.controller.state.lastResult.card.name,'工具');assert.equal(h.controller.state.busy,false);assert.equal(h.controller.state.error,'');
});

test('启动时凭据读取失败仍显示已经读取的原档，不初始化或覆盖进度',async()=>{
  const initialSave=createNewSave({id:'returning-player-save',now:TIME});
  initialSave.preferences.skinId='dawn';
  initialSave.layout=[{id:'table:kept',cardId:'base:water',x:81,y:-24,pinned:true}];
  const h=await harness({initialSave,configStatusError:'KEY_UNAVAILABLE'});
  assert.deepEqual(h.controller.state.save,initialSave);assert.deepEqual(h.disk,initialSave);
  assert.equal(h.calls.initialize,0);assert.equal(h.calls.save.length,0);assert.equal(h.calls.generate.length,0);
  assert.equal(h.controller.state.configStatus.configured,false);assert.equal(h.controller.state.busy,false);
  assert.match(h.controller.state.error,/Key/);assert.match(h.controller.state.error,/重新配置/);
});

test('原生超时与存储错误显示对应的可读说明，不把底层诊断内容带入界面',()=>{
  const cases=[
    ['AI_TIMEOUT',/超时/],
    ['AI_ACCESS_DENIED',/Key.*权限/],
    ['STORAGE_DATABASE_ERROR',/保存.*空间/],
    ['STORAGE_FILE_ERROR',/保存.*空间/],
    ['STORAGE_REVISION_CONFLICT:3:4',/存档.*变化/],
    ['STORAGE_INVALID_CARDS',/存档.*损坏/],
    ['STORAGE_UNSUPPORTED_VERSION',/格式版本.*不支持/],
  ];
  for(const [code,meaning] of cases){
    // Tauri可能拒绝字符串；本地调用也可能传入Error或带code的对象。
    for(const error of [`${code}: PRIVATE_DIAGNOSTIC`,Error(`${code}: PRIVATE_DIAGNOSTIC`),{code,message:'PRIVATE_DIAGNOSTIC'}]){
      const message=errorText(error);
      assert.match(message,meaning,code);assert.doesNotMatch(message,/PRIVATE_DIAGNOSTIC|AI_|STORAGE_/);
    }
  }
});

test('生成成功但保存失败时保留结果，重试保存不再次调用AI',async()=>{
  const h=await harness({failWrites:1}),before=h.disk;
  await h.callbacks.onCombine(INGREDIENTS);
  assert.equal(h.calls.generate.length,1);assert.deepEqual(h.disk,before);
  assert.equal(h.controller.state.canRetrySave,true);assert.equal(h.controller.state.lastResult,null);assert.equal(h.controller.state.save.stats.synthesisCount,0);
  await h.callbacks.onCombine(['base:fire','base:water']);
  assert.equal(h.calls.generate.length,1,'待保存结果不能被另一次合成替换');
  // 保存失败之后修改外观，再重试必须保留最新偏好。
  await h.callbacks.onSavePreferences({skinId:'sea'});
  await h.callbacks.onRetrySave();
  assert.equal(h.calls.generate.length,1);assert.equal(h.disk.stats.synthesisCount,1);assert.equal(h.disk.cards.length,6);assert.equal(h.disk.preferences.skinId,'sea');
  assert.equal(h.controller.state.canRetrySave,false);assert.equal(h.controller.state.lastResult.card.name,'工具');assert.equal(h.controller.state.error,'');
});

test('连续点击重试保存只提交一次，成功后不能被第二个回调改成失败',async()=>{
  const h=await harness({failWrites:1});await h.callbacks.onCombine(INGREDIENTS);
  await Promise.all([h.callbacks.onRetrySave(),h.callbacks.onRetrySave()]);
  assert.equal(h.calls.generate.length,1);assert.equal(h.calls.save.length,2);assert.equal(h.disk.stats.synthesisCount,1);
  assert.equal(h.controller.state.canRetrySave,false);assert.equal(h.controller.state.error,'');assert.equal(h.controller.state.busy,false);
});

test('AI等待期间的外观和台面保存与结果串行提交，不互相覆盖',async()=>{
  const answer=deferred(),h=await harness({generate:()=>answer.promise});
  const synthesis=h.callbacks.onCombine(INGREDIENTS);
  const layout=[{id:'table:one',cardId:'base:metal',x:42,y:-18,pinned:false}];
  await Promise.all([h.callbacks.onSavePreferences({skinId:'dawn'}),h.callbacks.onSaveLayout(layout)]);
  assert.equal(h.disk.revision,2);assert.equal(h.disk.stats.synthesisCount,0);
  answer.resolve(copy(RESULT));await synthesis;
  assert.equal(h.disk.revision,3);assert.equal(h.disk.stats.synthesisCount,1);assert.equal(h.disk.preferences.skinId,'dawn');assert.deepEqual(h.disk.layout,layout);
  assert.deepEqual(h.calls.save.map(c=>c.expectedRevision),[0,1,2]);
});

test('连续点击合成只发一次请求；缓存配方再次合成不发请求但增加一次统计',async()=>{
  const answer=deferred(),h=await harness({generate:()=>answer.promise});
  const first=h.callbacks.onCombine(INGREDIENTS),duplicate=h.callbacks.onCombine(INGREDIENTS);
  assert.equal(h.calls.generate.length,1);answer.resolve(copy(RESULT));await Promise.all([first,duplicate]);
  assert.equal(h.disk.stats.synthesisCount,1);
  await h.callbacks.onCombine(INGREDIENTS.toReversed());
  assert.equal(h.calls.generate.length,1);assert.equal(h.disk.stats.synthesisCount,2);assert.equal(h.disk.cards.length,6);assert.equal(h.disk.recipes.length,1);
});

test('取消后的迟到成功响应不入库，也不增加计数',async()=>{
  const answer=deferred(),h=await harness({generate:()=>answer.promise}),before=h.disk;
  const request=h.callbacks.onCombine(INGREDIENTS);await h.callbacks.onCancel();const cancelledMessage=h.controller.state.error;
  answer.resolve(copy(RESULT));await request;
  assert.equal(h.calls.cancel,1);assert.deepEqual(h.disk,before);assert.equal(h.calls.save.length,0);assert.equal(h.controller.state.error,cancelledMessage);assert.equal(h.controller.state.busy,false);
});

test('取消后的迟到坏格式响应不覆盖已取消状态',async()=>{
  const answer=deferred(),h=await harness({generate:()=>answer.promise}),before=h.disk;
  const request=h.callbacks.onCombine(INGREDIENTS);await h.callbacks.onCancel();const cancelledMessage=h.controller.state.error;
  answer.resolve({name:'缺少必要字段'});await request;
  assert.deepEqual(h.disk,before);assert.equal(h.controller.state.error,cancelledMessage);assert.equal(h.calls.save.length,0);
});

test('取消旧请求后开始新请求，旧请求迟到报错不得污染当前操作',async()=>{
  const oldAnswer=deferred(),newAnswer=deferred(),h=await harness({generate:(_,index)=>index===1?oldAnswer.promise:newAnswer.promise});
  const oldRequest=h.callbacks.onCombine(INGREDIENTS),oldId=h.controller.state.synthesis.id;await h.callbacks.onCancel();
  assert.equal(h.controller.state.synthesis.phase,'cancelled');
  const newRequest=h.callbacks.onCombine(['base:water','base:fire']);
  const newSynthesis=copy(h.controller.state.synthesis);assert.notEqual(newSynthesis.id,oldId);
  oldAnswer.reject(Error('AUTH_FAILED'));await oldRequest;
  assert.equal(h.controller.state.busy,'combine');assert.equal(h.controller.state.error,'');assert.equal(h.disk.stats.synthesisCount,0);
  assert.deepEqual(h.controller.state.synthesis,newSynthesis);assert.equal(newSynthesis.phase,'requesting');
  newAnswer.resolve({name:'蒸汽',emoji:'☁️',category:'自然',description:'水被热意托起。'});await newRequest;
  assert.equal(h.disk.stats.synthesisCount,1);assert.equal(h.disk.cards.at(-1).name,'蒸汽');
  assert.equal(h.controller.state.synthesis.phase,'committed');assert.equal(h.controller.state.lastResult.operationId,newSynthesis.id);
});

test('导入损坏档案和原生导入失败均不修改当前档案',async()=>{
  const incoming=createNewSave({id:'other-device',now:TIME});incoming.preferences.tabletopId='deep';
  for(const options of [{importText:'{broken'},{importText:serializeSave(incoming),importError:'STORAGE_ERROR'}]){
    const h=await harness(options),before=h.disk;await h.callbacks.onImport();
    assert.deepEqual(h.disk,before);assert.deepEqual(h.controller.state.save,before);assert.ok(h.controller.state.error);assert.equal(h.controller.state.busy,false);
  }
});

test('导入取消或拒绝切换保留原档，不调用原生导入',async()=>{
  const incoming=serializeSave(createNewSave({id:'other-device',now:TIME}));
  for(const options of [{importText:null},{importText:incoming,confirmImport:()=>false}]){
    const h=await harness(options),before=h.disk;await h.callbacks.onImport();assert.deepEqual(h.disk,before);assert.equal(h.calls.imports.length,0);assert.equal(h.controller.state.busy,false);
  }
});

test('文件选择期间互斥，导出等待已排队写入完成后才报告成功',async()=>{
  const entered=deferred(),write=deferred(),file=deferred();let exported;
  const h=await harness({beforeSave:async()=>{entered.resolve();await write.promise;},exportSave:async snapshot=>{exported=snapshot;return file.promise;}});
  const preference=h.callbacks.onSavePreferences({skinId:'sea'});await entered.promise;
  const task=h.callbacks.onExport();assert.equal(h.controller.state.busy,'export');
  await h.callbacks.onExport();await h.callbacks.onImport();await h.callbacks.onCombine(INGREDIENTS);await h.callbacks.onSavePreferences({skinId:'hearth'});
  assert.equal(h.calls.export,0);assert.equal(h.calls.readImport,0);assert.equal(h.calls.generate.length,0);
  write.resolve();await preference;await Promise.resolve();await Promise.resolve();
  assert.equal(h.calls.export,1);assert.equal(exported.preferences.skinId,'sea');assert.equal(exported.revision,1);
  assert.equal(h.controller.state.fileFeedback,null,'文件尚未写完时不能报成功');
  file.resolve(true);await task;
  assert.deepEqual(h.controller.state.fileFeedback,{action:'export',kind:'success',message:'存档已导出。'});assert.equal(h.controller.state.busy,false);
});

test('导出取消、写入失败及异常返回均不假报成功，不改变存档',async()=>{
  for(const [result,kind] of [[false,'cancelled'],['throw','error'],[undefined,'error']]){
    const h=await harness({exportSave:async()=>{if(result==='throw')throw Error('FILE_WRITE_FAILED: private-detail');return result;}}),before=h.disk;
    await h.callbacks.onExport();assert.equal(h.controller.state.fileFeedback.kind,kind);assert.equal(h.controller.state.busy,false);assert.deepEqual(h.disk,before);
    assert.equal(h.controller.state.fileFeedback.message.includes('private-detail'),false);
    assert.equal(h.controller.state.error.length>0,kind==='error');
  }
});

test('导入选择和确认取消有明确反馈，选择期间不能开第二个窗口或改布局',async()=>{
  const file=deferred();const h=await harness({readImport:()=>file.promise}),before=h.disk;
  const task=h.callbacks.onImport();await Promise.resolve();
  assert.equal(h.controller.state.busy,'import');assert.equal(h.calls.readImport,1);
  await h.callbacks.onImport();await h.callbacks.onExport();await h.callbacks.onSaveLayout([{id:'new-layout',cardId:'base:metal',x:1,y:1,pinned:false}]);
  assert.equal(h.calls.readImport,1);assert.equal(h.calls.export,0);assert.equal(h.calls.save.length,0);
  file.resolve(null);await task;
  assert.equal(h.controller.state.fileFeedback.kind,'cancelled');assert.match(h.controller.state.fileFeedback.message,/当前进度未改变/);assert.deepEqual(h.disk,before);
  const declined=await harness({importText:serializeSave(before),confirmImport:()=>false});await declined.callbacks.onImport();
  assert.equal(declined.controller.state.fileFeedback.kind,'cancelled');assert.equal(declined.calls.imports.length,0);
});

test('导入成功反馈只在提交后出现；失败显示安全错误并保留当前存档',async()=>{
  const imported=createNewSave({id:'file-feedback-save',now:TIME});
  const h=await harness({importText:serializeSave(imported)});await h.callbacks.onImport();
  assert.equal(h.controller.state.save.id,imported.id);assert.equal(h.controller.state.fileFeedback.kind,'success');assert.match(h.controller.state.fileFeedback.message,/5 张卡牌，0 次合成/);
  const failed=await harness({importText:serializeSave(imported),importError:'STORAGE_ERROR: secret-file-path'}),before=failed.disk;
  await failed.callbacks.onImport();assert.equal(failed.controller.state.fileFeedback.kind,'error');assert.equal(failed.controller.state.fileFeedback.message.includes('secret-file-path'),false);assert.deepEqual(failed.disk,before);
});

test('待保存结果可导出已提交进度，但文件窗口期间不能并行重试保存',async()=>{
  const file=deferred();let exported;
  const h=await harness({failWrites:1,exportSave:async snapshot=>{exported=snapshot;return file.promise;}});await h.callbacks.onCombine(INGREDIENTS);
  const operationId=h.controller.state.synthesis.id,task=h.callbacks.onExport();await Promise.resolve();
  await h.callbacks.onRetrySave();await h.callbacks.onImport();assert.equal(h.calls.save.length,1);assert.equal(h.calls.readImport,0);assert.equal(h.calls.generate.length,1);
  assert.equal(exported.stats.synthesisCount,0);assert.equal(exported.cards.length,5);assert.equal(h.controller.state.canRetrySave,true);
  file.resolve(true);await task;await h.callbacks.onRetrySave();
  assert.equal(h.calls.generate.length,1);assert.equal(h.disk.stats.synthesisCount,1);assert.equal(h.controller.state.lastResult.operationId,operationId);
});

test('凭据丢失或未配置时，已有配方可本地合成，未知配方不能发送请求',async()=>{
  const source=await harness();await source.callbacks.onCombine(INGREDIENTS);
  for(const options of [{configured:false},{configStatusError:'KEY_UNAVAILABLE'}]){
    const h=await harness({...options,initialSave:source.disk});
    await h.callbacks.onCombine([...INGREDIENTS].reverse());
    assert.equal(h.calls.generate.length,0);assert.equal(h.disk.stats.synthesisCount,2);assert.equal(h.controller.state.synthesis.source,'cache');assert.equal(h.controller.state.synthesis.phase,'committed');
    const before=h.disk;await h.callbacks.onCombine(['base:water','base:fire']);
    assert.equal(h.calls.generate.length,0);assert.deepEqual(h.disk,before);assert.match(h.controller.state.error,/API Key/);
  }
  const fresh=await harness({configured:false}),before=fresh.disk;await fresh.callbacks.onCombine(INGREDIENTS);
  assert.equal(fresh.calls.generate.length,0);assert.deepEqual(fresh.disk,before);assert.equal(fresh.controller.state.synthesis,null);
});
