import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createNativePlatform, hasNativeBridge } from '../src/platform/native.js';
import { NOTICE_VERSION, showUsageNotice } from '../src/ui/usage-notice.js';

test('首次协议挡在存档和 Key 之前，写入失败可重试，重复点击不重复确认', async () => {
  const win = new Window();
  const root = win.document.createElement('div');
  root.id = 'app';
  win.document.body.append(root);
  Object.assign(globalThis, { window: win, document: win.document });
  const calls = [];
  let finishWrite;
  win.wxgcNative = { async invoke(name, args) {
    calls.push({ name, args });
    if (name === 'usage_notice' && !args.accept) return false;
    if (name === 'usage_notice') return new Promise(resolve => { finishWrite = resolve; });
    if (name === 'exit_game') return null;
    throw Error('GAME_STARTED_TOO_EARLY');
  }};
  try {
    await import('../src/main.js?notice');
    await new Promise(resolve => setImmediate(resolve));
    const dialog = root.querySelector('dialog[open]');
    assert.ok(dialog);
    assert.equal(root.querySelector('input,canvas'), null);
    const [exit, agree] = dialog.querySelectorAll('button');
    agree.click();
    agree.click();
    assert.deepEqual(calls.map(c => c.args), [
      { version: NOTICE_VERSION, accept: false }, { version: NOTICE_VERSION, accept: true },
    ]);
    finishWrite(false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dialog.open, true);
    assert.match(dialog.querySelector('[role=alert]').textContent, /重试/);
    assert.equal(agree.disabled, false);
    exit.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.at(-1).name, 'exit_game');
    assert.equal(root.querySelector('input,canvas'), null);
  } finally { win.happyDOM.abort(); }
});

test('重看协议可用系统返回键关闭，无需再次确认', async () => {
  const win = new Window();
  try {
    const done = showUsageNotice(win.document.body);
    const dialog = win.document.querySelector('dialog');
    assert.deepEqual([...dialog.querySelectorAll('button')].map(b => b.textContent), ['关闭']);
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
    assert.equal(await done, false);
    assert.equal(win.document.querySelector('dialog'), null);
  } finally { win.happyDOM.abort(); }
});

test('Windows优先使用正式bridge，生成命令包含材料与操作号，恢复命令参数明确',async()=>{
  const calls=[];const target={wxgcNative:{async invoke(command,args){calls.push({command,args});return command==='library_status'?{activeSlotId:'slot-a',slots:[]}:command==='load_pending'?null:true;}},__TAURI__:{core:{invoke(){throw Error('legacy must not run');}}}};
  const native=createNativePlatform(target);assert.equal(hasNativeBridge(target),true);assert.equal(native.durablePending,true);
  await native.libraryStatus();await native.generate(['base:metal','base:wood'],'real-operation');await native.loadPending();await native.recoveryStatus();await native.listBackups();await native.restoreBackup('backup-id');
  assert.deepEqual(calls,[{command:'library_status',args:{}},{command:'generate_card',args:{ingredientIds:['base:metal','base:wood'],operationId:'real-operation',slotId:'slot-a'}},{command:'load_pending',args:{slotId:'slot-a'}},{command:'recovery_status',args:{slotId:'slot-a'}},{command:'list_backups',args:{slotId:'slot-a'}},{command:'restore_backup',args:{id:'backup-id',slotId:'slot-a'}}]);
});

