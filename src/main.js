import { createController } from './controller.js';
import { createNativePlatform, hasNativeBridge } from './platform/native.js';
import { NOTICE_VERSION, showUsageNotice } from './ui/usage-notice.js';
import { createManagementView } from './ui/management-view.js';
import { createLegacyBridge } from './legacy/bridge.js';
import { createLegacyRuntime } from './legacy/runtime.js';

const root=document.querySelector('#app');
async function boot(){
  if(!hasNativeBridge()){root.textContent='请使用《无限工厂3》应用打开游戏。';return;}
  const platform=createNativePlatform();
  const accepted=await platform.usageNotice(NOTICE_VERSION).catch(()=>false);
  if(accepted!==true&&!await showUsageNotice(root,platform))return;
  let manager,bridge,runtime;
  const controller=createController(platform,state=>{
    bridge?.update(state);manager?.render(state);runtime?.render(state);
  },{confirmImport:save=>platform.confirmImport(save)});
  await controller.start();
  root.classList.add('wxgc3');
  const canvas=document.createElement('canvas');canvas.id='c';canvas.className='wx-legacy-canvas';
  canvas.setAttribute('aria-label','无限工厂3');canvas.tabIndex=0;
  const management=document.createElement('div');root.replaceChildren(canvas,management);
  const onOpen=name=>{
    if(name==='home'){window.GO?.('主页');return;}
    if(name==='exit'){platform.exitGame();return;}
    manager?.open(name);
  };
  manager=createManagementView(management,controller.callbacks,{
    onModalChange:covered=>runtime?.setCovered(covered),onAddCard:id=>runtime?.addCard(id),
  });
  bridge=createLegacyBridge(controller,{onOpen,onMessage:text=>manager.showMessage(text),
    isModalOpen:()=>manager.isModalOpen(),canAccess:()=>manager.canAccess()});
  bridge.install(window);bridge.update(controller.state);
  manager.render(controller.state);
  runtime=await createLegacyRuntime(canvas,{bridge,onOpen});
  runtime.setCovered(manager.isModalOpen());
  runtime.render(controller.state);await runtime.start();
  window.addEventListener('beforeunload',()=>{
    manager.clearApiKey();runtime.destroy();bridge.destroy();manager.destroy();
  },{once:true});
}
boot().catch(error=>{
  // 失败不新建或覆盖存档；异常内容不含原生凭据。
  console.error('Game startup failed',error?.message||'startup');
  root.textContent='游戏未能启动。请关闭后重试，保留现有存档。';
});
