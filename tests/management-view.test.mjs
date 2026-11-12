import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createManagementView } from '../src/ui/management-view.js';
import { createNewSave, commitSynthesis } from '../src/core/model.js';

function harness(configured=true){
  const window=new Window({url:'https://app.local/'}),document=window.document;
  Object.assign(globalThis,{window,document,ResizeObserver:class{observe(){}disconnect(){}}});
  const root=document.createElement('div');document.body.append(root);
  root.getBoundingClientRect=()=>({width:960,height:540});
  const calls={configure:[],retry:0,cards:[],preferences:[],create:[],switch:[]};
  const state={save:createNewSave({id:'manager-fixture',now:'2026-11-13T00:00:00Z'}),configStatus:{configured},busy:false,error:''};
  const view=createManagementView(root,{
    onConfigure:v=>calls.configure.push({...v}),onRetrySave:()=>calls.retry++,
    onSavePreferences:v=>calls.preferences.push(v),onCreateSlot:n=>calls.create.push(n),onSwitchSlot:id=>calls.switch.push(id),
  },{onAddCard:id=>calls.cards.push(id)});
  view.render(state);
  return {root,window,document,view,state,calls,render(patch){Object.assign(state,patch);view.render(state);},close(){view.destroy();window.happyDOM.abort();}};
}
const click=(h,label)=>{const b=[...h.root.querySelectorAll('button')].find(b=>b.textContent===label&&!b.closest('[hidden]'));assert.ok(b,label);b.click();};

test('新档只展示 API 配置，检测不修改五本源与零配方',async()=>{
  const h=harness(false);try{
    assert.equal(h.view.isModalOpen(),true);
    assert.equal(h.root.querySelector('input[name="api-key"]').value,'');
    assert.equal(h.state.save.cards.length,5);assert.equal(h.state.save.recipes.length,0);
    h.root.querySelector('input[name="api-key"]').value='fixture-key';
    const form=h.root.querySelector('.wx-api-dialog');
    form.dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(h.calls.configure.length,1);
    h.render({configStatus:{configured:true}});
    await Promise.resolve();
    assert.equal(h.view.isModalOpen(),false);assert.equal(h.root.querySelector('input[name="api-key"]').value,'');
    assert.equal(h.state.save.stats.synthesisCount,0);assert.equal(h.state.save.cards.length,5);
    assert.equal(h.root.querySelector('canvas'),null);
  }finally{h.close();}
});

test('提示词草稿在异步状态与关闭返回后保留，切档重新读取',()=>{
  const h=harness();try{
    h.view.open('prompt');const editor=h.root.querySelector('textarea');
    editor.value='只合成海洋生物。';editor.dispatchEvent(new h.window.Event('input'));editor.focus();editor.setSelectionRange(2,6);
    h.render({busy:'combine'});
    assert.equal(h.root.querySelector('textarea'),editor);assert.equal(h.document.activeElement,editor);
    assert.equal(editor.selectionStart,2);assert.equal(h.root.querySelector('.wx-prompt-save').disabled,true);
    h.root.querySelector('.wx-close').click();h.view.open('prompt');
    assert.equal(h.root.querySelector('textarea').value,'只合成海洋生物。');
    const next=createNewSave({id:'other',now:'2026-11-13T00:00:00Z'});next.preferences.synthesisPrompt='森林。';
    h.render({save:next,saveEpoch:1,busy:false});
    assert.equal(h.root.querySelector('textarea').value,'森林。');assert.equal(h.calls.preferences.length,0);
  }finally{h.close();}
});

test('配方与历史的放回操作传稳定卡牌身份，保存失败仍可关闭并重试保存',()=>{
  const h=harness();try{
    h.view.open('recipes');assert.match(h.root.textContent,/还没有发现配方/);
    const saved=commitSynthesis(h.state.save,{operationId:'history-one',ingredientIds:['base:metal','base:metal'],result:{name:'工具',emoji:'🛠️',category:'科技',description:'帮助双手做事。'},now:'2026-11-13T00:00:01Z'}).save;
    h.render({save:saved});
    click(h,'🛠️ 工具');
    assert.deepEqual(h.calls.cards,[saved.cards.find(c=>c.name==='工具').id]);
    assert.equal(h.view.isModalOpen(),false);
    h.view.open('history');assert.match(h.root.textContent,/工具/);h.root.querySelector('.wx-close').click();
    h.render({error:'磁盘不可用',canRetrySave:true});
    assert.equal(h.view.isModalOpen(),false);click(h,'重试保存');assert.equal(h.calls.retry,1);
    h.view.open('settings');h.root.querySelector('.wx-close').click();assert.equal(h.view.isModalOpen(),false);
  }finally{h.close();}
});

test('画布按下打开管理页后的松手不关闭，主动点背景才关闭',()=>{
  const h=harness();try{
    h.view.open('settings');
    const backdrop=h.root.querySelector('.wx-panel-layer');
    backdrop.click();
    assert.equal(h.view.isModalOpen(),true);
    backdrop.dispatchEvent(new h.window.PointerEvent('pointerdown',{bubbles:true}));
    backdrop.click();
    assert.equal(h.view.isModalOpen(),false);
    h.view.open('mods');
    h.root.querySelector('.wx-dialog').dispatchEvent(new h.window.PointerEvent('pointerdown',{bubbles:true}));
    backdrop.click();
    assert.equal(h.view.isModalOpen(),true);
  }finally{h.close();}
});