test('切换后所有读写与Mod命令携带新槽令牌，已发出的旧请求仍绑定旧槽',async()=>{
  const calls=[];let finishGenerate;
  const native=createNativePlatform({wxgcNative:{async invoke(command,args){calls.push({command,args});if(command==='library_status')return {activeSlotId:'a',slots:[]};if(command==='switch_slot')return {save:{id:'save-b'},library:{activeSlotId:'b',slots:[]}};if(command==='generate_card')return new Promise(resolve=>{finishGenerate=resolve;});return null;}}});
  await native.libraryStatus();const old=native.generate(['base:metal','base:wood'],'old-op');await native.switchSlot('b');
  await native.configStatus();await native.configure({key:'literal-test-key'});await native.save({id:'save-b'},0);await native.chooseModFile();await native.stageModResult({operationId:'mod-op'});await native.updatePending({operationId:'mod-op'});await native.confirmImport({cards:[],recipes:[]});
  assert.equal(calls.find(call=>call.command==='generate_card').args.slotId,'a');assert.equal(calls.find(call=>call.command==='switch_slot').args.slotId,'a');
  for(const call of calls.slice(3))assert.equal(call.args.slotId,'b',call.command);
  finishGenerate({name:'旧槽结果'});await old;await native.load();assert.equal(calls.at(-1).args.slotId,'b');
});

test('Android异步回调按请求号配对，忽略迟到重复回调并净化错误',async()=>{
  const sent=[];const target={wxgcAndroid:{postMessage(json){sent.push(JSON.parse(json));}}};
  const native=createNativePlatform(target),load=native.load(),status=native.configStatus();
  assert.equal(sent[0].command,'load_save');assert.notEqual(sent[0].id,sent[1].id);
  target.__wxgcReceive('unrelated',{ok:true,data:'must-ignore'});
  target.__wxgcReceive(sent[1].id,{ok:true,data:{configured:false}});target.__wxgcReceive(sent[0].id,{ok:true,data:null});
  assert.deepEqual(await status,{configured:false});assert.equal(await load,null);
  target.__wxgcReceive(sent[0].id,{ok:false,error:'LATE'});
  const request=native.generate(['base:metal','base:wood'],'op');const last=sent.at(-1);
  assert.equal(last.args.operationId,'op');target.__wxgcReceive(last.id,{ok:false,error:'AI_TIMEOUT: private-network-detail'});
  await assert.rejects(request,{message:'AI_TIMEOUT'});
});

test('Android页面重开后旧请求号不能撞上新页面的首个请求',async()=>{
  const sent=[],target={wxgcAndroid:{postMessage(json){sent.push(JSON.parse(json));}}};
  const first=createNativePlatform(target);first.load();const oldId=sent[0].id;
  const second=createNativePlatform(target);let settled=false;const current=second.load().then(value=>{settled=true;return value;});const newId=sent[1].id;
  assert.notEqual(oldId,newId);target.__wxgcReceive(oldId,{ok:true,data:'old-save'});await Promise.resolve();assert.equal(settled,false);
  target.__wxgcReceive(newId,{ok:true,data:'new-save'});assert.equal(await current,'new-save');
});

test('bridge不能把底层完整错误或服务响应带到玩家状态',async()=>{
  const native=createNativePlatform({wxgcNative:{async invoke(){throw Error('Unexpected secret response');}}});
  await assert.rejects(native.load(),{message:'NATIVE_REQUEST_FAILED'});
  assert.equal(hasNativeBridge({}),false);assert.throws(()=>createNativePlatform({}),{message:'NATIVE_BRIDGE_REQUIRED'});
});

test('旧原生接口兼容读取档案，但不假装支持新的待存日志',async()=>{
  const calls=[];const native=createNativePlatform({__TAURI__:{core:{async invoke(command,args){calls.push({command,args});return null;}}}});
  assert.equal(native.durablePending,false);await native.load();assert.equal(await native.loadPending(),null);assert.deepEqual(await native.listBackups(),[]);
  assert.deepEqual(calls,[{command:'load_save',args:{}}]);
});

test('普通网页即使带旧开发参数也不能进入Key表单或游戏',async()=>{
  const window=new Window({url:'http://127.0.0.1:1420/?development=1'});window.document.body.innerHTML='<div id="app"></div>';
  Object.assign(globalThis,{window,document:window.document,location:window.location});
  try { await import('../src/main.js?without-native');assert.equal(window.document.querySelector('#app').textContent,'请使用《无限工厂3》应用打开游戏。');assert.equal(window.document.querySelector('input'),null); }
  finally { window.happyDOM.abort(); }
});
