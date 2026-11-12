import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createAppView } from '../src/ui/app-view.js';
import { createNewSave, commitSynthesis, validateSave, installMod, toggleMod } from '../src/core/model.js';
import {validateModPackage} from '../src/core/mods.js';
import { DEFAULT_SYNTHESIS_PROMPT } from '../src/ai/prompt.js';

// DOM 检查只覆盖入口、互斥和节点结构，不把模拟画布当作视觉截图。
function harness({width=960,height=540,configured=true,initialSave=null,stayHome=false}={}) {
  const window=new Window({url:'https://app.local/'}),document=window.document;
  let frameSequence=0;const frames=new Map(),captures=new WeakMap();
  Object.assign(globalThis,{window,document,ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:fn=>{const id=++frameSequence;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
  const gradient={addColorStop(){}};
  const notes=[];
  window.AudioContext=class{
    currentTime=0;state='running';destination={};
    createOscillator(){const oscillator={type:'',frequency:{value:0},connect(){},stop(){},start(){notes.push({type:oscillator.type,frequency:oscillator.frequency.value});}};return oscillator;}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}
    close(){return Promise.resolve();}
  };
  const context=new Proxy({measureText:text=>({width:Array.from(text).length*7}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(obj,key)=>obj[key]||(()=>{})});
  window.HTMLCanvasElement.prototype.getContext=()=>context;
  // happy-dom 没有原生指针捕获；只补浏览器接口，不绕过实际 pointer 事件处理链。
  window.HTMLCanvasElement.prototype.setPointerCapture=function(id){let ids=captures.get(this);if(!ids){ids=new Set();captures.set(this,ids);}ids.add(id);};
  window.HTMLCanvasElement.prototype.hasPointerCapture=function(id){return captures.get(this)?.has(id)||false;};
  window.HTMLCanvasElement.prototype.releasePointerCapture=function(id){captures.get(this)?.delete(id);};
  const root=document.createElement('div');document.body.append(root);root.getBoundingClientRect=()=>({left:0,top:0,width,height});
  window.HTMLCanvasElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:633.6,height:540});
  const calls={configure:[],combine:[],preferences:[],layouts:[],cancel:0,retry:0,export:0,import:0,backups:0,restores:[],refresh:0,create:[],switch:[],rename:[],chooseMod:0,installMod:[],toggleMod:[],removeMod:[],modAction:[]};
  const save=initialSave||createNewSave({id:'ui-fixture',now:'2026-10-26T00:00:00.000Z'});
  const view=createAppView(root,{onConfigure:value=>calls.configure.push(value),onCombine:ids=>calls.combine.push([...ids]),onSavePreferences:value=>calls.preferences.push(value),onSaveLayout:value=>calls.layouts.push(value),onCancel:()=>{calls.cancel++;},onRetrySave:()=>{calls.retry++;},onExport:()=>{calls.export++;},onImport:()=>{calls.import++;},onListBackups:()=>{calls.backups++;},onRestoreBackup:id=>calls.restores.push(id),onRefreshLibrary:()=>{calls.refresh++;},onCreateSlot:name=>calls.create.push(name),onSwitchSlot:id=>calls.switch.push(id),onRenameSlot:(id,name)=>calls.rename.push({id,name}),onChooseMod:()=>{calls.chooseMod++;},onInstallMod:replace=>calls.installMod.push(replace),onToggleMod:(id,enabled)=>calls.toggleMod.push({id,enabled}),onRemoveMod:id=>calls.removeMod.push(id),onModAction:(id,action)=>calls.modAction.push({id,action})});
  const state={save,configStatus:{configured,model:'fixture'},mode:'native',busy:false,error:'',lastResult:null,synthesis:null,canRetrySave:false};
  view.render(state);
  if(configured&&!stayHome)root.querySelector('.wx-home-enter').click();
  return {root,view,state,calls,document,window,context,notes,
    render(patch){Object.assign(state,patch);view.render(state);},
    frame(time){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));},
    pointer(type,id,x,y,pointerType='mouse'){root.querySelector('.wx-canvas').dispatchEvent(new window.PointerEvent(type,{pointerId:id,button:0,pointerType,clientX:x,clientY:y,bubbles:true,cancelable:true}));},
    close(){view.destroy();window.happyDOM.abort();}};
}
const clickText=(root,text)=>{const button=[...root.querySelectorAll('button')].find(b=>b.textContent===text&&!b.closest('[hidden]'));assert.ok(button,'找不到按钮：'+text);button.click();};
const slotNames=h=>[...h.root.querySelectorAll('.wx-material-slot .wx-slot-name')].map(node=>node.textContent);
const combineButton=h=>h.root.querySelector('.wx-dock-row > .wx-button-primary');
// 960×540、右词典展开时的正式初始五本源坐标；通过真实指针事件选材。
const BASE_POINTS={metal:[128.8,190],wood:[288.8,120],water:[448.8,220],fire:[208.8,360],earth:[388.8,400]};
// 多卡选材是显式模式；先打开可见入口，再通过真实手势选卡。
const pick=(h,base,id)=>{if(h.root.querySelector('.wx-dock').hidden)clickText(h.root,'🔧 多卡合成台');const [x,y]=BASE_POINTS[base];h.pointer('pointerdown',id,x,y);h.pointer('pointerup',id,x,y);};

const TEST_TIME='2026-10-26T00:00:00.000Z';
const TEST_RESULT={name:'工具',emoji:'🛠️',category:'科技',description:'帮助双手做事。'};
const TEST_MOD={modFormat:1,id:'paper-world',name:'纸世界',version:'1',cards:[TEST_RESULT],recipes:[{ingredients:['金','金'],result:'工具'}],skins:[{id:'warm',name:'暖纸',face:'#fff5dd',ink:'#222222',border:'#333333',accent:'#ccaa55'}],script:'registerMod({actions:{gift(){return {}}}});',actions:[{id:'gift',name:'领取礼物',description:'获得这个世界的礼物。'}]};

