import test from 'node:test';
import assert from 'node:assert/strict';
import { createFactoryCanvas } from '../src/ui/canvas.js';
import { BASE_CARDS } from '../src/content/catalog.js';

// 这里只验证输入生命周期及事件结果；真实绘制、浏览器和手机手势另验。
class Target {
  constructor(){this.events=new Map();this.hidden=false;}
  addEventListener(name,fn){const list=this.events.get(name)||[];list.push(fn);this.events.set(name,list);}
  removeEventListener(name,fn){this.events.set(name,(this.events.get(name)||[]).filter(x=>x!==fn));}
  emit(name,event){for(const fn of this.events.get(name)||[])fn(event);}
}
globalThis.document=new Target();globalThis.window={devicePixelRatio:1};
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
globalThis.ResizeObserver=class{observe(){}disconnect(){}};

// 固定存档位置使手势回归独立于正式开局的摆放方案；各卡中心对应原有测试坐标。
const FIXTURE_LAYOUT=[
  {id:'table:metal',cardId:'base:metal',x:-232,y:0,pinned:false},
  {id:'table:wood',cardId:'base:wood',x:-116,y:0,pinned:false},
  {id:'table:water',cardId:'base:water',x:0,y:0,pinned:false},
  {id:'table:fire',cardId:'base:fire',x:116,y:0,pinned:false},
  {id:'table:earth',cardId:'base:earth',x:232,y:0,pinned:false},
];

function harness(rect={left:0,top:0,width:960,height:540},{layout=FIXTURE_LAYOUT,isDictionaryDrop}={}){
  const canvas=new Target(),capture=new Set();canvas.getContext=()=>({});canvas.clientWidth=960;canvas.clientHeight=540;canvas.getBoundingClientRect=()=>({...rect});
  canvas.setPointerCapture=id=>capture.add(id);canvas.hasPointerCapture=id=>capture.has(id);canvas.releasePointerCapture=id=>capture.delete(id);
  const calls={combine:[],pick:[],layout:[],zoom:[]};
  const board=createFactoryCanvas(canvas,{onCombine:x=>calls.combine.push(x),onPick:x=>calls.pick.push(x),onLayoutChange:x=>calls.layout.push(x),onZoomChange:x=>calls.zoom.push(x),isDictionaryDrop});
  const save={id:'pointer-fixture',revision:0,cards:BASE_CARDS.map(c=>({...c})),layout:layout.map(n=>({...n})),preferences:{soundEnabled:false,zoom:1}};
  board.update({save,enabled:true});
  return {board,calls,canvas,save,emit(name,id,x,y){canvas.emit(name,{pointerId:id,button:0,clientX:x,clientY:y,preventDefault(){}});}};
}

test('可以重复点选同一材料，不被UI去重',()=>{
  const h=harness();try{h.emit('pointerdown',1,248,270);h.emit('pointerup',1,248,270);h.emit('pointerdown',2,248,270);h.emit('pointerup',2,248,270);assert.deepEqual(h.calls.pick,['base:metal','base:metal']);}finally{h.board.destroy();}
});

test('窄屏过渡临时零宽不清空位图，尺寸恢复后仍能按原位置点卡',()=>{
  const rect={left:0,top:0,width:960,height:540},h=harness(rect);
  try{
    const size=[h.canvas.width,h.canvas.height];
    rect.width=0;h.board.resize();
    assert.deepEqual([h.canvas.width,h.canvas.height],size);
    assert.ok(h.canvas.width>0&&h.canvas.height>0);
    rect.width=960;h.board.resize();
    h.emit('pointerdown',1,248,270);h.emit('pointerup',1,248,270);
    assert.deepEqual(h.calls.pick,['base:metal']);assert.equal(h.calls.layout.length,0);
  }finally{h.board.destroy();}
});
test('拖叠两卡只提交一次合成，不把重叠位置误保存',()=>{
  const h=harness();try{h.emit('pointerdown',1,248,270);h.emit('pointermove',1,364,270);h.emit('pointerup',1,364,270);assert.deepEqual(h.calls.combine,[['base:wood','base:metal']]);assert.equal(h.calls.layout.length,0);}finally{h.board.destroy();}
});
test('pointercancel不合成、不保存半途布局，归位动画另验',()=>{
  const h=harness();try{h.emit('pointerdown',1,248,270);h.emit('pointermove',1,364,270);h.emit('pointercancel',1,364,270);assert.equal(h.calls.combine.length,0);assert.equal(h.calls.layout.length,0);assert.equal(h.calls.pick.length,0);}finally{h.board.destroy();}
});
test('两指缩放过程与抬指不会变成点击或合成',()=>{
  const h=harness();try{h.emit('pointerdown',1,248,270);h.emit('pointerdown',2,712,270);h.emit('pointermove',1,364,270);h.emit('pointerup',1,364,270);h.emit('pointerup',2,712,270);assert.equal(h.calls.combine.length,0);assert.equal(h.calls.pick.length,0);assert.equal(h.calls.zoom.length,1);}finally{h.board.destroy();}
});
test('自由拖动提交实际布局，不请求合成',()=>{
  const h=harness();try{h.emit('pointerdown',1,248,270);h.emit('pointermove',1,248,440);h.emit('pointerup',1,248,440);assert.equal(h.calls.layout.length,1);assert.equal(h.calls.combine.length,0);assert.equal(h.calls.layout[0].find(n=>n.cardId==='base:metal').y,170);}finally{h.board.destroy();}
});

