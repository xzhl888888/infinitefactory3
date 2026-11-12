import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../src/controller.js';
import {createNewSave,validateSave,serializeSave,commitSynthesis} from '../src/core/model.js';

const TIME='2026-10-27T10:00:00.000Z',copy=value=>structuredClone(value),RESULT={name:'工具',emoji:'🛠️',category:'科技',description:'帮助双手做事。'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function game(options={}){
  let active='a',sequence=0,pending=options.pending||null;
  const slots=new Map([['a',createNewSave({id:'world-a',now:TIME})],['b',createNewSave({id:'world-b',now:TIME})],['broken',null]]),names=new Map([['a','我的世界'],['b','第二世界'],['broken','损坏的存档']]);
  const calls={generate:0,switch:[],create:[],import:[],rename:[],writes:[],initialize:0,load:[]};
  const library=()=>({activeSlotId:active,slots:[...slots].map(([id,save])=>({id,name:names.get(id),saveId:save?.id??null,cardCount:save?.cards.length??0,recipeCount:save?.recipes.length??0,synthesisCount:save?.stats.synthesisCount??0,updatedAt:save?.updatedAt??null,modCount:save?.mods.length??0,available:!!save}))});
  const response=()=>({save:copy(slots.get(active)),library:library()});
  const platform={mode:'native',async libraryStatus(){if(options.badLibrary)throw Error('LIBRARY_CORRUPT');return library();},async load(){calls.load.push(active);if(!slots.get(active))throw Error('STORAGE_CORRUPT');return copy(slots.get(active));},async initialize(){calls.initialize++;assert.fail('已有库不得初始化');},async configStatus(){return {configured:true,model:'fixture'};},async loadPending(){return copy(pending);},
    async save(save,expectedRevision){const target=active;calls.writes.push({target,save:copy(save)});if(options.beforeSave)await options.beforeSave();assert.equal(active,target);assert.equal(slots.get(target).revision,expectedRevision);slots.set(target,validateSave(save));pending=null;return copy(slots.get(target));},
    async generate(){calls.generate++;if(options.generate)return options.generate();return RESULT;},async switchSlot(id){calls.switch.push(id);assert.equal(pending,null);active=id;return response();},
    async createSlot(name,save){calls.create.push(name);assert.equal(pending,null);active='created-'+(++sequence);names.set(active,name);slots.set(active,validateSave({...save,name}));return response();},
    async renameSlot(id,name){calls.rename.push({id,name});names.set(id,name);slots.set(id,validateSave({...slots.get(id),name,revision:slots.get(id).revision+1}));return response();},
    async readImport(){return options.importText??null;},async importAsSlot(name,save){calls.import.push(name);active='import-'+(++sequence);names.set(active,name);slots.set(active,validateSave({...save,id:'imported-identity-'+sequence,name}));return response();},
  };
  if(options.active)active=options.active;
  const controller=createController(platform,()=>{},{now:()=>TIME,uuid:()=>`new-identity-${++sequence}`,confirmImport:()=>options.confirmImport!==false});await controller.start();
  return {controller,c:controller.callbacks,calls,slots,get active(){return active;},get state(){return controller.state;}};
}

test('建新档只含五本源零配方，原档的发现和台面保留且切回可继续',async()=>{
  const h=await game();await h.c.onCombine(['base:metal','base:wood']);const first=copy(h.slots.get('a'));
  await h.c.onCreateSlot('新世界');assert.equal(h.state.save.cards.length,5);assert.equal(h.state.save.recipes.length,0);assert.equal(h.state.save.stats.synthesisCount,0);assert.equal(h.state.save.name,'新世界');assert.notEqual(h.state.save.id,first.id);assert.deepEqual(h.slots.get('a'),first);
  await h.c.onSwitchSlot('a');assert.equal(h.state.save.id,first.id);assert.equal(h.state.save.cards.length,6);assert.equal(h.state.lastResult,null);assert.equal(h.state.synthesis,null);assert.equal(h.state.saveEpoch,2);
});

test('切档等待已有布局写入，切换期间新布局请求不能写入另一个存档',async()=>{
  const entered=deferred(),release=deferred(),h=await game({beforeSave:async()=>{entered.resolve();await release.promise;}});
  const writing=h.c.onSavePreferences({skinId:'sea'});await entered.promise;
  const switching=h.c.onSwitchSlot('b');assert.equal(h.state.busy,'switch-slot');assert.deepEqual(h.calls.switch,[]);
  await h.c.onSaveLayout([{id:'late',cardId:'base:metal',x:0,y:0,pinned:false}]);release.resolve();await writing;await switching;
  assert.equal(h.slots.get('a').preferences.skinId,'sea');assert.equal(h.slots.get('b').preferences.skinId,'default');assert.equal(h.slots.get('b').layout.length,0);assert.equal(h.calls.writes.length,1);assert.equal(h.active,'b');
});

test('生成和有效待存期间禁止新建、切换、重命名与导入',async()=>{
  const answer=deferred(),h=await game({generate:()=>answer.promise});const generating=h.c.onCombine(['base:metal','base:wood']);
  await h.c.onSwitchSlot('b');await h.c.onCreateSlot('不应创建');await h.c.onRenameSlot('a','不应更名');await h.c.onImport();assert.deepEqual(h.calls.switch,[]);assert.deepEqual(h.calls.create,[]);assert.deepEqual(h.calls.rename,[]);assert.deepEqual(h.calls.import,[]);
  answer.resolve(RESULT);await generating;
  const pending={saveId:'world-a',operationId:'pending-one',ingredientIds:['base:metal','base:wood'],result:RESULT,now:TIME};const p=await game({pending});assert.equal(p.state.canRetrySave,true);
  await p.c.onSwitchSlot('b');await p.c.onCreateSlot('不应创建');await p.c.onRenameSlot('a','不应更名');await p.c.onImport();assert.deepEqual(p.calls.switch,[]);assert.deepEqual(p.calls.create,[]);assert.deepEqual(p.calls.rename,[]);assert.deepEqual(p.calls.import,[]);
});

test('导入新增独立槽与新档案身份，原存档不被覆盖',async()=>{
  const imported=commitSynthesis(createNewSave({id:'external-save',now:TIME}),{operationId:'external-op',ingredientIds:['base:metal','base:wood'],result:RESULT,now:TIME}).save;
  const h=await game({importText:serializeSave(imported)}),original=copy(h.slots.get('a'));
  await h.c.onImport();assert.equal(h.slots.size,4);assert.notEqual(h.state.save.id,imported.id);assert.equal(h.state.save.cards.length,6);assert.deepEqual(h.slots.get('a'),original);assert.equal(h.calls.import.length,1);assert.match(h.state.fileFeedback.message,/添加新存档/);
});

test('坏槽可进入恢复界面并切到健康槽，不初始化或覆盖坏槽',async()=>{
  const h=await game();await h.c.onSwitchSlot('broken');assert.equal(h.state.save,null);assert.equal(h.state.recoveryRequired,true);assert.equal(h.active,'broken');assert.equal(h.calls.initialize,0);
  await h.c.onSwitchSlot('b');assert.equal(h.state.save.id,'world-b');assert.equal(h.state.recoveryRequired,false);assert.equal(h.slots.get('broken'),null);
});

test('注册表损坏不继续猜测当前档案；无效名称不触发原生新建',async()=>{
  const broken=await game({badLibrary:true});assert.equal(broken.state.recoveryRequired,true);assert.deepEqual(broken.calls.load,[]);assert.equal(broken.calls.initialize,0);
  const h=await game();for(const name of ['', 'x'.repeat(41),'坏\n名'])await h.c.onCreateSlot(name);assert.deepEqual(h.calls.create,[]);assert.match(h.state.error,/存档名称/);
});

test('当前槽重命名采用原生返回revision，后续保存不会拿旧版本覆盖',async()=>{
  const h=await game();await h.c.onRenameSlot('a','新的世界名');assert.equal(h.state.save.name,'新的世界名');assert.equal(h.state.save.revision,1);
  await h.c.onSavePreferences({skinId:'sea'});assert.equal(h.slots.get('a').revision,2);assert.equal(h.slots.get('a').name,'新的世界名');assert.equal(h.state.error,'');
});