test('提示词编辑保留未保存草稿、选区和输入焦点，返回后仍可继续',()=>{
  const h=harness();try{
    clickText(h.root,'☰ 更多');clickText(h.root,'📝 提示词');
    const editor=h.root.querySelector('.wx-prompt-editor');assert.equal(editor.value,DEFAULT_SYNTHESIS_PROMPT);
    editor.value='只生成海洋里的具体事物。\n保留重复材料。';editor.dispatchEvent(new h.window.Event('input'));editor.focus();editor.setSelectionRange(3,7);
    h.render({save:{...h.state.save,revision:1}});
    assert.equal(h.root.querySelector('.wx-prompt-editor'),editor);assert.equal(h.document.activeElement,editor);assert.equal(editor.selectionStart,3);assert.equal(editor.selectionEnd,7);
    h.root.querySelector('.wx-dialog .wx-close').click();clickText(h.root,'☰ 更多');clickText(h.root,'📝 提示词');
    assert.equal(h.root.querySelector('.wx-prompt-editor').value,'只生成海洋里的具体事物。\n保留重复材料。');assert.equal(h.calls.preferences.length,0);
  }finally{h.close();}
});

test('提示词保存失败保留草稿，只有真实存档响应才显示已保存',async()=>{
  const h=harness();try{
    clickText(h.root,'☰ 更多');clickText(h.root,'📝 提示词');
    const editor=h.root.querySelector('.wx-prompt-editor');editor.value='只生成海洋生物。';editor.dispatchEvent(new h.window.Event('input'));
    clickText(h.root,'保存提示词');await Promise.resolve();await Promise.resolve();
    assert.match(h.root.querySelector('.wx-prompt-feedback').textContent,/没有保存成功/);assert.equal(editor.value,'只生成海洋生物。');
    clickText(h.root,'保存提示词');h.render({save:{...h.state.save,revision:1,preferences:{...h.state.save.preferences,synthesisPrompt:editor.value}}});await Promise.resolve();await Promise.resolve();
    assert.equal(h.root.querySelector('.wx-prompt-feedback').textContent,'已保存。');assert.equal(h.root.querySelector('.wx-prompt-save').disabled,true);assert.deepEqual(h.calls.preferences,[{synthesisPrompt:'只生成海洋生物。'},{synthesisPrompt:'只生成海洋生物。'}]);assert.equal(h.calls.configure.length,0);assert.equal(h.calls.combine.length,0);
  }finally{h.close();}
});

test('恢复默认仅修改草稿，保存才生效；切档不串草稿且等待中不改提示词',async()=>{
  const save=createNewSave({id:'prompt-a',now:TEST_TIME});save.preferences.synthesisPrompt='森林世界。';const h=harness({initialSave:save});try{
    clickText(h.root,'☰ 更多');clickText(h.root,'📝 提示词');clickText(h.root,'恢复默认');
    assert.equal(h.state.save.preferences.synthesisPrompt,'森林世界。');assert.equal(h.root.querySelector('.wx-prompt-editor').value,DEFAULT_SYNTHESIS_PROMPT);assert.equal(h.calls.preferences.length,0);
    clickText(h.root,'保存提示词');assert.deepEqual(h.calls.preferences,[{synthesisPrompt:''}]);await Promise.resolve();await Promise.resolve();
    const next=createNewSave({id:'prompt-b',now:TEST_TIME});next.preferences.synthesisPrompt='沙漠世界。';h.render({save:next,saveEpoch:1});
    assert.equal(h.root.querySelector('.wx-prompt-editor').value,'沙漠世界。');
    const editor=h.root.querySelector('.wx-prompt-editor');editor.value='冰雪世界。';editor.dispatchEvent(new h.window.Event('input'));h.render({busy:'combine'});
    assert.equal(h.root.querySelector('.wx-prompt-save').disabled,true);assert.equal(h.root.querySelector('.wx-dialog .wx-close').disabled,false);
  }finally{h.close();}
});

test('收藏空态只说明收藏入口，有卡显示数量并可连续取卡',()=>{
  const h=harness();try{
    h.root.querySelector('.wx-favorite-toggle').click();const drawer=h.root.querySelector('.wx-favorite-drawer');
    assert.equal(drawer.querySelector('.wx-favorite-count').textContent,'0 张');assert.equal(drawer.textContent.includes('点卡放上台面'),false);assert.match(drawer.textContent,/打开卡牌详情/);
    h.render({save:{...h.state.save,revision:1,favorites:[{id:'default',name:'收藏',cardIds:['base:water','base:fire']}]}});
    assert.equal(drawer.querySelector('.wx-favorite-empty'),null);assert.equal(drawer.querySelector('.wx-favorite-count').textContent,'2 张');
    const tile=drawer.querySelector('.wx-card-tile');tile.click();tile.click();assert.equal(h.calls.layouts.length,2);assert.equal(drawer.inert,false);
    h.render({save:createNewSave({id:'another-world',now:TEST_TIME}),saveEpoch:1});assert.equal(drawer.querySelectorAll('.wx-card-tile').length,0);assert.equal(drawer.querySelector('.wx-favorite-count').textContent,'0 张');
  }finally{h.close();}
});
function testLibrary(save){return {activeSlotId:'a',slots:[{id:'a',name:'当前世界',saveId:save.id,cardCount:save.cards.length,recipeCount:save.recipes.length,synthesisCount:save.stats.synthesisCount,updatedAt:save.updatedAt,modCount:save.mods.length,available:true},{id:'b',name:'第二世界',saveId:'other',cardCount:5,recipeCount:0,synthesisCount:0,updatedAt:TEST_TIME,modCount:0,available:true}]};}

