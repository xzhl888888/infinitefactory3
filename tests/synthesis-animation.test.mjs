import test from 'node:test';
import assert from 'node:assert/strict';
import { createFactoryCanvas } from '../src/ui/canvas.js';
import { createNewSave } from '../src/core/model.js';

const FRAME = 1000 / 60;
const copy = value => structuredClone(value);
const INGREDIENTS = ['base:metal', 'base:wood'];
const RESULT = { id: 'card:tool', name: '工具', emoji: '🛠️', category: '科技', description: '让双手更有办法。', isBase: false, discoveredAt: '2026-10-26T10:00:00.000Z' };
const LAYOUT = [
  { id: 'table:metal', cardId: 'base:metal', x: -232, y: 0, pinned: false },
  { id: 'table:wood', cardId: 'base:wood', x: -116, y: 0, pinned: false },
  { id: 'table:water', cardId: 'base:water', x: 0, y: 0, pinned: false },
  { id: 'table:fire', cardId: 'base:fire', x: 116, y: 0, pinned: false },
  { id: 'table:earth', cardId: 'base:earth', x: 232, y: 0, pinned: false },
];

class Target {
  constructor() { this.events = new Map(); this.hidden = false; }
  addEventListener(name, fn) { const items = this.events.get(name) || []; items.push(fn); this.events.set(name, items); }
  removeEventListener(name, fn) { this.events.set(name, (this.events.get(name) || []).filter(item => item !== fn)); }
  emit(name, event) { for (const fn of this.events.get(name) || []) fn(event); }
}

