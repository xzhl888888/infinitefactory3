import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createNewSave, commitSynthesis, validateSave, installMod, toggleMod, removeMod, applyModAction } from '../../../src/core/model.js';
import { validateModPackage, validateMods, validateModState, validateModStates, validateSource } from '../../../src/core/mods.js';
import * as c from '../../../src/content/catalog.js';
import * as p from '../../../src/ai/prompt.js';
import { buildSynthesisMessages } from '../../../src/ai/protocol.js';

// 输入由正式JS模型构造，Java原生验证后的输出再回到正式JS模型核对；不复制一套预期存档。
const [mode, directory] = process.argv.slice(2);
const catalog={bases:c.BASE_CARDS,categories:c.CATEGORIES,limits:c.CARD_LIMITS,preferences:c.DEFAULT_PREFERENCES,appearance:c.APPEARANCE_IDS,ai:c.DEFAULT_AI_CONFIG,prompt:{default:p.DEFAULT_SYNTHESIS_PROMPT,outputRules:p.SYNTHESIS_OUTPUT_RULES,limit:p.SYNTHESIS_PROMPT_LIMIT}};
if(mode==='prepare'){
  const fresh=createNewSave({id:'android-contract',now:'2026-10-27T00:00:00.000Z'});
  const result={name:'青铜',emoji:'🔔',category:'科技',description:'两种本源凝成的合金。'};
  const pending={saveId:fresh.id,operationId:'op-first',ingredientIds:['base:metal','base:wood'],result,now:'2026-10-27T00:00:01.000Z',source:{kind:'ai'},modStates:[],modProcessed:true};
  const next=commitSynthesis(fresh,{...pending}).save;
  const repeated=commitSynthesis(next,{operationId:'op-known',ingredientIds:['base:wood','base:metal'],result:null,now:'2026-10-27T00:00:02.000Z'}).save;
  const dupPending={saveId:next.id,operationId:'op-duplicate',ingredientIds:['base:water','base:water','base:fire'],result:{...result,name:'青铜',description:'模型写出不同描述但同名仍复用原卡。'},now:'2026-10-27T00:00:03.000Z',source:{kind:'ai'},modStates:[],modProcessed:true};
  const dedup=commitSynthesis(next,{...dupPending}).save;
  const cases=[];
  const add=(label,save)=>{try{cases.push({label,save,expected:validateSave(save)});}catch(error){cases.push({label,save,error:error.code});}};
  add('five-bases-zero-recipes',fresh);add('first-synthesis',next);add('known-recipe',repeated);add('duplicate-materials-and-name',dedup);
  const emptyBoard=structuredClone(next);emptyBoard.layout=[];emptyBoard.preferences.layoutInitialized=true;add('empty-board-keeps-initialized-marker',emptyBoard);
  const legacyBoard=structuredClone(fresh);delete legacyBoard.preferences.layoutInitialized;add('legacy-empty-board-default-marker',legacyBoard);
  const legacyPrompt=structuredClone(fresh);delete legacyPrompt.preferences.synthesisPrompt;add('legacy-prompt-uses-default',legacyPrompt);
  for(const [label,value] of [['custom-prompt-multiline','  以童话风格创作。\n\t保留奇妙的想象。\r\n'],['custom-prompt-limit','🌟'.repeat(p.SYNTHESIS_PROMPT_LIMIT/2)],['custom-prompt-reset','']]){const save=structuredClone(fresh);save.preferences.synthesisPrompt=value;add(label,save);}
  const folders=structuredClone(repeated);folders.favorites=[{id:'folder:one',name:'常用',cardIds:['base:metal','card:op-first']}];folders.layout=[{id:'instance:one',cardId:'card:op-first',x:-45.5,y:30,pinned:true}];folders.preferences.skinId='sea';add('folders-layout-appearance',folders);
  const stripped=structuredClone(next);stripped.apiKey='fixture-secret-not-a-key';stripped.preferences.apiKey='fixture-secret-not-a-key';stripped.cards[5].providerSecret='fixture-secret-not-a-key';add('unknown-fields-projected',stripped);
  const bad=(label,mutate)=>{const save=structuredClone(next);mutate(save);add(label,save);};
  bad('newer-format',s=>s.formatVersion=3);bad('newer-content',s=>s.contentVersion=2);bad('negative-revision',s=>s.revision=-1);bad('fractional-revision',s=>s.revision=1.2);
  bad('missing-base',s=>s.cards.shift());bad('changed-base',s=>s.cards[0].description='changed');bad('duplicate-name',s=>s.cards[5].name='金');bad('invalid-category',s=>s.cards[5].category='星空');bad('control-character',s=>s.cards[5].name='坏\u0000卡');
  bad('incorrect-recipe-key',s=>s.recipes[0].key='[]');bad('missing-ingredient',s=>{s.recipes[0].ingredientIds=['base:metal','missing'];s.recipes[0].key=JSON.stringify(s.recipes[0].ingredientIds);});
  bad('incorrect-statistics',s=>s.stats.synthesisCount=99);bad('incorrect-operation-result',s=>s.operations[0].resultId='base:metal');bad('bad-fingerprint',s=>s.operations[0].fingerprint='{');bad('bad-date',s=>s.updatedAt='invalid');bad('bad-appearance',s=>s.preferences.skinId='locked');
  bad('missing-favorite-card',s=>s.favorites=[{id:'f',name:'x',cardIds:['missing']}]);bad('bad-layout-position',s=>s.layout=[{id:'l',cardId:'base:metal',x:10000001,y:0}]);
  bad('bad-layout-initialized-marker',s=>s.preferences.layoutInitialized='true');
  for(const [label,value] of [['null',null],['number',42],['too-long','🌟'.repeat(p.SYNTHESIS_PROMPT_LIMIT/2)+'x'],['null-byte','坏\0提示'],['vertical-tab','坏\v提示'],['c1','坏\u0085提示'],['bidi','坏\u202e提示']])bad(`bad-prompt-${label}`,s=>s.preferences.synthesisPrompt=value);
  const transitions=[{label:'commit-durable-answer',current:fresh,next,pending,clear:true},{label:'known-local-recipe',current:next,next:repeated,pending:null,clear:false},{label:'deduplicate-existing-card',current:next,next:dedup,pending:dupPending,clear:true}];
  const preference=structuredClone(next);preference.revision++;preference.preferences.reduceMotion=true;transitions.push({label:'preferences-only',current:next,next:preference,pending:null,clear:false});
  const promptPreference=structuredClone(next);promptPreference.revision++;promptPreference.preferences.synthesisPrompt='以童话风格创作。\n简介像一句短诗。';transitions.push({label:'prompt-only-no-new-cards',current:next,next:promptPreference,pending:null,clear:false});
  const tamper=structuredClone(next);tamper.cards[5].name='替换答案';transitions.push({label:'reject-result-card-tampering',current:fresh,next:tamper,pending,error:'OPERATION_CONFLICT'});
  const reset=structuredClone(fresh);reset.revision=next.revision+1;transitions.push({label:'reject-silent-reset',current:next,next:reset,pending:null,error:'INVALID_SAVE'});
  transitions.push({label:'reject-unpersisted-new-answer',current:fresh,next,pending:null,error:'RESULT_REQUIRED'});
  const oldMutation=structuredClone(repeated);oldMutation.cards[5].description='更改旧发现';transitions.push({label:'reject-history-rewrite',current:next,next:oldMutation,pending:null,error:'INVALID_SAVE'});
  const v1=structuredClone(next);v1.formatVersion=1;delete v1.name;delete v1.mods;for(const op of v1.operations)delete op.source;add('v1-read-upgrade',v1);
  const png=fs.readFileSync(new URL('../../../assets/app-icon.png',import.meta.url)).toString('base64');
  const manifest={modFormat:1,id:'test.mod',name:'试验世界',version:'1',theme:'森林与机械并存',cards:[{name:'晶体',emoji:'💎',category:'自然',description:'闪亮的晶体。'}],startingCards:['晶体'],recipes:[{ingredients:['水','火'],result:'晶体'}],assets:{tile:`data:image/png;base64,${png}`},tabletops:[{id:'woods',name:'林地',image:'tile'}],skins:[{id:'silver',name:'银色',image:'tile'}],cardBacks:[{id:'lines',name:'线条'}],actions:[{id:'grow',name:'生长'}],script:'registerMod({ actions:{ grow(ctx){return {state:{count:1}};} } });'};
  const installed=installMod(fresh,manifest,{now:'2026-10-27T00:00:01.000Z'}),enabled=toggleMod(installed,'test.mod',true,'2026-10-27T00:00:02.000Z');
  const action=applyModAction(enabled,'test.mod',{cards:[{name:'晶树',emoji:'🌳',category:'生物',description:'晶体长成的树。'}],state:{growth:1}},'2026-10-27T00:00:03.000Z');
  const localPending={saveId:enabled.id,operationId:'op-mod',ingredientIds:['base:water','base:fire'],result:manifest.cards[0],now:'2026-10-27T00:00:04.000Z',source:{kind:'mod',modId:'test.mod',modName:'试验世界'},modStates:[{id:'test.mod',state:{growth:2}}],modProcessed:true};
  const modCombined=commitSynthesis(enabled,localPending).save,removed=removeMod(modCombined,'test.mod','2026-10-27T00:00:05.000Z');
  for(const [label,save] of [['mod-installed-disabled',installed],['mod-enabled-seed',enabled],['mod-action',action],['mod-combined-state',modCombined],['mod-removed-history-retained',removed]])add(label,save);
  const skin=structuredClone(installed);skin.preferences.skinId='mod/test.mod/skins/silver';add('disabled-mod-appearance-retained',skin);
  transitions.push({label:'mod-install',current:fresh,next:installed,pending:null,clear:false},{label:'mod-enable-seed',current:installed,next:enabled,pending:null,clear:false},{label:'mod-action-card-state',current:enabled,next:action,pending:null,clear:false},{label:'mod-result-state-commit',current:enabled,next:modCombined,pending:localPending,clear:true},{label:'mod-remove-keeps-history',current:modCombined,next:removed,pending:null,clear:false});
  transitions.push({label:'ai-pending-not-processed',current:fresh,next,pending:{...pending,modProcessed:false},error:'PENDING_MOD_PROCESSING'});
  const wrongState=structuredClone(modCombined);wrongState.mods[0].state={growth:999};transitions.push({label:'reject-pending-mod-state-tamper',current:enabled,next:wrongState,pending:localPending,error:'OPERATION_CONFLICT'});
  const cachedPending={saveId:modCombined.id,operationId:'cached-mod',ingredientIds:['base:fire','base:water'],result:manifest.cards[0],now:'2026-10-27T00:00:06.000Z',source:{kind:'recipe'},modStates:[{id:'test.mod',state:{growth:3}}],modProcessed:true};
  const cached=commitSynthesis(modCombined,cachedPending).save;transitions.push({label:'cached-recipe-after-combine-state',current:modCombined,next:cached,pending:cachedPending,clear:true});add('cached-recipe-history-source',cached);
  const modCases=[];const api={package:validateModPackage,mods:validateMods,state:validateModState,states:validateModStates,source:validateSource};
  const modCase=(label,kind,input,mods)=>{try{modCases.push({label,kind,input,...(mods?{mods}:{}),expected:api[kind](input,mods)});}catch(error){modCases.push({label,kind,input,...(mods?{mods}:{}),error:error.code});}};
  modCase('full-package','package',manifest);modCase('package-text','package',JSON.stringify(manifest));modCase('bad-json-package','package','{');modCase('enabled-mods','mods',enabled.mods);modCase('structured-state','state',{count:3,flag:true,records:[null,'世界',{x:1.5}]});modCase('enabled-state-update','states',[{id:'test.mod',state:{count:4}}],enabled.mods);modCase('source-enabled-mod','source',localPending.source,enabled.mods);modCase('source-history-uninstalled','source',localPending.source);
  modCase('source-null-invalid','source',null);modCase('source-disabled-rejected','source',localPending.source,installed.mods);modCase('state-unknown-mod','states',[{id:'missing',state:{}}],enabled.mods);modCase('state-prototype','state',JSON.parse('{"__proto__":{"polluted":true}}'));modCase('state-too-large','state',{text:'x'.repeat(65536)});
  let deep={};for(let i=0;i<22;i++)deep={next:deep};modCase('state-too-deep','state',deep);
  const altered=(label,fn)=>{const value=structuredClone(manifest);fn(value);modCase(label,'package',value);};
  altered('mod-base-conflict',m=>m.cards=[{...manifest.cards[0],name:'金'}]);altered('missing-starter',m=>m.startingCards=['不存在']);altered('missing-result',m=>m.recipes[0].result='不存在');altered('duplicate-recipe-multiplicity',m=>m.recipes.push({ingredients:['火','水'],result:'晶体'}));altered('remote-asset',m=>m.assets.tile='https://example.invalid/file.png');altered('svg-asset',m=>m.assets.tile='data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');altered('wrong-media-kind',m=>m.sounds={lift:'tile'});altered('color-css-rejected',m=>m.skins[0].face='rgb(1,2,3)');altered('color-whitespace-rejected',m=>m.skins[0].face=' #ffffff ');altered('action-without-script',m=>m.script='');altered('script-too-large',m=>m.script='a'.repeat(128*1024+1));altered('script-null-byte',m=>m.script='registerMod({});\0');altered('image-too-large-dimensions',m=>{const b=Buffer.from(png,'base64');b.writeUInt32BE(2049,16);m.assets.tile=`data:image/png;base64,${b.toString('base64')}`;});
  modCase('duplicate-installed-mod','mods',[...enabled.mods,...enabled.mods]);modCase('conflicting-enabled-recipes','mods',[...enabled.mods,{...enabled.mods[0],manifest:{...enabled.mods[0].manifest,id:'second.mod'}}]);
  const garden=JSON.parse(fs.readFileSync(new URL('../../../examples/mods/苔光花园.wxgc3-mod',import.meta.url),'utf8'));
  modCase('real-garden-package','package',garden);
  const gardenInstalled=installMod(fresh,garden,{now:'2026-10-27T00:00:10.000Z'}),gardenEnabled=toggleMod(gardenInstalled,garden.id,true,'2026-10-27T00:00:11.000Z');
  add('real-garden-save-export-roundtrip',gardenEnabled);transitions.push({label:'real-garden-install',current:fresh,next:gardenInstalled,pending:null,clear:false},{label:'real-garden-enable',current:gardenInstalled,next:gardenEnabled,pending:null,clear:false});
  const promptCases=[{custom:'',materials:[c.BASE_CARDS[0],c.BASE_CARDS[1]],themes:[]},{custom:'  以童话风格创作。\n\t不省略重复材料。\r\n',materials:[c.BASE_CARDS[2],c.BASE_CARDS[2],c.BASE_CARDS[3]],themes:['苔光花园世界主题']}].map(value=>({...value,expected:buildSynthesisMessages(value.materials,value.themes,value.custom)}));
  fs.writeFileSync(`${directory}/fixture.json`,JSON.stringify({catalog,cases,transitions,modCases,promptCases}));
} else if(mode==='verify'){
  const fixture=JSON.parse(fs.readFileSync(`${directory}/fixture.json`));const output=JSON.parse(fs.readFileSync(`${directory}/results.json`));
  for(const [index,item] of output.saves.entries()){const expected=fixture.cases[index];assert.equal(item.label,expected.label);if(expected.error)assert.equal(item.error,expected.error,expected.label);else{assert.equal(item.error,undefined,expected.label);assert.deepEqual(validateSave(item.save),expected.expected,expected.label);assert.equal(JSON.stringify(item.save).includes('fixture-secret-not-a-key'),false,'no unknown secrets');}}
  for(const [index,item] of output.transitions.entries()){const expected=fixture.transitions[index];assert.equal(item.label,expected.label);if(expected.error)assert.equal(item.error,expected.error,expected.label);else{assert.equal(item.error,undefined,expected.label);assert.equal(item.clear,expected.clear,expected.label);}}
  for(const [index,item] of output.modCases.entries()){const expected=fixture.modCases[index];assert.equal(item.label,expected.label);if(expected.error)assert.equal(item.error,expected.error,expected.label);else{assert.equal(item.error,undefined,expected.label);assert.deepEqual(item.value,expected.expected,expected.label);}}
  assert.equal(output.protocolFailures,0);console.log(JSON.stringify({passed:output.saves.length+output.transitions.length+output.protocolChecks+output.modCases.length,saveCases:output.saves.length,transitionCases:output.transitions.length,protocolCases:output.protocolChecks,modCases:output.modCases.length,scope:'host JVM shared model/protocol; not Android SQLite/Keystore/device validation'}));
}