test('更多提供独立存档入口，显示多槽、创建与切换，待存时禁用改变当前槽',()=>{
  const h=harness();try{
    h.render({library:testLibrary(h.state.save)});clickText(h.root,'☰ 更多');
    for(const text of ['💾 存档','🧩 Mod','📜 合成历史','📋 配方表'])assert.ok([...h.root.querySelectorAll('.wx-menu button')].some(b=>b.textContent===text));
    clickText(h.root,'💾 存档');assert.equal(h.calls.refresh,1);assert.equal(h.root.querySelectorAll('.wx-slot-list .wx-slot').length,2);
    clickText(h.root,'继续游玩');assert.deepEqual(h.calls.switch,['b']);
    const input=h.root.querySelector('input[aria-label="新存档名称"]');input.value='新旅程';input.dispatchEvent(new h.window.Event('input'));h.root.querySelector('.wx-slot-create').dispatchEvent(new h.window.Event('submit',{cancelable:true}));assert.deepEqual(h.calls.create,['新旅程']);
    h.render({canRetrySave:true});for(const b of h.root.querySelectorAll('.wx-slot-list button,.wx-slot-create button'))assert.equal(b.disabled,true);
    assert.match(h.root.querySelector('.wx-dialog').textContent,/导入会添加一份新存档/);
  }finally{h.close();}
});

test('坏档和没有Key时仍能打开存档管理，不靠API检测才能切回健康档',()=>{
  const h=harness({configured:false});try{
    const library=testLibrary(h.state.save);h.render({library});clickText(h.root.querySelector('form.wx-api-dialog'),'管理存档');assert.equal(h.root.querySelector('.wx-modal-layer').hidden,true);clickText(h.root,'继续游玩');assert.deepEqual(h.calls.switch,['b']);
    h.root.querySelector('.wx-dialog .wx-close').click();h.render({save:null,recoveryRequired:true,error:'存档无法读取。'});const recovery=h.root.querySelector('.wx-recovery-dialog');assert.equal(recovery.hidden,false);clickText(recovery,'继续游玩');assert.deepEqual(h.calls.switch,['b','b']);assert.equal(h.calls.configure.length,0);
  }finally{h.close();}
});

test('合成历史保留重复材料、结果与真实来源，旧档显示来源未知且可搜索',()=>{
  let save=createNewSave({id:'history-ui',now:TEST_TIME});save=commitSynthesis(save,{operationId:'one',ingredientIds:['base:metal','base:metal'],result:TEST_RESULT,now:TEST_TIME}).save;
  const old={...save,formatVersion:1};old.operations=old.operations.map(({source,...operation})=>operation);save=validateSave(old);
  const h=harness({initialSave:save});try{
    clickText(h.root,'☰ 更多');clickText(h.root,'📜 合成历史');const row=h.root.querySelector('.wx-record-row');assert.ok(row);assert.equal(row.querySelectorAll('button[aria-label="金，放回台面"]').length,2);assert.match(row.textContent,/工具/);assert.match(row.textContent,/来源未知/);
    const search=h.root.querySelector('input[aria-label="搜索材料或结果"]');search.value='不存在';search.dispatchEvent(new h.window.Event('input'));assert.equal(h.root.querySelectorAll('.wx-record-row').length,0);search.value='工具';search.dispatchEvent(new h.window.Event('input'));assert.equal(h.root.querySelectorAll('.wx-record-row').length,1);
    h.root.querySelector('.wx-record-row button').click();assert.equal(h.root.querySelector('.wx-panel-layer').hidden,true);assert.ok(h.calls.layouts.length>0);
  }finally{h.close();}
});

test('配方表区分Mod预设与已发现，未发现结果不能凭查看加入词库',()=>{
  const save=toggleMod(installMod(createNewSave({id:'recipe-ui',now:TEST_TIME}),TEST_MOD,{now:TEST_TIME}),'paper-world',true,TEST_TIME);
  const h=harness({initialSave:save});try{
    clickText(h.root,'☰ 更多');clickText(h.root,'📋 配方表');const row=h.root.querySelector('.wx-record-row');assert.match(row.textContent,/Mod 预设.*纸世界/);assert.equal(row.querySelector('button[aria-label="工具，尚未发现"]').disabled,true);assert.equal(h.state.save.cards.length,5);assert.equal(h.state.save.recipes.length,0);
    const filter=h.root.querySelector('select[aria-label="按发现状态筛选"]');filter.value='discovered';filter.dispatchEvent(new h.window.Event('change'));assert.equal(h.root.querySelectorAll('.wx-record-row').length,0);
  }finally{h.close();}
});

test('Mod导入先预览，含脚本的启用须明确点击，已启用玩法与外观有入口',()=>{
  const installed=installMod(createNewSave({id:'mods-ui',now:TEST_TIME}),TEST_MOD,{now:TEST_TIME}),h=harness({initialSave:installed});try{
    clickText(h.root,'☰ 更多');clickText(h.root,'🧩 Mod');clickText(h.root,'导入 Mod 文件');assert.equal(h.calls.chooseMod,1);
    h.render({modCandidate:validateModPackage(TEST_MOD)});assert.match(h.root.querySelector('.wx-mod-preview').textContent,/默认停用/);clickText(h.root,'替换这个 Mod');assert.deepEqual(h.calls.installMod,[true]);
    clickText(h.root,'启用');assert.deepEqual(h.calls.toggleMod,[]);clickText(h.root,'启用脚本 Mod');assert.deepEqual(h.calls.toggleMod,[{id:'paper-world',enabled:true}]);
    h.render({save:toggleMod(installed,'paper-world',true,TEST_TIME),modCandidate:null});clickText(h.root,'领取礼物');assert.deepEqual(h.calls.modAction,[{id:'paper-world',action:'gift'}]);
    clickText(h.root,'移除');assert.deepEqual(h.calls.removeMod,[]);clickText(h.root,'确认移除');assert.deepEqual(h.calls.removeMod,['paper-world']);
    h.view.openSettings();assert.ok([...h.root.querySelectorAll('option')].some(option=>option.value==='mod/paper-world/skins/warm'));
  }finally{h.close();}
});