function multiply(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
const fontSize = font => Number(String(font).match(/([\d.]+)px/)?.[1] || 10);

// 运行真实 card-art/effects 绘制，仅替代浏览器画布。文字记录携带完整变换，
// 因而能验证卡牌实际画在哪里、缩放多少，而非直接读取动画内部变量。
function recordingContext() {
  let values = { globalAlpha: 1, font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000' };
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [], records = [];
  const record = (name, args) => records.push({ name, args: [...args], matrix: [...matrix], alpha: values.globalAlpha, font: values.font });
  const methods = {
    save() { stack.push({ values: { ...values }, matrix: [...matrix] }); },
    restore() { const saved = stack.pop(); assert.ok(saved, '真实绘制的 save/restore 应配对'); values = saved.values; matrix = saved.matrix; },
    setTransform(...args) { matrix = [...args]; record('setTransform', args); },
    resetTransform() { matrix = [1, 0, 0, 1, 0, 0]; },
    translate(x, y) { matrix = multiply(matrix, [1, 0, 0, 1, x, y]); record('translate', [x, y]); },
    scale(x, y) { matrix = multiply(matrix, [x, 0, 0, y, 0, 0]); record('scale', [x, y]); },
    rotate(angle) { const c = Math.cos(angle), s = Math.sin(angle); matrix = multiply(matrix, [c, s, -s, c, 0, 0]); record('rotate', [angle]); },
    transform(...args) { matrix = multiply(matrix, args); record('transform', args); },
    measureText(text) { const size = fontSize(values.font); return { width: [...String(text)].reduce((sum, char) => sum + (/^[\x00-\x7f]$/.test(char) ? .56 : 1) * size, 0) }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createConicGradient() { return { addColorStop() {} }; },
    createPattern() { return {}; },
  };
  const ctx = new Proxy({}, {
    get(_, key) { if (key in methods) return methods[key]; if (key in values) return values[key]; return (...args) => record(key, args); },
    set(_, key, value) { values[key] = value; return true; },
  });
  return { ctx, records, assertBalanced() { assert.equal(stack.length, 0); } };
}

function harness({ reduceMotion = false, layout = LAYOUT, extraCards = [], onCombine, isDictionaryDrop } = {}) {
  const prior = new Map(['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let now = 0, nextFrame = 0, displayed = [], operationSequence = 0, paintCount = 0, frameCount = 0, state;
  const rafs = new Map(), document = new Target(), recording = recordingContext(), canvas = new Target(), capture = new Set();
  document.createElement = tag => { assert.equal(tag, 'canvas'); return { width: 0, height: 0, getContext: () => recordingContext().ctx }; };
  Object.assign(globalThis, {
    document, window: { devicePixelRatio: 1 },
    requestAnimationFrame: fn => { const id = ++nextFrame; rafs.set(id, fn); return id; },
    cancelAnimationFrame: id => rafs.delete(id), ResizeObserver: class { observe() {} disconnect() {} },
  });
  Object.assign(canvas, { clientWidth: 960, clientHeight: 540, getContext: () => recording.ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.clientWidth, height: canvas.clientHeight }) });
  let pixelWidth=0,pixelHeight=0;
  // 浏览器设置位图尺寸会立即清掉像素；只检查下一次RAF会漏掉抽屉过渡中的空白帧。
  const clearBitmap=()=>{displayed=[];recording.records.length=0;};
  Object.defineProperties(canvas,{
    width:{get:()=>pixelWidth,set:value=>{pixelWidth=value;clearBitmap();}},
    height:{get:()=>pixelHeight,set:value=>{pixelHeight=value;clearBitmap();}},
  });
  canvas.setPointerCapture = id => capture.add(id); canvas.hasPointerCapture = id => capture.has(id);
  canvas.releasePointerCapture = id => { capture.delete(id); canvas.emit('lostpointercapture', { pointerId: id }); };
  const calls = { combine: [], pick: [], layout: [], reveal: [], busy: [] };
  const update = patch => { state = { ...state, ...patch }; board.update(state); };
  const begin = (source = 'ai', { prepare = true, ids = INGREDIENTS } = {}) => {
    if (prepare) assert.equal(board.prepareSynthesis(ids), true);
    const id = `animation:${++operationSequence}`;
    update({ synthesis: { id, ingredientIds: [...ids], source, phase: 'requesting' }, busy: 'combine', lastResult: null });
    return id;
  };
  const board = createFactoryCanvas(canvas, {
    onCombine(ids) { calls.combine.push([...ids]); if (onCombine) onCombine({ ids, begin, update }); },
    onPick(id) { calls.pick.push(id); }, onLayoutChange(value) { calls.layout.push(copy(value)); },
    onReveal(result) { calls.reveal.push({ at: now, result: copy(result) }); }, onPresentationBusy(value) { calls.busy.push({ at: now, value }); },
    isDictionaryDrop,
  }, { now: () => now });
  const save = createNewSave({ id: 'animation-fixture', now: '2026-10-26T10:00:00.000Z' });
  save.cards.push(...copy(extraCards)); save.layout = copy(layout); save.preferences = { ...save.preferences, soundEnabled: false, reduceMotion, zoom: 1 };
  update({ save, enabled: true, busy: false, synthesis: null, lastResult: null });
  function frameAt(time) {
    assert.ok(time >= now, '测试时钟只能前进'); now = time;
    const pending = [...rafs.values()]; rafs.clear(); assert.equal(pending.length, 1, '通过真实 requestAnimationFrame 链推进');
    recording.records.length = 0; frameCount++; pending[0](now); recording.assertBalanced();
    if (recording.records.some(record => record.name === 'clearRect')) { paintCount++; displayed = copy(recording.records); }
    return displayed;
  }
  return {
    board, calls, begin, update,
    get now() { return now; }, get state() { return state; }, get paintCount() { return paintCount; }, get frameCount() { return frameCount; },
    frameAt,
    advance(ms) { const target = now + ms; while (now + FRAME < target - .0001) frameAt(now + FRAME); return frameAt(target); },
    phase(phase) { update({ synthesis: { ...state.synthesis, phase }, busy: phase === 'requesting' ? 'combine' : phase === 'saving' ? 'save' : false }); },
    commit({ card = RESULT, isNewCard = true, operationId = state.synthesis.id } = {}) {
      const next = copy(state.save); next.revision++; next.stats.synthesisCount++;
      if (!next.cards.some(existing => existing.id === card.id)) next.cards.push(copy(card));
      update({ save: next, synthesis: { ...state.synthesis, phase: 'committed' }, busy: false, lastResult: { operationId, card: copy(card), isNewCard, isNewRecipe: true } });
    },
    acknowledgeLayout() { update({ save: { ...copy(state.save), revision: state.save.revision + 1, layout: copy(calls.layout.at(-1)) } }); },
    resize(width,height=canvas.clientHeight) {
      recording.records.length=0;canvas.clientWidth=width;canvas.clientHeight=height;board.resize();recording.assertBalanced();
      if(recording.records.some(record=>record.name==='clearRect')){paintCount++;displayed=copy(recording.records);}
      return displayed;
    },
    visibility(hidden) { document.hidden=hidden;document.emit('visibilitychange',{}); },
    emit(name, id, x, y) { canvas.emit(name, { pointerId: id, button: 0, clientX: x, clientY: y, preventDefault() {} }); },
    close() {
      board.destroy(); assert.equal(rafs.size, 0, '销毁后不继续请求动画帧');
      for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    },
  };
}

const texts = frame => frame.filter(record => record.name === 'fillText');
const includesText = (frame, text) => texts(frame).some(record => String(record.args[0]).includes(text) && record.alpha > .01);
const cardPose = (frame, name) => {
  const draw = texts(frame).find(record => record.args[0] === name && record.alpha > .99);
  assert.ok(draw, `本帧应真实绘制卡牌“${name}”`);
  return { x: draw.matrix[4], y: draw.matrix[5], scale: fontSize(draw.font)/14*Math.hypot(draw.matrix[0], draw.matrix[1]), rotation: Math.atan2(draw.matrix[1], draw.matrix[0]) };
};
const near = (actual, expected, tolerance = .02) => assert.ok(Math.abs(actual-expected) <= tolerance, `${actual} 应接近 ${expected}`);

test('请求持续数秒仍绘制卡背，不凭动画结束揭晓或落台面', () => {
  const h = harness();
  try {
    assert.equal(h.board.prepareSynthesis(INGREDIENTS), true);
    const prepared = h.advance(FRAME);
    assert.ok(!includesText(prepared, '造物中')); assert.equal(h.calls.busy.length, 0);
    h.begin('ai', { prepare: false });
    for (const duration of [200, 800, 2000]) {
      const frame = h.advance(duration);
      assert.ok(includesText(frame, '造物中')); assert.ok(includesText(frame, '无限工厂3'));
      assert.ok(!includesText(frame, '工具')); assert.equal(h.calls.reveal.length, 0); assert.equal(h.calls.layout.length, 0);
    }
    assert.deepEqual(h.calls.busy.map(event => event.value), [true]);
  } finally { h.close(); }
});

test('慢保存始终显示正在保存，真实提交后才揭晓一次', () => {
  const h = harness();
  try {
    h.begin(); h.advance(500); h.phase('saving');
    for (const duration of [100, 2500]) { const frame = h.advance(duration); assert.ok(includesText(frame, '正在保存')); assert.ok(!includesText(frame, '工具')); assert.equal(h.calls.reveal.length, 0); }
    h.commit(); const frame = h.advance(FRAME);
    assert.ok(includesText(frame, '工具')); assert.equal(h.calls.reveal.length, 1); assert.equal(h.calls.layout.length, 1);
    assert.deepEqual(h.calls.busy.map(event => event.value), [true, false]);
    h.advance(2000); assert.equal(h.calls.reveal.length, 1);
  } finally { h.close(); }
});

test('保存失败保留等待保存卡背，重试期间不提前落卡或揭晓', () => {
  const h = harness();
  try {
    h.begin(); h.advance(500); h.phase('save-failed');
    const waitingFrame = h.advance(2400);
    assert.ok(includesText(waitingFrame, '等待保存')); assert.ok(!includesText(waitingFrame, '工具'));
    assert.equal(h.calls.reveal.length, 0); assert.equal(h.calls.layout.length, 0); assert.equal(h.calls.busy.at(-1).value, true);
    h.phase('saving'); assert.ok(includesText(h.advance(1000), '正在保存')); assert.equal(h.calls.reveal.length, 0);
    h.commit(); assert.ok(includesText(h.advance(FRAME), '工具')); assert.equal(h.calls.reveal.length, 1); assert.equal(h.calls.layout.length, 1);
  } finally { h.close(); }
});

test('快响应的AI与缓存分别满足420和260毫秒，重复响应不重复揭晓', () => {
  for (const [source, minimum] of [['ai', 420], ['cache', 260]]) {
    const h = harness();
    try {
      const id = h.begin(source); h.advance(20); h.commit();
      h.emit('pointerdown', 1, 480, 270); h.emit('pointerup', 1, 480, 270);
      assert.deepEqual(h.calls.pick, ['base:water'], '揭晓前仍能查看无关卡牌，等待不能冻结整个台面');
      const early = h.advance(minimum - 40);
      assert.equal(h.calls.reveal.length, 0); assert.ok(!includesText(early, '工具')); assert.ok(includesText(early, '合成中'));
      assert.ok(includesText(h.advance(40), '工具')); assert.equal(h.calls.reveal.length, 1);
      assert.ok(h.calls.reveal[0].at >= minimum); assert.equal(h.calls.reveal[0].result.operationId, id);
      h.update({ ...h.state }); h.advance(1700); h.update({ ...h.state }); h.advance(100);
      assert.equal(h.calls.reveal.length, 1); assert.equal(h.calls.layout.length, 1);
      h.emit('pointerdown', 2, 480, 270); h.emit('pointerup', 2, 480, 270); assert.deepEqual(h.calls.pick, ['base:water', 'base:water']);
    } finally { h.close(); }
  }
});

test('committed必须匹配本次operationId，旧结果不能冒充本次揭晓', () => {
  const h = harness();
  try {
    const id = h.begin(); h.commit({ operationId: 'another-operation' });
    const frame = h.advance(1000); assert.ok(!includesText(frame, '工具')); assert.equal(h.calls.reveal.length, 0); assert.equal(h.calls.layout.length, 0);
    h.update({ lastResult: { ...h.state.lastResult, operationId: id } }); h.advance(FRAME);
    assert.equal(h.calls.reveal.length, 1); assert.equal(h.calls.reveal[0].result.operationId, id);
  } finally { h.close(); }
});

test('同卡再次合成仍生成新的台面实例，旧实例与响应不会被复用', () => {
  const original = { id: 'table:existing-tool', cardId: RESULT.id, x: 210, y: 160, pinned: false };
  const h = harness({ extraCards: [RESULT], layout: [...LAYOUT, original] });
  try {
    for (let index = 0; index < 2; index++) { h.begin('cache'); h.commit({ isNewCard: false }); h.advance(300); h.acknowledgeLayout(); }
    const results = h.calls.layout.at(-1).filter(node => node.cardId === RESULT.id);
    assert.equal(results.length, 3); assert.equal(new Set(results.map(node => node.id)).size, 3);
    assert.deepEqual(results.find(node => node.id === original.id), original); assert.equal(h.calls.reveal.length, 2);
    assert.notEqual(h.calls.reveal[0].result.operationId, h.calls.reveal[1].result.operationId);
  } finally { h.close(); }
});

test('重复结果局部提示仅在提交揭晓后出现，按时消失且旧响应不重播',()=>{
  const h=harness({extraCards:[RESULT]});
  try{
    h.begin('cache');h.advance(300);h.phase('saving');
    assert.ok(!includesText(h.advance(100),'合成完成'));
    h.commit({isNewCard:false});assert.ok(includesText(h.advance(FRAME),'合成完成'));
    assert.ok(!includesText(h.advance(950),'合成完成'));
    h.update({...h.state});assert.ok(!includesText(h.advance(FRAME),'合成完成'));
  }finally{h.close();}
});

test('减少动态时局部反馈保留文字但不飘动，保存失败不冒充取消或完成',()=>{
  const h=harness({reduceMotion:true});
  try{
    h.begin();h.advance(300);h.phase('save-failed');
    const pending=h.advance(100);assert.ok(includesText(pending,'等待保存'));
    assert.ok(!includesText(pending,'合成未完成'));assert.ok(!includesText(pending,'合成完成'));
    h.phase('failed');
    const first=texts(h.advance(FRAME)).find(r=>r.args[0]==='合成未完成');assert.ok(first);
    const later=texts(h.advance(500)).find(r=>r.args[0]==='合成未完成');assert.ok(later);
    assert.deepEqual(later.args,first.args);assert.equal(later.alpha,1);
    assert.ok(!includesText(h.advance(1200),'合成未完成'));
  }finally{h.close();}
});

test('拖叠请求超时或取消后材料缓动归位，不揭晓、不消费材料或写半途布局', () => {
  for (const phase of ['failed', 'cancelled']) {
    const h = harness({ onCombine: ({ ids, begin }) => begin('ai', { prepare: false, ids }) });
    try {
      h.frameAt(FRAME); h.emit('pointerdown', 1, 248, 270); h.emit('pointermove', 1, 364, 270); h.emit('pointerup', 1, 364, 270);
      assert.deepEqual(h.calls.combine, [['base:wood', 'base:metal']]);
      assert.ok(includesText(h.advance(1000), '造物中')); h.phase(phase);
      const returning = h.advance(FRAME), intermediate = cardPose(returning, '金');
      assert.ok(!includesText(returning, '造物中')); assert.ok(intermediate.x > 248 && intermediate.x < 364);
      const restored = cardPose(h.advance(700), '金'); near(restored.x, 248); near(restored.y, 270); near(restored.scale, 1, .002);
      h.emit('pointerdown', 2, 248, 270); h.emit('pointerup', 2, 248, 270); assert.deepEqual(h.calls.pick, ['base:metal']);
      assert.equal(h.calls.reveal.length, 0); assert.equal(h.calls.layout.length, 0); assert.deepEqual(h.calls.busy.map(event => event.value), [true, false]);
    } finally { h.close(); }
  }
});

test('抓取显示1.1倍与旧倾角，松手后逐帧恢复而非立即跳回', () => {
  const h = harness();
  try {
    h.frameAt(FRAME); h.emit('pointerdown', 1, 248, 270);
    const lifted = cardPose(h.advance(FRAME), '金'); near(lifted.scale, 1.1, .00001); near(lifted.rotation, -.05, .00001);
    h.emit('pointermove', 1, 248, 440); const dragged = cardPose(h.advance(FRAME), '金'); near(dragged.x, 248); near(dragged.y, 440);
    h.emit('pointerup', 1, 248, 440);
    const released = cardPose(h.advance(FRAME), '金'); assert.ok(released.scale > 1 && released.scale < lifted.scale); near(released.rotation, 0, .00001);
    const rested = cardPose(h.advance(700), '金'); near(rested.scale, 1, .002); near(rested.y, 440);
    assert.equal(h.calls.layout.length, 1); assert.equal(h.calls.layout[0].find(node => node.cardId === 'base:metal').y, 170);
  } finally { h.close(); }
});

test('微拖立即跟手，松手仍算点击并回到抓取前位置',()=>{
  const h=harness();
  try{
    h.advance(FRAME);h.emit('pointerdown',1,248,270);
    for(const distance of [3,6]){
      h.emit('pointermove',1,248+distance,270);
      const moved=cardPose(h.advance(FRAME),'金');near(moved.x,248+distance);near(moved.y,270);
    }
    h.emit('pointerup',1,254,270);
    assert.deepEqual(h.calls.pick,['base:metal']);assert.equal(h.calls.combine.length,0);assert.equal(h.calls.layout.length,0);
    const restored=cardPose(h.advance(700),'金');near(restored.x,248);near(restored.y,270);
  }finally{h.close();}
});

test('取消拖动在真实绘制中回弹归位，返回后仍可抓取，词典热区也不能吞卡',()=>{
  const h=harness({isDictionaryDrop:()=>true});
  try{
    h.advance(FRAME);h.emit('pointerdown',1,248,270);h.emit('pointermove',1,900,400);
    const dragged=cardPose(h.advance(FRAME),'金');near(dragged.x,900);near(dragged.y,400);
    h.emit('pointercancel',1,900,400);
    const returning=cardPose(h.advance(FRAME),'金');assert.ok(returning.x>248&&returning.x<900);
    const restored=cardPose(h.advance(700),'金');near(restored.x,248);near(restored.y,270);
    h.emit('pointerdown',2,restored.x,restored.y);h.emit('pointerup',2,restored.x,restored.y);
    assert.deepEqual(h.calls.pick,['base:metal']);assert.equal(h.calls.layout.length,0);assert.equal(h.calls.combine.length,0);
  }finally{h.close();}
});

test('整理途中按可见卡面抓起保持当前位置，继续拖动不跳向目标格',()=>{
  const h=harness({layout:[{...LAYOUT[0],x:45,y:0}]});
  try{
    h.advance(FRAME);h.board.arrange();
    const visible=cardPose(h.advance(FRAME),'金');
    // 取背离目标一侧的卡面内点：只测中心会漏掉目标与视觉坐标相差几十像素的错误。
    const grab={x:visible.x+30,y:visible.y};
    h.emit('pointerdown',1,grab.x,grab.y);
    const held=cardPose(h.advance(FRAME),'金');near(held.x,visible.x);near(held.y,visible.y);near(held.scale,1.1);
    h.emit('pointermove',1,grab.x+14,grab.y+10);
    const dragged=cardPose(h.advance(FRAME),'金');near(dragged.x,visible.x+14);near(dragged.y,visible.y+10);
    h.emit('pointerup',1,grab.x+14,grab.y+10);
    const saved=h.calls.layout.at(-1)[0];near(saved.x,dragged.x-480,.06);near(saved.y,dragged.y-270,.06);
    assert.equal(h.calls.combine.length,0);assert.equal(h.calls.pick.length,0);
  }finally{h.close();}
});

test('词典开关改变画布宽度时保持现有卡牌屏幕位置和缩放',()=>{
  const h=harness();
  try{
    h.advance(FRAME);
    h.emit('pointerdown',1,900,100);h.emit('pointermove',1,970,70);h.emit('pointerup',1,970,70);h.board.zoomBy(1.2);
    const before=cardPose(h.advance(FRAME),'金');
    for(const width of [900,800,640,720,960]){
      h.resize(width);
      const after=cardPose(h.advance(FRAME),'金');near(after.x,before.x);near(after.y,before.y);near(after.scale,before.scale);
    }
    assert.equal(h.calls.layout.length,0,'词典开关不应改写玩家摆放');
  }finally{h.close();}
});

test('连续改变位图尺寸后立即补回卡面，不等下一帧也不推进整理缓动',()=>{
  const h=harness({layout:[{...LAYOUT[0],x:45,y:15}]});
  try{
    h.advance(FRAME);h.board.arrange();
    const visible=cardPose(h.advance(FRAME),'金'),frames=h.frameCount,writes=h.calls.layout.length;
    for(const [width,height] of [[900,540],[820,540],[670,500],[800,540],[960,540]]){
      const immediate=cardPose(h.resize(width,height),'金');
      near(immediate.x,visible.x);near(immediate.y,visible.y);near(immediate.scale,visible.scale);
      assert.equal(h.frameCount,frames,'恢复位图不能靠偷偷推进RAF通过');
      assert.equal(h.calls.layout.length,writes,'纯重绘不能写入布局');
    }
    const continued=cardPose(h.advance(FRAME),'金');
    assert.ok(continued.x<visible.x&&continued.x>480,'正常下一帧仍继续同一段整理缓动');
  }finally{h.close();}
});

test('尺寸重绘保留当前卡背，已提交结果也仅在正常动画帧揭晓和保存一次',()=>{
  const h=harness();
  try{
    h.begin('cache');h.advance(500);h.commit();
    for(const width of [900,800,960]){
      const resized=h.resize(width);
      assert.ok(includesText(resized,'无限工厂3'));assert.ok(!includesText(resized,'工具'));
      assert.equal(h.calls.reveal.length,0);assert.equal(h.calls.layout.length,0);
    }
    assert.ok(includesText(h.advance(FRAME),'工具'));
    assert.equal(h.calls.reveal.length,1);assert.equal(h.calls.layout.length,1);
    h.resize(800);h.resize(960);
    assert.equal(h.calls.reveal.length,1);assert.equal(h.calls.layout.length,1);
  }finally{h.close();}
});

test('拖回词典的提示在右边缘保留完整文字宽度',()=>{
  const h=harness({isDictionaryDrop:()=>true});
  try{
    h.advance(FRAME);h.emit('pointerdown',1,248,270);h.emit('pointermove',1,1000,300);h.emit('pointerup',1,1000,300);
    const message=texts(h.advance(FRAME)).find(record=>record.args[0]==='已放回词典');
    assert.ok(message,'收卡应显示局部提示');
    const halfWidth=[...message.args[0]].length*fontSize(message.font)/2;
    assert.ok(message.args[1]-halfWidth>=0&&message.args[1]+halfWidth<=960,'短提示不能被画布左右边缘裁掉');
    assert.equal(h.calls.layout.at(-1).some(node=>node.id==='table:metal'),false);
  }finally{h.close();}
});

test('已保存空台面重开仍为空，旧档缺布局标记才补五本源',()=>{
  for(const initialized of [true,false]){
    const h=harness();
    try{
      const loaded=copy(h.state.save);loaded.id=`cold-layout-${initialized}`;loaded.layout=[];
      if(initialized)loaded.preferences.layoutInitialized=true;
      else delete loaded.preferences.layoutInitialized;
      // 换档走真实冷载入分支；以画出来的卡名判定，不能只看原始layout数组。
      h.update({save:loaded,saveEpoch:1});
      const frame=h.advance(FRAME),bases=loaded.cards.filter(card=>card.isBase);
      assert.equal(bases.length,5);
      for(const card of bases)assert.equal(includesText(frame,card.name),!initialized);
      assert.equal(h.calls.layout.length,0,'加载不能自行补写或覆盖空台面');
    }finally{h.close();}
  }
});

test('持续动画在60、120、144、165Hz的每次RAF均绘制，不因120Hz门槛隔帧',()=>{
  // 这是调度回归，不声称测到了实机帧率；每个时钟都让同一真实等待动画持续一秒。
  for(const hz of [60,120,144,165]){
    const h=harness();
    try{
      h.begin();
      for(let i=1;i<=hz;i++)h.frameAt(i*1000/hz);
      assert.equal(h.paintCount,hz,`${hz}次RAF不能只画${h.paintCount}次`);
      assert.equal(h.calls.reveal.length,0);
    }finally{h.close();}
  }
});

test('请求和待存期间能摆弄无关卡牌，但隐藏材料及第二次合成保持隔离',()=>{
  for(const phase of ['requesting','saving','save-failed','committed']){
    const h=harness({onCombine:({ids,begin})=>begin('ai',{prepare:false,ids})});
    try{
      h.advance(FRAME);
      h.emit('pointerdown',1,248,270);h.emit('pointermove',1,364,270);h.emit('pointerup',1,364,270);
      h.phase(phase);h.advance(200);
      // 金和木属于尚未结束的合成，不能通过原位置再次抓出来。
      h.emit('pointerdown',2,248,270);h.emit('pointerup',2,248,270);assert.equal(h.calls.pick.length,0);
      h.emit('pointerdown',3,480,270);h.emit('pointerup',3,480,270);assert.deepEqual(h.calls.pick,['base:water']);
      h.emit('pointerdown',4,480,270);h.emit('pointermove',4,596,270);h.emit('pointerup',4,596,270);
      assert.equal(h.calls.combine.length,1,'把无关水卡叠到火卡不能发起第二次生成');
      assert.equal(h.calls.layout.at(-1)?.find(n=>n.id==='table:water')?.x,116,'无关卡牌仍可摆放');
      h.emit('pointerdown',5,900,100);h.emit('pointermove',5,930,120);h.emit('pointerup',5,930,120);
      const afterPan=cardPose(h.advance(FRAME),'土');near(afterPan.x,742);near(afterPan.y,290);
      h.board.zoomBy(1.2);const afterZoom=cardPose(h.advance(FRAME),'土');near(afterZoom.scale,1.2);
      h.board.addCard('base:earth');assert.equal(h.calls.layout.at(-1).length,LAYOUT.length+1);
      h.board.arrange();
      const arranged=h.calls.layout.at(-1);
      for(const id of ['table:metal','table:wood'])assert.deepEqual(arranged.find(n=>n.id===id),LAYOUT.find(n=>n.id===id),'整理不能挪走被锁定的原材料');
      assert.ok(arranged.filter(n=>!['table:metal','table:wood'].includes(n.id)).some(n=>n.x!==LAYOUT.find(original=>original.id===n.id)?.x));
      assert.equal(h.calls.combine.length,1);assert.equal(h.calls.reveal.length,0);
      h.phase('cancelled');
      const restored=h.advance(700);assert.ok(includesText(restored,'金'));assert.ok(includesText(restored,'木'));
      assert.equal(texts(restored).filter(record=>record.args[0]==='土').length,2,'取消不能清掉等待期间新取出的材料');
    }finally{h.close();}
  }
});

test('拖动中揭晓或整理只保存稳定摆放，取消及失焦不遗留中途坐标，松手才提交',()=>{
  for(const trigger of ['reveal','arrange'])for(const finish of ['cancel','hidden','release']){
    const h=harness({onCombine:({ids,begin})=>begin('ai',{prepare:false,ids})});
    try{
      h.advance(FRAME);
      if(trigger==='reveal'){
        h.emit('pointerdown',1,248,270);h.emit('pointermove',1,364,270);h.emit('pointerup',1,364,270);h.advance(500);
      }
      h.emit('pointerdown',2,480,270);h.emit('pointermove',2,530,330);h.advance(FRAME);
      if(trigger==='reveal')h.commit({isNewCard:false});
      else h.board.arrange();
      h.advance(FRAME);
      const waterBeforeFinish=h.calls.layout.at(-1).find(n=>n.id==='table:water');
      assert.equal(waterBeforeFinish.x,0,`${trigger}不能保存尚未松手的水卡横坐标`);assert.equal(waterBeforeFinish.y,0);
      h.acknowledgeLayout();
      // 引入自动揭晓后，persist可能发生在另一次拖动中；核对响应与冷载入才能抓到隐藏的错存。
      if(finish==='hidden'){h.visibility(true);h.advance(FRAME);h.visibility(false);}
      else h.emit(finish==='cancel'?'pointercancel':'pointerup',2,530,330);
      h.advance(700);h.acknowledgeLayout();
      const expected=finish==='release'?{x:50,y:60}:{x:0,y:0},saved=h.state.save.layout.find(n=>n.id==='table:water');
      near(saved.x,expected.x);near(saved.y,expected.y);
      const cold=copy(h.state.save);cold.id=`cold-${trigger}-${finish}`;
      h.update({save:cold,saveEpoch:1,synthesis:null,lastResult:null,busy:false});
      const reloaded=cardPose(h.advance(FRAME),'水');near(reloaded.x,480+expected.x);near(reloaded.y,270+expected.y);
    }finally{h.close();}
  }
});

test('整理保存就近目标但绘制逐帧靠近，避免台面卡牌瞬移', () => {
  const layout = LAYOUT.map(node => ({ ...node, x: node.x + 35, y: 100 }));
  const h = harness({ layout });
  try {
    const before = cardPose(h.advance(FRAME), '金'); h.board.arrange();
    assert.equal(h.calls.layout.length, 1);
    const target=h.calls.layout[0].find(node=>node.id==='table:metal'),targetX=480+target.x,targetY=270+target.y;
    assert.ok(Math.abs(target.x-layout[0].x)<=46);assert.ok(Math.abs(target.y-layout[0].y)<=58);
    const middle = cardPose(h.advance(FRAME), '金');
    assert.ok(Math.abs(middle.x-targetX)<Math.abs(before.x-targetX));assert.ok(Math.abs(middle.y-targetY)<Math.abs(before.y-targetY));
    assert.ok(Math.abs(middle.x-targetX)>.1||Math.abs(middle.y-targetY)>.1,'第一帧仍需保留可见过渡');
    const final = cardPose(h.advance(700), '金'); near(final.x,targetX); near(final.y,targetY);
  } finally { h.close(); }
});

test('减少动态效果保留提交前静态卡背，取消缓动和最短等待但不越过保存门', () => {
  const layout = LAYOUT.map(node => ({ ...node, x: node.x + 35, y: 100 }));
  const h = harness({ reduceMotion: true, layout });
  try {
    h.advance(FRAME); h.board.arrange(); const arranged = cardPose(h.advance(FRAME), '金'),target=h.calls.layout[0].find(node=>node.id==='table:metal');near(arranged.x,480+target.x);near(arranged.y,270+target.y);
    h.emit('pointerdown',1,arranged.x,arranged.y); const held=cardPose(h.advance(FRAME),'金');near(held.scale,1);near(held.rotation,0);h.emit('pointerup',1,arranged.x,arranged.y);
    h.begin(); const first = h.advance(FRAME), later = h.advance(1000);
    const back = frame => texts(frame).find(record => record.args[0] === '无限工厂3');
    assert.ok(back(first)); assert.deepEqual(back(first).matrix, back(later).matrix); assert.ok(includesText(later, '造物中')); assert.equal(h.calls.reveal.length, 0);
    h.phase('saving'); assert.ok(includesText(h.advance(FRAME), '正在保存')); assert.equal(h.calls.reveal.length, 0);
    h.phase('cancelled'); h.advance(FRAME);
    const started = h.now; h.begin(); h.commit(); assert.ok(includesText(h.advance(FRAME), '工具'));
    assert.equal(h.calls.reveal.length, 1); assert.ok(h.calls.reveal[0].at - started < 260);
  } finally { h.close(); }
});

test('导入同一档案的旧布局使用新saveEpoch，清除旧台面实例和未完成动画', () => {
  const h = harness();
  try {
    h.advance(FRAME);
    h.emit('pointerdown', 1, 248, 270); h.emit('pointermove', 1, 248, 440); h.emit('pointerup', 1, 248, 440);
    const layoutA = copy(h.calls.layout.at(-1)); h.acknowledgeLayout(); h.advance(700);
    assert.equal(layoutA.find(node => node.id === 'table:metal').y, 170);
    h.emit('pointerdown', 2, 248, 440); h.emit('pointermove', 2, 330, 420); h.emit('pointerup', 2, 330, 420);
    h.board.addCard('base:water'); h.acknowledgeLayout();
    const layoutB = copy(h.state.save.layout), frameB = h.advance(700);
    assert.notDeepEqual(layoutB, layoutA); assert.equal(layoutB.length, layoutA.length + 1);
    near(cardPose(frameB, '金').x, 330); assert.equal(texts(frameB).filter(record => record.args[0] === '水').length, 2);
    h.begin(); assert.ok(includesText(h.advance(500), '造物中'));
    const writesBeforeImport = h.calls.layout.length, imported = { ...copy(h.state.save), revision: h.state.save.revision + 1, layout: layoutA };
    assert.equal(imported.id, h.state.save.id);
    h.update({ save: imported, saveEpoch: 1, synthesis: null, lastResult: null, busy: false });
    const restored = h.advance(FRAME), metal = cardPose(restored, '金');
    near(metal.x, 248); near(metal.y, 440); near(metal.scale, 1, .00001);
    assert.equal(texts(restored).filter(record => record.args[0] === '水').length, 1, '导入旧布局必须移除B里的额外实例');
    assert.ok(!includesText(restored, '造物中')); assert.ok(!includesText(restored, '无限工厂3'));
    assert.deepEqual(h.calls.busy.map(event => event.value), [true, false]);
    h.advance(2000); assert.equal(h.calls.reveal.length, 0); assert.equal(h.calls.layout.length, writesBeforeImport);
    h.emit('pointerdown', 3, 248, 440); h.emit('pointerup', 3, 248, 440); assert.deepEqual(h.calls.pick, ['base:metal']);
  } finally { h.close(); }
});

test('静态等待稳定后数百次RAF不整屏重绘，保存与提交状态变化仍刷新并揭晓', () => {
  for (const reduceMotion of [false, true]) {
    const h = harness({ reduceMotion });
    try {
      h.begin(); h.advance(500);
      if (!reduceMotion) h.phase('save-failed');
      const stable = h.advance(500);
      assert.ok(includesText(stable, reduceMotion ? '造物中' : '等待保存'));
      const paints = h.paintCount, frames = h.frameCount;
      h.advance(6000);
      assert.ok(h.frameCount - frames >= 350, '必须实际推进数百次RAF，不能靠停掉测试时钟通过');
      assert.equal(h.paintCount, paints, '静态卡背无变化时不应继续整屏重绘');
      h.phase('saving'); const saving = h.advance(FRAME);
      assert.ok(h.paintCount > paints); assert.ok(includesText(saving, '正在保存')); assert.equal(h.calls.reveal.length, 0);
      const beforeCommit = h.paintCount; h.commit(); const committed = h.advance(FRAME);
      assert.ok(h.paintCount > beforeCommit); assert.ok(includesText(committed, '工具')); assert.equal(h.calls.reveal.length, 1);
    } finally { h.close(); }
  }
});


test('两组拖叠各自持有材料和卡背，较早结果落盘揭晓不接管另一任务',()=>{
  const jobs=[];let h;
  h=harness({onCombine({ids,update}){
    const job={id:'parallel:'+jobs.length,ingredientIds:ids,source:'ai',phase:'requesting'};jobs.push(job);
    update({syntheses:copy(jobs),synthesis:job,busy:'combine',canCombine:true});
  }});
  try{
    h.update({syntheses:[],canCombine:true});h.advance(FRAME);
    h.emit('pointerdown',1,248,270);h.emit('pointermove',1,364,270);h.emit('pointerup',1,364,270);
    h.advance(300);
    h.emit('pointerdown',2,480,270);h.emit('pointermove',2,596,270);h.emit('pointerup',2,596,270);
    const both=h.advance(500);assert.equal(jobs.length,2);
    const backs=frame=>texts(frame).filter(record=>record.args[0]==='无限工厂3').length;
    assert.equal(backs(both),2,'两个真实卡背同时可见');
    const result={operationId:jobs[0].id,card:copy(RESULT),isNewCard:true,isNewRecipe:true};
    jobs[0]={...jobs[0],phase:'committed',result};
    const save=copy(h.state.save);save.cards.push(copy(RESULT));save.revision++;
    h.update({save,syntheses:copy(jobs),synthesis:jobs[1],busy:'combine',canCombine:true});
    const partial=h.advance(FRAME);assert.equal(backs(partial),1);assert.equal(h.calls.reveal.length,1);
    assert.equal(h.calls.reveal[0].result.operationId,jobs[0].id);assert.ok(includesText(partial,'工具'));
    jobs[1]={...jobs[1],phase:'failed'};h.update({syntheses:copy(jobs),busy:false,canCombine:true});
    const failed=h.advance(500);assert.equal(backs(failed),0);assert.ok(includesText(failed,'水'));assert.ok(includesText(failed,'火'));
    assert.equal(h.calls.reveal.length,1);
  }finally{h.close();}
});

test('queued卡背静态等待保存，后续恢复提交仍能揭晓同一份结果',()=>{
  const h=harness();try{
    h.begin();h.advance(500);h.phase('queued');
    const first=h.advance(FRAME);assert.ok(includesText(first,'等待保存'));assert.equal(h.calls.reveal.length,0);
    const paints=h.paintCount;h.advance(3000);assert.equal(h.paintCount,paints,'等待前项补存期间不循环重绘静态卡背');
    h.phase('saving');h.commit();assert.ok(includesText(h.advance(FRAME),'工具'));assert.equal(h.calls.reveal.length,1);
  }finally{h.close();}
});
