import { createAppView } from './ui/app-view.js';
import { createController } from './controller.js';
import { createNativePlatform, hasNativeBridge } from './platform/native.js';
import { NOTICE_VERSION, showUsageNotice } from './ui/usage-notice.js';

const root = document.querySelector('#app');
async function boot() {
  let platform;
  if (hasNativeBridge()) platform = createNativePlatform();
  else {
    root.textContent = '请使用《无限工厂3》应用打开游戏。'; return;
  }
  root.classList.add('wxgc3');
  const accepted = await platform.usageNotice(NOTICE_VERSION).catch(() => false);
  if (accepted !== true && !await showUsageNotice(root, platform)) return;
  // 存档和凭据分开读取。两者就绪后再呈现入口，已有 Key 的玩家不会先闪过配置框。
  let view;
  const controller = createController(platform, state => view?.render(state), {
    confirmImport: save => platform.confirmImport(save),
  });
  await controller.start();
  view = createAppView(root, controller.callbacks);
  view.render(controller.state);
  window.addEventListener('beforeunload', () => view.destroy(), { once: true });
}
boot().catch(() => { root.textContent = '游戏未能启动。请关闭后重试，保留现有存档。'; });