test('自定义卡图在词典详情分享共用缓存，加载回调不循环重建，停用后立即回退',()=>{
  const previousImage=globalThis.Image,images=[];
  globalThis.Image=class{constructor(){this.naturalWidth=1;this.naturalHeight=1;images.push(this);}set src(value){this.source=value;}};
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const manifest={...TEST_MOD,assets:{paper:png},skins:[{...TEST_MOD.skins[0],image:'paper'}]};
  let save=toggleMod(installMod(createNewSave({id:'mod-image-ui',now:TEST_TIME}),manifest,{now:TEST_TIME}),'paper-world',true,TEST_TIME);save={...save,preferences:{...save.preferences,skinId:'mod/paper-world/skins/warm'}};
  const h=harness({initialSave:save});try{
    h.frame(performance.now()+10);const created=images.length;assert.ok(created>0);for(const image of [...images])image.onload?.();assert.equal(images.length,created);
    h.root.querySelector('.wx-card-tile').dispatchEvent(new h.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));clickText(h.root,'查看分享');clickText(h.root,'返回卡牌详情');assert.equal(images.length,created,'重复打开详情和分享不重新加载相同data URL');
    h.root.querySelector('.wx-dialog .wx-close').click();let drawn=0;h.context.drawImage=()=>{drawn++;};h.render({save:toggleMod(save,'paper-world',false,TEST_TIME)});assert.equal(drawn,0,'停用Mod且卡牌数量不变时，词典立即回退内置绘制');
  }finally{h.close();globalThis.Image=previousImage;}
});

test('没有Key也能继续保存上次已生成的结果，不强迫重新付费检测',()=>{
  const h=harness({configured:false});try{
    h.render({canRetrySave:true,synthesis:{id:'restored-op',ingredientIds:['base:metal','base:wood'],source:'ai',phase:'save-failed'},error:'上次结果还没有保存。'});
    assert.equal(h.root.querySelector('.wx-modal-layer').hidden,true);assert.equal(h.root.querySelector('.wx-status').hidden,false);
    clickText(h.root,'重试保存');assert.equal(h.calls.retry,1);assert.equal(h.calls.configure.length,0);assert.equal(h.calls.combine.length,0);
  }finally{h.close();}
});

test('坏库入口显示导入与本机备份，恢复确认前不会改进度或弹Key检测',()=>{
  const h=harness({configured:false});try{
    h.render({save:null,recoveryRequired:true,error:'本地存档无法读取。'});
    const recovery=h.root.querySelector('.wx-recovery-dialog');assert.equal(recovery.hidden,false);assert.equal(h.root.querySelector('form.wx-api-dialog').hidden,true);
    clickText(recovery,'导入存档');clickText(recovery,'查看本机备份');assert.equal(h.calls.import,1);assert.equal(h.calls.backups,1);
    h.render({backups:[{id:'backup-one',createdAt:'2026-10-26T10:00:00.000Z',cardCount:8,recipeCount:3}]});
    clickText(recovery,'恢复这份备份');assert.deepEqual(h.calls.restores,[]);assert.match(recovery.textContent,/8 张卡牌/);
    clickText(recovery,'确认恢复');assert.deepEqual(h.calls.restores,['backup-one']);assert.equal(h.calls.configure.length,0);
    h.render({busy:'restore'});assert.equal([...recovery.querySelectorAll('button')].every(b=>b.disabled),true);
  }finally{h.close();}
});

test('合成台取消或请求失败恢复原顺序和重复材料，不重复追加槽位',()=>{
  for(const phase of ['cancelled','failed']){
    const h=harness();try{
      pick(h,'metal',1);pick(h,'wood',2);pick(h,'metal',3);
      assert.deepEqual(slotNames(h),['金','木','金']);clickText(h.root,'合成');
      const ids=['base:metal','base:wood','base:metal'];assert.deepEqual(h.calls.combine,[ids]);assert.deepEqual(slotNames(h),[]);
      const synthesis={id:'slot-operation',ingredientIds:ids,source:'ai',phase:'requesting'};
      h.render({busy:'combine',synthesis});assert.equal(combineButton(h).disabled,true);
      if(phase==='cancelled'){clickText(h.root,'取消等待');assert.equal(h.calls.cancel,1);}
      h.render({busy:false,error:phase==='cancelled'?'已取消':'等待超时',synthesis:{...synthesis,phase}});
      assert.deepEqual(slotNames(h),['金','木','金']);assert.equal(h.root.querySelector('.wx-dock').hidden,false);assert.equal(combineButton(h).disabled,false);
      h.render({});assert.deepEqual(slotNames(h),['金','木','金']);assert.equal(h.calls.combine.length,1);
    }finally{h.close();}
  }
});

