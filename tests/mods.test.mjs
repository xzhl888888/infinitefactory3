import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createNewSave, installMod, toggleMod, removeMod, applyModAction, commitSynthesis, importSave, serializeSave } from '../src/core/model.js';
import { validateModPackage, validateModState, findModRecipe, listModAppearances, getModSound } from '../src/core/mods.js';
import { createModRuntime, modWorkerSource } from '../src/mods/runtime.js';
import { createCardPainter } from '../src/ui/card-art.js';
import { createModAudio } from '../src/mods/media.js';
const now='2026-10-27T10:00:00.000Z';
const example=JSON.parse(await readFile(new URL('../examples/mods/苔光花园.wxgc3-mod',import.meta.url),'utf8'));
const fresh=()=>createNewSave({id:'mods-test',now});
const enabled=()=>toggleMod(installMod(fresh(),example,{now}),example.id,true,now);
const ids=['base:water','base:earth'];
// VM 只执行仓库内固定夹具。另由 Electron 实际运行测试覆盖 Worker/CSP/超时隔离。
const runner=async(script,input)=>{
  let handler,result;const self={postMessage:value=>{result=value;},addEventListener:(_,fn)=>{handler=fn;}};
  const ctx=vm.createContext({self});Object.defineProperty(ctx,'registerMod',{get:()=>self.registerMod});
  vm.runInContext(modWorkerSource(script),ctx,{timeout:200});await handler({data:structuredClone(input)});
  if(!result?.ok) throw Error('fixture script failed');return structuredClone(result.value);
};
const runtime=()=>createModRuntime({run:runner});
test('Mod示例从安装到启用只加初始卡，不预解锁配方、不增加合成次数',()=>{
  const installed=installMod(fresh(),example,{now});assert.equal(installed.cards.length,5);assert.equal(installed.mods[0].enabled,false);
  const save=toggleMod(installed,example.id,true,now);assert.equal(save.cards.length,6);assert.equal(save.recipes.length,0);assert.equal(save.stats.synthesisCount,0);
  assert.equal(save.cards.at(-1).name,'种子');assert.equal(save.cards.at(-1).isBase,false);
  assert.equal(listModAppearances(save,'skins')[0].id,'mod/garden-workshop/skins/leaf');
  assert.ok(getModSound(save.mods,'discovery').startsWith('data:audio/wav;'));
});
test('固定配方区分重复材料，冲突启用拒绝且原档不变',()=>{
  const save=enabled();assert.equal(findModRecipe(save,ids.toReversed()).result.name,'幼苗');
  assert.equal(findModRecipe(save,['base:water','base:water']),null);
  const next=installMod(save,{...example,id:'garden-conflict'},{now});
  assert.throws(()=>toggleMod(next,'garden-conflict',true,now),e=>e.code==='MOD_RECIPE_CONFLICT');
  assert.equal(next.mods[1].enabled,false);
});
test('示例固定/脚本合成、状态与历史一并提交，缓存不重写既有答案',async()=>{
  const r=runtime(),save=enabled(),answer=await r.resolve(save,ids,'op:fixed');
  assert.equal(answer.result.name,'幼苗');assert.deepEqual(answer.modStates,[{id:example.id,state:{combinations:1}}]);
  const committed=commitSynthesis(save,{operationId:'op:fixed',ingredientIds:ids,...answer,now});
  assert.equal(committed.save.operations[0].source.modId,example.id);assert.equal(committed.save.stats.synthesisCount,1);
  const seed=save.cards.find(c=>c.name==='种子').id,script=await r.resolve(save,[seed,seed],'op:script');assert.equal(script.result.name,'双生芽');
  const cached=await r.process(committed.save,ids,committed.card,{cached:true,source:{kind:'recipe'},operationId:'op:cached'});
  assert.equal(cached.result.name,'幼苗');assert.equal(cached.modStates[0].state.combinations,2);assert.equal(cached.source.kind,'recipe');
  const garden=await r.resolve(committed.save,[committed.card.id,'base:wood'],'op:garden');assert.match(garden.result.description,/照料/);
});
test('玩法动作、停用、移除及跨设备整档分享保留已发现内容和历史来源',async()=>{
  const r=runtime();let save=enabled();const a=await r.resolve(save,ids,'op:share');save=commitSynthesis(save,{...a,ingredientIds:ids,operationId:'op:share',now}).save;
  const action=await r.action(save,example.id,'harvest');save=applyModAction(save,example.id,action,now);
  assert.equal(save.mods[0].state.visits,1);assert.equal(save.stats.synthesisCount,1);
  const exported=serializeSave(save);assert.deepEqual(importSave(exported),save);assert.ok(exported.includes('audio/wav'));
  const stopped=toggleMod(save,example.id,false,now);assert.equal(findModRecipe(stopped,ids),null);assert.equal(listModAppearances(stopped,'skins').length,0);
  const removed=removeMod(stopped,example.id,now);assert.equal(removed.cards.length,7);assert.equal(removed.recipes.length,1);assert.equal(removed.operations[0].source.modName,'苔光花园');
});
test('v1迁移保留进度，历史来源明确未知；未来版本拒绝',()=>{
  const save=commitSynthesis(fresh(),{operationId:'op:old',ingredientIds:ids,result:example.cards[1],now}).save;
  const old={...save,formatVersion:1};delete old.name;delete old.mods;delete old.operations[0].source;
  const text=JSON.stringify(old),upgraded=importSave(text);assert.equal(upgraded.formatVersion,2);assert.equal(upgraded.operations[0].source.kind,'unknown');assert.equal(upgraded.cards.length,6);
  assert.equal(JSON.parse(text).formatVersion,1);assert.throws(()=>importSave(JSON.stringify({...old,formatVersion:99})),e=>e.code==='UNSUPPORTED_SAVE_VERSION');
});
test('外链、SVG、伪造媒体、超大图和原型污染状态不会被导入',()=>{
  for(const bad of ['https://example.invalid/x.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,AAAA'])assert.throws(()=>validateModPackage({...example,assets:{...example.assets,cloth:bad}}));
  const png=Buffer.from(example.assets.cloth.split(',')[1],'base64');png.writeUInt32BE(99999,16);
  assert.throws(()=>validateModPackage({...example,assets:{...example.assets,cloth:'data:image/png;base64,'+png.toString('base64')}}),e=>e.code==='INVALID_MOD_ASSET');
  assert.throws(()=>validateModState(JSON.parse('{"__proto__":{"x":1}}')),e=>e.code==='INVALID_MOD_STATE');
  assert.throws(()=>validateModState({huge:'x'.repeat(65536)}),e=>e.code==='INVALID_MOD_STATE');
});
test('脚本只收到公开世界与自己状态；失败不修改输入、不会转AI',async()=>{
  const save=enabled(),before=serializeSave(save);let calls=0;
  const r=createModRuntime({run:async(_,input)=>{calls++;assert.deepEqual(Object.keys(input.context).sort(),['ingredients','operationId','result','state','world']);assert.equal(input.context.world.mods,undefined);throw Error('secret-like-error');}});
  await assert.rejects(()=>r.resolve(save,['base:metal','base:wood'],'op:fail'),e=>e.code==='MOD_SCRIPT_FAILED'&&!e.message.includes('secret'));
  assert.equal(calls,1);assert.equal(serializeSave(save),before);
});
test('缓存只跑afterCombine，transform不能改写已知配方',async()=>{
  const hooks=[];const r=createModRuntime({run:async(_,input)=>{hooks.push(input.hook);return{state:{n:1}};}});
  const answer=await r.process(enabled(),ids,example.cards[1],{cached:true,source:{kind:'recipe'}});
  assert.deepEqual(hooks,['afterCombine']);assert.equal(answer.result.name,'幼苗');
});
test('Mod皮肤与卡背走真实绘制入口，停用后退回原皮肤',()=>{
  let mods=enabled().mods.map(m=>({...m,manifest:{...m.manifest,skins:m.manifest.skins.map(s=>({...s,image:undefined})),cardBacks:m.manifest.cardBacks.map(s=>({...s,image:undefined}))}}));
  const fills=[],texts=[],gradient={addColorStop(){}};const ctx=new Proxy({fillStyle:'',globalAlpha:1,measureText:t=>({width:t.length*5}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,fill(){fills.push(this.fillStyle);},fillText(t){texts.push(t);}},{get:(o,k)=>o[k]??(()=>{})});
  const painter=createCardPainter(ctx,{getMods:()=>mods}),card=fresh().cards[0];
  painter.drawCard(0,0,84,108,card,{skinId:'mod/garden-workshop/skins/leaf'});assert.ok(fills.includes('#eff5e4'));assert.ok(texts.includes('金'));
  painter.drawBack(0,0,84,108,0,false,true,'mod/garden-workshop/cardBacks/garden');assert.ok(fills.includes('#244b40'));
  mods=mods.map(m=>({...m,enabled:false}));fills.length=0;painter.drawCard(0,0,84,108,card,{skinId:'mod/garden-workshop/skins/leaf'});assert.ok(!fills.includes('#eff5e4'));
});
test('音效解码中换档不会迟到播放，坏音频交回默认音效',async()=>{
  let done,starts=0;const context={decodeAudioData:()=>new Promise(r=>{done=r;}),createBufferSource:()=>({connect(){},start(){starts++;}}),createGain:()=>({gain:{},connect(){}})};
  const audio=createModAudio(),pending=audio.play(context,example.assets.chime);audio.clear();done({duration:.5,numberOfChannels:1});assert.equal(await pending,false);assert.equal(starts,0);
  assert.equal(await audio.play({decodeAudioData:async()=>{throw Error('bad');}},example.assets.chime),false);
});