test('CSS放大两倍且带页面偏移时，实际pointer坐标仍命中原卡并保存逻辑位置',()=>{
  const h=harness({left:137,top:83,width:1920,height:1080});
  try{
    // 逻辑位置(248,270)实际显示在(633,623)，使用浏览器事件的client坐标。
    h.emit('pointerdown',1,633,623);h.emit('pointerup',1,633,623);
    assert.deepEqual(h.calls.pick,['base:metal']);
    h.emit('pointerdown',2,633,623);h.emit('pointermove',2,633,963);h.emit('pointerup',2,633,963);
    assert.equal(h.calls.layout.length,1);assert.equal(h.calls.combine.length,0);
    assert.deepEqual(h.calls.layout[0].find(n=>n.cardId==='base:metal'),{id:'table:metal',cardId:'base:metal',x:-232,y:170,pinned:false});
    // 从新位置拖回木卡中心(364,270)，不能把CSS放大倍数写进存档。
    h.emit('pointerdown',3,633,963);h.emit('pointermove',3,865,623);h.emit('pointerup',3,865,623);
    assert.deepEqual(h.calls.combine,[['base:wood','base:metal']]);assert.equal(h.calls.layout.length,1);
  }finally{h.board.destroy();}
});

test('整理就近对齐世界网格，保留两组材料和钉住卡，不随视角重新排队',()=>{
  const layout=[
    {...FIXTURE_LAYOUT[0],x:-420,y:-105},
    {...FIXTURE_LAYOUT[1],x:-326,y:-105},
    {...FIXTURE_LAYOUT[2],x:320,y:135},
    {...FIXTURE_LAYOUT[3],x:412,y:135},
    {...FIXTURE_LAYOUT[4],x:101,y:21,pinned:true},
  ];
  const h=harness(undefined,{layout});
  try{
    h.board.arrange();
    const arranged=h.calls.layout.at(-1);
    assert.equal(arranged.length,layout.length);
    for(const original of layout){
      const node=arranged.find(n=>n.id===original.id);
      if(original.pinned){assert.deepEqual(node,original);continue;}
      assert.ok(Math.abs(node.x-original.x)<=46,'就近整理不能把左边一组挪去右边');
      assert.ok(Math.abs(node.y-original.y)<=58);
      assert.equal(node.x/92,Math.round(node.x/92));
      assert.equal(node.y/116,Math.round(node.y/116));
    }
    assert.equal(new Set(arranged.map(n=>`${n.x},${n.y}`)).size,arranged.length);
    // 空白平移只改变观察位置；再次整理不能把同一批材料吸到屏幕中央。
    h.emit('pointerdown',1,900,490);h.emit('pointermove',1,1030,520);h.emit('pointerup',1,1030,520);
    h.board.arrange();assert.deepEqual(h.calls.layout.at(-1),arranged);
    assert.equal(h.calls.combine.length,0);
  }finally{h.board.destroy();}
});

test('连续从词典取出材料保留独立实例并散放，不再每五张叠回同一点',()=>{
  const h=harness(),originalRandom=Math.random;let randomState=127;
  Math.random=()=>{randomState=(randomState*48271)%2147483647;return randomState/2147483647;};
  try{
    const discovered=structuredClone(h.save.cards);
    for(let i=0;i<10;i++)h.board.addCard('base:metal');
    const additions=h.calls.layout.at(-1).filter(n=>!FIXTURE_LAYOUT.some(original=>original.id===n.id));
    assert.equal(additions.length,10);assert.equal(new Set(additions.map(n=>n.id)).size,10);
    assert.ok(new Set(additions.map(n=>`${n.x},${n.y}`)).size>5,'第六张不能回到第一张的固定循环位置');
    assert.ok(additions.some(n=>n.x!==n.y),'散放不能退化为同一条对角线上的五个点');
    assert.deepEqual(h.save.cards,discovered,'取出材料不能重新创建已发现卡牌');
    assert.equal(h.calls.combine.length,0);
  }finally{Math.random=originalRandom;h.board.destroy();}
});

test('拖回词典按真实client坐标收起指定实例，保留同名副本和已发现卡牌',()=>{
  const drops=[],layout=[...FIXTURE_LAYOUT,{id:'table:metal-copy',cardId:'base:metal',x:400,y:0,pinned:false}];
  const h=harness({left:137,top:83,width:1920,height:1080},{layout,isDictionaryDrop(point){drops.push({...point});return point.clientX>=1700;}});
  try{
    const discovered=structuredClone(h.save.cards);
    h.emit('pointerdown',1,633,623);h.emit('pointermove',1,1800,800);h.emit('pointerup',1,1800,800);
    assert.ok(drops.some(point=>point.clientX===1800&&point.clientY===800),'词典热区使用界面坐标，不能误传画布逻辑坐标');
    assert.equal(h.calls.layout.length,1);
    const remaining=h.calls.layout[0];
    assert.equal(remaining.length,layout.length-1);assert.ok(!remaining.some(n=>n.id==='table:metal'));
    assert.ok(remaining.some(n=>n.id==='table:metal-copy'));
    assert.deepEqual(h.save.cards,discovered);assert.equal(h.calls.combine.length,0);
  }finally{h.board.destroy();}
});

test('在词典区域取消拖动保留实例，不把取消当作收卡',()=>{
  const h=harness(undefined,{isDictionaryDrop:()=>true});
  try{
    h.emit('pointerdown',1,248,270);h.emit('pointermove',1,900,400);h.emit('pointercancel',1,900,400);
    assert.equal(h.calls.layout.length,0);assert.equal(h.calls.combine.length,0);
    h.board.addCard('base:water');
    assert.equal(h.calls.layout.at(-1).length,FIXTURE_LAYOUT.length+1);
    assert.ok(h.calls.layout.at(-1).some(n=>n.id==='table:metal'));
  }finally{h.board.destroy();}
});
