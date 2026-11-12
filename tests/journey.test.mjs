import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createAppView } from '../src/ui/app-view.js';
import { createController } from '../src/controller.js';
import { validateSave } from '../src/core/model.js';

const copy=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<30;i++){if(predicate())return;await tick();}assert.ok(predicate(),'状态未按预期完成');}
let session=0;

// 连接真实 controller + view + canvas。只替换设备和模型边界，不改产品内部状态。
async function game(initial=null,configured=false){
  const window=new Window({url:'https://app.local/'}),document=window.document;
  const frames=new Map(),captures=new WeakMap();let frameId=0,frameTime=performance.now(),disk=copy(initial),sequence=0;
  Object.assign(globalThis,{window,document,ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)});
  const gradient={addColorStop(){}};
  const context=new Proxy({measureText:text=>({width:Array.from(text).length*7}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(o,k)=>o[k]||(()=>{})});
  window.HTMLCanvasElement.prototype.getContext=()=>context;
  window.HTMLCanvasElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:633.6,height:540});
  window.HTMLCanvasElement.prototype.setPointerCapture=function(id){let ids=captures.get(this);if(!ids){ids=new Set();captures.set(this,ids);}ids.add(id);};
  window.HTMLCanvasElement.prototype.hasPointerCapture=function(id){return captures.get(this)?.has(id)||false;};
  window.HTMLCanvasElement.prototype.releasePointerCapture=function(id){captures.get(this)?.delete(id);};
  const root=document.createElement('div');root.getBoundingClientRect=()=>({left:0,top:0,width:960,height:540});document.body.append(root);
  const response=deferred(),exported=deferred(),calls={generate:0,configure:0,exports:0};
  const platform={mode:'native',async load(){return copy(disk);},async initialize(save){assert.equal(disk,null);disk=validateSave(save);return copy(disk);},
    async save(save,revision){assert.equal(revision,disk.revision);disk=validateSave(save);return copy(disk);},
    async configStatus(){return {configured,baseUrl:'https://example.invalid',model:'fixture'};},
    async configure(config){assert.equal(config.key,'local-fixture');calls.configure++;configured=true;return this.configStatus();},
    async generate(){calls.generate++;return response.promise;},async cancel(){},
    async exportSave(){calls.exports++;await exported.promise;return true;},async readImport(){return null;},
  };
  let view;const sessionId=++session;
  const controller=createController(platform,state=>view.render(state),{now:()=>new Date().toISOString(),uuid:()=>`journey:${sessionId}:${++sequence}`});
  view=createAppView(root,controller.callbacks);await controller.start();
  const click=text=>{const button=[...root.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,`找不到按钮：${text}`);button.click();};
  const points={metal:[128.8,190],wood:[288.8,120],water:[448.8,220],fire:[208.8,360]};
  return {root,view,controller,calls,response,exported,click,
    get disk(){return copy(disk);},
    tap(base){const saved=initial?.layout?.find(n=>n.cardId===`base:${base}`);const [x,y]=saved?[633.6/2+saved.x,270+saved.y]:points[base];
      for(const type of ['pointerdown','pointerup'])root.querySelector('.wx-canvas').dispatchEvent(new window.PointerEvent(type,{pointerId:1,button:0,pointerType:'touch',clientX:x,clientY:y,bubbles:true,cancelable:true}));},
    frame(){frameTime=Math.max(frameTime+1000,performance.now()+1000);const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(frameTime));},
    close(){view.destroy();window.happyDOM.abort();},
  };
}

test('真实前端闭环：首次检测→选材→等待→提交揭晓→详情→导出→无Key重开与缓存合成',async()=>{
  let snapshot;
  const first=await game();try{
    assert.equal(first.disk.cards.length,5);assert.equal(first.disk.recipes.length,0);
    first.root.querySelector('input[name="api-key"]').value='local-fixture';first.click('检测并开始');await until(()=>first.controller.state.configStatus.configured&&!first.controller.state.busy);
    assert.equal(first.calls.configure,1);assert.equal(first.disk.cards.length,5,'检测不能生成卡牌');
    first.click('🏭 进入工厂');first.click('🔧 多卡合成台');first.tap('metal');first.tap('wood');first.click('合成');
    assert.equal(first.calls.generate,1);assert.equal(first.controller.state.synthesis.phase,'requesting');first.frame();
    assert.equal(first.root.querySelector('.wx-result-status').textContent,'');assert.equal(first.disk.stats.synthesisCount,0);
    first.response.resolve({name:'工具',emoji:'🛠️',category:'科技',description:'让双手更有办法。'});
    await until(()=>first.controller.state.synthesis.phase==='committed'&&!first.controller.state.busy);
    assert.equal(first.root.querySelector('.wx-result-status').textContent,'');first.frame();
    await until(()=>first.disk.layout.length===6);
    assert.match(first.root.querySelector('.wx-result-status').textContent,/工具/);assert.equal(first.disk.stats.synthesisCount,1);
    // 结果在台面局部反馈，详情沿用词典右键入口，不再依赖常驻结果条。
    const resultTile=first.root.querySelector('.wx-card-tile[title="工具"]');assert.ok(resultTile);
    resultTile.dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    assert.match(first.root.querySelector('.wx-detail-head').textContent,/工具/);
    first.view.openSettings();first.click('导出存档');await until(()=>first.calls.exports===1);
    first.click('导出存档');assert.equal(first.calls.exports,1);assert.equal(first.controller.state.busy,'export');
    first.exported.resolve();await until(()=>!first.controller.state.busy);
    assert.match(first.root.querySelector('.wx-file-feedback').textContent,/存档已导出/);snapshot=first.disk;
  }finally{first.close();}
  const reopened=await game(snapshot,false);try{
    assert.equal(reopened.root.querySelector('.wx-modal-layer').hidden,false);reopened.click('先查看本地卡牌');
    assert.equal(reopened.root.querySelector('.wx-modal-layer').hidden,true);
    reopened.click('🏭 进入工厂');reopened.click('🔧 多卡合成台');reopened.tap('metal');reopened.tap('wood');reopened.click('合成');
    await until(()=>reopened.controller.state.synthesis?.phase==='committed'&&!reopened.controller.state.busy);reopened.frame();
    await until(()=>reopened.disk.layout.length===7);
    assert.equal(reopened.calls.generate,0);assert.equal(reopened.calls.configure,0);assert.equal(reopened.disk.stats.synthesisCount,2);
    reopened.tap('water');reopened.tap('fire');reopened.click('合成');
    assert.equal(reopened.calls.generate,0);assert.equal(reopened.root.querySelector('.wx-modal-layer').hidden,false);
    assert.deepEqual([...reopened.root.querySelectorAll('.wx-slot-name')].map(n=>n.textContent),['水','火']);
    assert.equal(reopened.disk.stats.synthesisCount,2);
  }finally{reopened.close();}
});