test('保存失败保留待存操作，显示重试并阻止重新合成及补选材料',()=>{
  const h=harness();try{
    pick(h,'metal',1);pick(h,'wood',2);clickText(h.root,'合成');
    const synthesis={id:'pending-save',ingredientIds:['base:metal','base:wood'],source:'ai',phase:'requesting'};
    h.render({busy:'combine',synthesis});h.render({busy:'save',synthesis:{...synthesis,phase:'saving'}});
    h.render({busy:false,canRetrySave:true,error:'结果还没有保存，请重试保存。',synthesis:{...synthesis,phase:'save-failed'}});
    assert.equal(h.root.querySelector('.wx-status').hidden,false);
    const retry=[...h.root.querySelectorAll('button')].find(b=>b.textContent==='重试保存');assert.equal(retry.hidden,false);
    assert.equal(combineButton(h).disabled,true);assert.equal(h.root.querySelector('.wx-result-status').textContent,'');
    h.render({error:''});assert.equal(h.root.querySelector('.wx-status').hidden,false,'配置成功清空错误文字后，待存结果的重试入口仍须保留');assert.equal(retry.hidden,false);
    pick(h,'water',3);pick(h,'fire',4);assert.deepEqual(slotNames(h),[],'待存结果不能被新选材替换');
    combineButton(h).click();assert.equal(h.calls.combine.length,1);retry.click();assert.equal(h.calls.retry,1);
    h.render({busy:'save',error:'',synthesis:{...synthesis,phase:'saving'}});
    assert.equal(combineButton(h).disabled,true);assert.equal(h.root.querySelector('.wx-result-status').textContent,'');
  }finally{h.close();}
});

test('lastResult到达不提前播报，真实画布揭晓后才更新读屏状态且不重复添加结果',()=>{
  const h=harness();try{
    pick(h,'metal',1);pick(h,'wood',2);clickText(h.root,'合成');
    const synthesis={id:'revealed-operation',ingredientIds:['base:metal','base:wood'],source:'ai',phase:'requesting'};
    h.render({busy:'combine',synthesis});h.render({busy:'save',synthesis:{...synthesis,phase:'saving'}});
    const result=commitSynthesis(h.state.save,{operationId:synthesis.id,ingredientIds:synthesis.ingredientIds,result:{name:'工具',emoji:'🛠️',category:'科技',description:'让双手更有办法。'},now:'2026-10-26T00:00:01.000Z'});
    const lastResult={operationId:synthesis.id,card:result.card,isNewCard:result.isNewCard,isNewRecipe:result.isNewRecipe};
    h.render({busy:false,save:result.save,synthesis:{...synthesis,phase:'committed'},lastResult});
    const status=h.root.querySelector('.wx-result-status');assert.equal(status.textContent,'','提交响应不是动画揭晓回调');
    assert.equal(status.getAttribute('role'),'status');assert.ok(status.classList.contains('wx-visually-hidden'));assert.equal(h.root.querySelector('.wx-result-toast'),null,'结果不再另挂一条常驻台面横幅');
    assert.equal(h.calls.layouts.length,0,'揭晓前不提前生成结果台面实例');
    // 推进实际 RAF 回调，不直接调用视图的 onReveal 或修改产品私有状态。
    const time=performance.now()+600;h.frame(time);
    assert.match(status.textContent,/发现新卡：工具/);assert.equal(status.querySelector('button'),null);assert.equal(h.calls.layouts.length,1);
    h.render({});h.frame(time+32);assert.match(status.textContent,/发现新卡：工具/);assert.equal(h.calls.layouts.length,1,'同一操作重复渲染不能再次创建结果');
  }finally{h.close();}
});

test('画布拖叠合成不会清空已经放入合成台的材料',()=>{
  const h=harness();try{
    pick(h,'metal',1);pick(h,'metal',2);assert.deepEqual(slotNames(h),['金','金']);
    const [fromX,fromY]=BASE_POINTS.water,[toX,toY]=BASE_POINTS.fire;
    h.pointer('pointerdown',3,fromX,fromY);h.pointer('pointermove',3,toX,toY);h.pointer('pointerup',3,toX,toY);
    assert.deepEqual(h.calls.combine,[['base:fire','base:water']]);assert.deepEqual(slotNames(h),['金','金']);
  }finally{h.close();}
});

test('主页布局：无顶栏，右词典默认展开，收藏和合成台默认收起',()=>{
  const h=harness();try{
    assert.equal(h.root.querySelector('.wx-header'),null);
    assert.equal(h.root.querySelector('.wx-dock').hidden,true);
    assert.equal(h.root.querySelector('.wx-favorite-drawer').inert,true);
    assert.equal(h.root.querySelector('.wx-favorite-drawer').getAttribute('aria-hidden'),'true');
    assert.equal(h.root.querySelector('.wx-dict-toggle').getAttribute('aria-expanded'),'true');
    assert.equal(h.root.querySelectorAll('.wx-library-grid .wx-card-tile').length,5);
    assert.match(h.root.querySelector('.wx-hud').textContent,/0 次.*0 张.*更多/);
    assert.equal(h.root.querySelector('.wx-shell').style.height,'540px');
    assert.ok(Math.abs(parseFloat(h.root.querySelector('.wx-shell').style.getPropertyValue('--dict-space'))-326.4)<.01);
    h.root.querySelector('.wx-dict-toggle').click();
    assert.equal(h.root.querySelector('.wx-shell').style.getPropertyValue('--dict-space'),'0px');
  }finally{h.close();}
});

test('更多里的设置、外观和收藏都有入口，设置弹层关闭后恢复台面',()=>{
  const h=harness();try{
    clickText(h.root,'☰ 更多');clickText(h.root,'⚙️ 设置');
    assert.equal(h.root.querySelector('.wx-panel-layer').hidden,false);
    assert.equal(h.root.querySelectorAll('.wx-dialog select').length,3);
    const select=h.root.querySelector('.wx-dialog select');select.value='sea';select.dispatchEvent(new h.window.Event('change'));
    assert.deepEqual(h.calls.preferences,[{skinId:'sea'}]);
    h.root.querySelector('.wx-dialog .wx-close').click();assert.equal(h.root.querySelector('.wx-panel-layer').hidden,true);
    h.root.querySelector('.wx-favorite-toggle').click();assert.equal(h.root.querySelector('.wx-favorite-drawer').inert,false);
    clickText(h.root,'🔧 多卡合成台');assert.equal(h.root.querySelector('.wx-dock').hidden,false);
    assert.equal(h.root.querySelectorAll('.wx-material-slot').length,4);
    clickText(h.root,'收起 ▾');assert.equal(h.root.querySelector('.wx-dock').hidden,true);
  }finally{h.close();}
});

