import { GAME_VERSION } from '../content/catalog.js';
import { createModImages, createModAudio } from '../mods/media.js';

// 二代场景是相互共享绘图变量的经典脚本。按原顺序执行，保留它们的单一引擎，
// 不用 eval 拼接，也不在外层重复投递 pointer 事件。
export async function createLegacyRuntime(canvas, { bridge, onOpen } = {}) {
  if (window.WXGC3_LEGACY_ENGINE && !window.WXGC3_LEGACY_ENGINE.destroyed) {
    throw new Error('游戏画面已经加载');
  }
  canvas.id = 'c';
  const previousVersion=window.WXGC2_VERSION_LABEL;
  window.WXGC2_VERSION_LABEL='v'+GAME_VERSION;
  const loaded = [];
  let destroyed = false;
  let lastSlot = null;
  const media = {
    images: createModImages(() => { if (!destroyed) window.WXGC3_LEGACY_ENGINE?.invalidate(); }),
    audio: createModAudio(),
  };
  window.WXGC3_LEGACY_MEDIA = media;
  // 正式入口先安装桥接；独立预览也可显式传入同一桥接完成安装。
  if (!window.WXGC3_UI && bridge?.install) bridge.install(window);
  if (!window.WXGC3_UI) throw new Error('本地存档尚未连接');

  async function load(name) {
    const script = document.createElement('script');
    script.src = new URL(name, import.meta.url).href;
    script.async = false;
    loaded.push(script);
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error(`无法加载游戏画面：${name}`));
      document.head.append(script);
    });
  }
  try {
    for (const file of ['categories.js', 'engine.js', 'music.js', 'home.js', 'factory.js']) await load(file);
    if (!window.SCENES?.['主页'] || !window.SCENES?.['工厂界面']) throw new Error('游戏画面没有完成加载');
  } catch (error) {
    window.WXGC3_LEGACY_ENGINE?.destroy();
    if (window.WXGC3_LEGACY_ENGINE) window.WXGC3_LEGACY_ENGINE.destroyed = true;
    media.images.clear(); media.audio.clear();
    loaded.forEach(script => script.remove());
    throw error;
  }
  const engine = window.WXGC3_LEGACY_ENGINE;
  if (!engine) throw new Error('游戏画面没有完成加载');
  return {
    start() { if (!destroyed) engine.start('主页'); },
    render(state) {
      if (destroyed) return;
      const slot=(state?.library?.activeSlotId||state?.save?.id||'')+':'+(state?.saveEpoch||0);
      // 正常落盘会重建 mods 数组，不能据此清掉相同 data URL 的已解码素材。
      if (slot!==lastSlot) { media.audio.clear();media.images.clear();lastSlot=slot; }
      engine.render(state);
    },
    setCovered(covered) { if (!destroyed) engine.setCovered(covered); },
    addCard(id) {
      if (destroyed) return false;
      if (!window.SCENES?.['工厂界面']?.addCard) return false;
      if (window.CUR_NAME !== '工厂界面' && !window.GO('工厂界面')) return false;
      return window.SCENES['工厂界面'].addCard(id);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      engine.destroy(); engine.destroyed = true;
      media.images.clear(); media.audio.clear();
      loaded.forEach(script => script.remove());
      if (window.WXGC3_LEGACY_MEDIA === media) delete window.WXGC3_LEGACY_MEDIA;
      if(previousVersion===undefined)delete window.WXGC2_VERSION_LABEL;else window.WXGC2_VERSION_LABEL=previousVersion;
    },
  };
}