test('收藏收回时内容保留供滑出，面板和标签共用位移且收起内容不可聚焦',()=>{
  const h=harness();try{
    const drawer=h.root.querySelector('.wx-favorite-drawer'),toggle=h.root.querySelector('.wx-favorite-toggle'),panel=h.root.querySelector('.wx-favorite-panel');
    assert.equal(drawer.parentElement,panel);assert.equal(toggle.parentElement,panel);
    toggle.click();assert.equal(drawer.inert,false);assert.equal(drawer.getAttribute('aria-hidden'),'false');
    const heading=drawer.querySelector('h2');assert.ok(heading);
    toggle.click();assert.equal(drawer.inert,true);assert.equal(drawer.getAttribute('aria-hidden'),'true');assert.equal(toggle.disabled,false);
    assert.equal(drawer.hidden,false,'不能用display:none截断收回动作');assert.equal(drawer.querySelector('h2'),heading,'收回过程中仍绘制原抽屉内容');
    h.render({save:{...h.state.save,preferences:{...h.state.save.preferences,reduceMotion:true}}});assert.ok(h.root.querySelector('.wx-shell').classList.contains('wx-reduce-motion'));
    h.render({save:{...h.state.save,preferences:{...h.state.save.preferences,reduceMotion:false}}});assert.equal(h.root.querySelector('.wx-shell').classList.contains('wx-reduce-motion'),false);
  }finally{h.close();}
});

test('普通按钮有一次点击声，词典取卡不双响，关闭音效后两类入口都安静',()=>{
  const h=harness();try{
    assert.deepEqual(h.notes,[{type:'square',frequency:300}],'从首页进入工厂响一次');h.notes.length=0;
    h.root.querySelector('.wx-favorite-toggle').click();assert.deepEqual(h.notes,[{type:'square',frequency:300}]);
    h.root.querySelector('.wx-favorite-toggle').click();assert.equal(h.notes.length,2);
    h.root.querySelector('.wx-library-grid .wx-card-tile').click();assert.equal(h.calls.layouts.length,1);assert.equal(h.notes.length,3);assert.deepEqual(h.notes[2],{type:'square',frequency:300});
    clickText(h.root,'🧽 整理画布');assert.equal(h.notes.length,4);
    h.render({save:{...h.state.save,preferences:{...h.state.save.preferences,soundEnabled:false}}});
    h.root.querySelector('.wx-favorite-toggle').click();h.root.querySelector('.wx-library-grid .wx-card-tile').click();assert.equal(h.notes.length,4);
  }finally{h.close();}
});

test('等待或待存期间可整理和看详情，不改已有选材；管理操作仍锁住台面',()=>{
  const h=harness();try{
    pick(h,'metal',1);pick(h,'metal',2);
    const synthesis={id:'background-wait',ingredientIds:['base:wood','base:water'],source:'ai',phase:'requesting'};
    const tidy=[...h.root.querySelectorAll('button')].find(b=>b.textContent==='🧽 整理画布');
    for(const [busy,phase,canRetrySave]of [['combine','requesting',false],['save','saving',false],[false,'save-failed',true]]){
      h.render({busy,synthesis:{...synthesis,phase},canRetrySave});assert.equal(tidy.disabled,false);assert.equal(combineButton(h).disabled,true);
      h.root.querySelector('.wx-material-slot').click();assert.deepEqual(slotNames(h),['金','金']);
      const [x,y]=BASE_POINTS.earth;h.pointer('pointerdown',9,x,y);h.pointer('pointerup',9,x,y);
      assert.equal(h.root.querySelector('.wx-panel-layer').hidden,false);assert.match(h.root.querySelector('.wx-detail-head').textContent,/土/);assert.deepEqual(slotNames(h),['金','金']);
      h.root.querySelector('.wx-dialog .wx-close').click();assert.equal(tidy.disabled,false);
    }
    for(const busy of ['import','export','switch-slot','configure','restore','mod-save']){h.render({busy});assert.equal(tidy.disabled,true,'管理阶段应锁住整理：'+busy);}
    h.render({busy:false,pendingBlocked:true});assert.equal(tidy.disabled,true);assert.equal(h.calls.combine.length,0);
  }finally{h.close();}
});

test('拖回词典按实际可见区域接收；词典收起后同一屏幕位置不吞卡',()=>{
  for(const open of [true,false]){
    const h=harness();try{
      h.root.querySelector('.wx-dictionary').getBoundingClientRect=()=>({left:633.6,right:960,top:0,bottom:540,width:326.4,height:540});
      if(!open)h.root.querySelector('.wx-dict-toggle').click();
      const [x,y]=BASE_POINTS.metal;h.pointer('pointerdown',1,x,y);h.pointer('pointermove',1,700,190);h.pointer('pointerup',1,700,190);
      const layout=h.calls.layouts.at(-1);assert.ok(layout);assert.equal(layout.length,open?4:5);assert.equal(layout.some(n=>n.cardId==='base:metal'),!open);
    }finally{h.close();}
  }
});

test('词典搜索不带旧全服入口，详情与分享沿用各自独立结构',()=>{
  const h=harness();try{
    const search=h.root.querySelector('.wx-search input');search.value='水';search.dispatchEvent(new h.window.Event('input'));
    assert.equal(h.root.querySelectorAll('.wx-card-tile').length,1);
    const tile=h.root.querySelector('.wx-card-tile');tile.dispatchEvent(new h.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    assert.ok(h.root.querySelector('.wx-detail-head'));assert.ok(h.root.querySelector('.wx-detail-lore'));
    clickText(h.root,'查看分享');assert.ok(h.root.querySelector('.wx-share-dialog .wx-share-large-card'));assert.ok(h.root.querySelector('.wx-share-copy'));
    assert.equal(h.root.textContent.includes('仅此一张'),false);assert.equal(h.root.textContent.includes('全球首发'),false);
    clickText(h.root,'返回卡牌详情');assert.ok(h.root.querySelector('.wx-detail-head'));
  }finally{h.close();}
});

test('首次配置接受玩家输入Key，检测期间互斥，成功清空Key且不出现开发内容',()=>{
  const h=harness({configured:false});try{
    assert.equal(h.root.querySelector('.wx-modal-layer').hidden,false);
    assert.equal(h.root.querySelector('.wx-api-close').hidden,true);
    const key=h.root.querySelector('input[name="api-key"]');assert.equal(key.disabled,false);assert.equal(key.type,'password');assert.equal(key.required,true);
    key.value='player-supplied-test-key';key.dispatchEvent(new h.window.Event('input',{bubbles:true}));
    const form=h.root.querySelector('.wx-api-dialog');form.dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(h.calls.configure.length,1);assert.equal(h.calls.configure[0].key,'player-supplied-test-key');
    h.render({busy:'configure'});assert.equal(key.disabled,true);assert.equal(h.root.querySelector('.wx-api-submit').disabled,true);
    form.dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));assert.equal(h.calls.configure.length,1);
    assert.match(h.root.querySelector('.wx-api-cost').textContent,/可能产生费用/);assert.equal(h.root.querySelector('.wx-development'),null);assert.doesNotMatch(h.root.textContent,/开发验证|固定测试响应|local-fixture/);
    h.render({busy:false,configStatus:{configured:true,model:'fixture'}});assert.equal(key.value,'');assert.equal(h.root.querySelector('.wx-modal-layer').hidden,true);
    assert.equal(h.state.save.cards.length,5);assert.equal(h.state.save.recipes.length,0);
  }finally{h.close();}
});

test('窄竖屏收起词典保留工作台；横屏按540设计高等比缩放',()=>{
  for(const viewport of [{width:390,height:844,open:false},{width:1920,height:1080,open:true}]){
    const h=harness(viewport);try{
      assert.equal(h.root.querySelector('.wx-dict-toggle').getAttribute('aria-expanded'),String(viewport.open));
      assert.equal(h.root.querySelector('.wx-shell').style.transform,'scale('+(viewport.height/540)+')');
      assert.ok(h.root.querySelector('.wx-combine-launch'));
    }finally{h.close();}
  }
});

test('默认点卡直接看详情，快速二次点击也不偷偷填入合成槽；详情可明确加入材料',()=>{
  const h=harness();try{
    const [x,y]=BASE_POINTS.metal;
    h.pointer('pointerdown',1,x,y,'touch');h.pointer('pointerup',1,x,y,'touch');
    assert.ok(h.root.querySelector('.wx-detail-head'));assert.equal(h.root.querySelector('.wx-panel-layer').hidden,false);
    assert.deepEqual(slotNames(h),[]);assert.equal(h.root.querySelector('.wx-dock').hidden,true);
    h.pointer('pointerdown',2,x,y,'touch');h.pointer('pointerup',2,x,y,'touch');
    h.root.querySelector('.wx-canvas').dispatchEvent(new h.window.MouseEvent('dblclick',{clientX:x,clientY:y,bubbles:true}));
    assert.deepEqual(slotNames(h),[]);assert.equal(h.calls.combine.length,0);
    clickText(h.root,'加入合成台');assert.equal(h.root.querySelector('.wx-panel-layer').hidden,true);assert.deepEqual(slotNames(h),['金']);
    h.pointer('pointerdown',3,x,y);h.pointer('pointerup',3,x,y);assert.deepEqual(slotNames(h),['金','金']);
    h.root.querySelector('.wx-canvas').dispatchEvent(new h.window.MouseEvent('dblclick',{clientX:x,clientY:y,bubbles:true}));
    assert.equal(h.root.querySelector('.wx-panel-layer').hidden,true,'选材模式的快速连点不能再抢去打开详情');
    clickText(h.root,'收起 ▾');h.pointer('pointerdown',4,x,y);h.pointer('pointerup',4,x,y);
    assert.equal(h.root.querySelector('.wx-panel-layer').hidden,false);assert.deepEqual(slotNames(h),['金','金']);
  }finally{h.close();}
});

test('多卡材料满额后从详情加入仍保留原四张，不关闭详情或替换材料',()=>{
  const h=harness();try{
    for(let i=0;i<4;i++)pick(h,'metal',i+1);
    clickText(h.root,'收起 ▾');const [x,y]=BASE_POINTS.wood;h.pointer('pointerdown',5,x,y);h.pointer('pointerup',5,x,y);
    clickText(h.root,'加入合成台');assert.deepEqual(slotNames(h),['金','金','金','金']);assert.equal(h.root.querySelector('.wx-panel-layer').hidden,false);assert.match(h.root.querySelector('.wx-toast').textContent,/最多放入四张/);
  }finally{h.close();}
});

test('存档提示在设置内可见，选择时禁止连续打开文件窗口，待保存时说明导出范围',()=>{
  const h=harness();try{
    h.view.openSettings();clickText(h.root,'导出存档');assert.equal(h.calls.export,1);
    h.render({busy:'export',fileFeedback:null});clickText(h.root,'导出存档');clickText(h.root,'导入存档');
    assert.equal(h.calls.export,1);assert.equal(h.calls.import,0);assert.match(h.root.querySelector('.wx-file-feedback').textContent,/选择导出位置/);
    h.render({busy:false,fileFeedback:{action:'export',kind:'success',message:'存档已导出。'}});assert.match(h.root.querySelector('.wx-file-feedback').textContent,/存档已导出/);
    h.render({fileFeedback:{action:'import',kind:'error',message:'存档内容不完整。'}});assert.equal(h.root.querySelector('.wx-file-feedback').getAttribute('role'),'alert');
    h.render({canRetrySave:true,fileFeedback:null});assert.match(h.root.querySelector('.wx-dialog').textContent,/导出只包含之前已保存的进度/);
    const importButton=[...h.root.querySelectorAll('button')].find(b=>b.textContent==='导入存档');assert.equal(importButton.disabled,true);
  }finally{h.close();}
});

const knownSave=()=>commitSynthesis(createNewSave({id:'local-access-save',now:'2026-10-26T00:00:00.000Z'}),{operationId:'known-operation',ingredientIds:['base:metal','base:wood'],result:{name:'工具',emoji:'🛠️',category:'科技',description:'让双手更有办法。'},now:'2026-10-26T00:00:01.000Z'}).save;

test('主页只显示当前档的发现种数，重复配方不多算，返回和切档后更新',()=>{
  const h=harness({stayHome:true});try{
    const home=h.root.querySelector('.wx-home'),number=home.querySelector('.wx-home-number');
    assert.equal(home.hidden,false);assert.equal(number.textContent,'0');
    assert.equal(home.querySelector('canvas'),null);
    const once=knownSave();
    const twice=commitSynthesis(once,{operationId:'repeat',ingredientIds:['base:metal','base:wood'],result:TEST_RESULT,now:'2026-10-27T00:00:00Z'}).save;
    h.render({save:twice,saveEpoch:1});
    h.frame(100);h.frame(1600);assert.equal(twice.stats.synthesisCount,2);assert.equal(number.textContent,'1');
    clickText(home,'🏭 进入工厂');assert.equal(home.hidden,true);
    clickText(h.root,'☰ 更多');clickText(h.root,'返回主页');assert.equal(home.hidden,false);
    clickText(home,'🧩 Mod');assert.equal(home.inert,true);h.root.querySelector('.wx-dialog .wx-close').click();assert.equal(home.inert,false);
    h.render({save:createNewSave({id:'fresh-home',now:TEST_TIME}),saveEpoch:2});
    assert.equal(number.textContent,'0');assert.equal(h.calls.combine.length,0);assert.equal(h.calls.configure.length,0);
  }finally{h.close();}
});

test('首页厂牌和彩蛋只改变画面，可归位；版本纸条关闭后仍在首页',()=>{
  const h=harness({stayHome:true});try{
    const home=h.root.querySelector('.wx-home'),title=home.querySelector('.wx-home-title');
    for(let i=0;i<6;i++)title.click();
    assert.equal(title.classList.contains('fallen'),true);title.click();
    assert.equal(title.classList.contains('fallen'),false);
    home.querySelector('.wx-home-gold').click();assert.match(home.querySelector('.wx-home-bubble').textContent,/金色工厂/);
    for(let i=0;i<3;i++)home.querySelector('.wx-home-version').click();
    assert.equal(home.querySelector('dialog').open,true);clickText(home,'收好纸条');assert.equal(home.querySelector('dialog').open,false);
    assert.equal(home.hidden,false);assert.equal(h.calls.layouts.length,0);
  }finally{h.close();}
});

test('新档不能跳过首次配置，有进度的旧档可先看本地卡牌并导出',()=>{
  const fresh=harness({configured:false});try{assert.equal(fresh.root.querySelector('.wx-local-access').hidden,true);fresh.root.querySelector('.wx-local-access').click();assert.equal(fresh.root.querySelector('.wx-modal-layer').hidden,false);}finally{fresh.close();}
  const h=harness({configured:false,initialSave:knownSave()});try{
    h.render({error:'无法读取这台设备保存的 Key，请重新配置。'});
    assert.equal(h.root.querySelector('.wx-local-access').hidden,false);clickText(h.root,'先查看本地卡牌');
    assert.equal(h.root.querySelector('.wx-modal-layer').hidden,true);assert.equal(h.root.querySelector('.wx-more').disabled,false);
    assert.equal(h.root.querySelectorAll('.wx-card-tile').length,6);h.view.openSettings();clickText(h.root,'导出存档');assert.equal(h.calls.export,1);
    assert.match(h.root.querySelector('.wx-dialog').textContent,/已知配方仍可合成/);
    assert.equal(h.calls.configure.length,0);assert.equal(h.calls.combine.length,0);
  }finally{h.close();}
});

test('本地模式允许已知配方，未知配方先配置且保留完整选材',()=>{
  const h=harness({configured:false,initialSave:knownSave()});try{
    clickText(h.root,'先查看本地卡牌');clickText(h.root,'🏭 进入工厂');pick(h,'metal',1);pick(h,'wood',2);clickText(h.root,'合成');
    assert.deepEqual(h.calls.combine,[['base:metal','base:wood']]);assert.equal(h.root.querySelector('.wx-modal-layer').hidden,true);
  }finally{h.close();}
  const unknown=harness({configured:false,initialSave:knownSave()});try{
    clickText(unknown.root,'先查看本地卡牌');clickText(unknown.root,'🏭 进入工厂');pick(unknown,'water',1);pick(unknown,'fire',2);clickText(unknown.root,'合成');
    assert.equal(unknown.calls.combine.length,0);assert.equal(unknown.root.querySelector('.wx-modal-layer').hidden,false);assert.deepEqual(slotNames(unknown),['水','火']);
    unknown.root.querySelector('.wx-api-close').click();assert.equal(unknown.root.querySelector('.wx-modal-layer').hidden,true);assert.deepEqual(slotNames(unknown),['水','火']);
    assert.equal(unknown.calls.configure.length,0,'不因查看本地卡牌或关配置框自动检测');
  }finally{unknown.close();}
});
