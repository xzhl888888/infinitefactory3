// 只在影响玩家选择的条款变化时更新版本。确认记录属于本机，不进入存档或 Mod。
export const NOTICE_VERSION = '2026-11-12';

const sections = [
  ['AI 生成的卡牌', '调用 AI 时，卡名和描述由你选择的模型根据材料和提示词生成。结果可能失实、冒犯或与他人作品相似，仅供游戏娱乐，不代表开发者的观点。分享前请核对内容，尊重他人的隐私和著作权。'],
  ['API Key、数据与费用', '检测连接和用 AI 合卡都会向你填写的服务地址发送请求，使用你的 Key 验证身份。合卡请求含材料卡牌、合成提示词，以及已启用 Mod 的合成主题。请确认地址可信，别在提示词中填写隐私或密钥。服务商按其规则处理数据、向你的账户计费；取消等待也可能已产生费用。'],
  ['Mod、存档与改版', '使用和分发源码请遵守随附许可证。第三方 Mod 和游戏改版由各自的作者提供，内容和运行方式可能与原版不同。请从信任的来源安装，导入玩法脚本前备份存档。分享的存档含提示词及 Mod，游戏配置的 API Key 不随档导出。'],
  ['责任范围', '开发者不保证模型输出准确或适合公开使用。请对自己输入、使用和传播内容的行为依法负责。法律规定开发者应承担且不得免除的责任，仍依法承担。'],
];

/** 首次进入与游戏内重看用同一份正文。原生确认写入成功才会放行启动。 */
export function showUsageNotice(root, platform = null) {
  const doc = root.ownerDocument;
  const make = (tag, text, cls) => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const dialog = make('dialog', '', 'wx-notice');
  dialog.setAttribute('aria-labelledby', 'usage-notice-title');
  const title = make('h1', '使用协议与免责声明');
  title.id = 'usage-notice-title';
  title.tabIndex = -1;
  const header = make('header');
  header.append(make('span', '无限工厂3'), title);
  const body = make('div', '', 'wx-notice-body');
  body.tabIndex = 0;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-label', '协议正文');
  for (const [heading, content] of sections) body.append(make('h2', heading), make('p', content));
  const footer = make('footer');
  const error = make('p', '', 'wx-notice-error');
  error.setAttribute('role', 'alert');
  const accept = make('button', platform ? '同意并继续' : '关闭', 'wx-button wx-button-primary');
  const exit = make('button', '不同意并退出', 'wx-button');
  accept.type = exit.type = 'button';
  if (platform) footer.append(exit);
  footer.append(accept);
  dialog.append(header, body, error, footer);
  root.append(dialog);
  dialog.showModal();
  title.focus();
  return new Promise(resolve => {
    let busy = false;
    function close(accepted) {
      doc.removeEventListener('keydown', onKey, true);
      dialog.close();
      dialog.remove();
      resolve(accepted);
    }
    async function choose(yes) {
      if (busy) return;
      if (!platform) { close(false); return; }
      busy = true;
      accept.disabled = exit.disabled = true;
      error.textContent = '';
      try {
        if (yes) {
          if (await platform.usageNotice(NOTICE_VERSION, true) !== true) throw Error('NOTICE_WRITE_FAILED');
          close(true);
        } else {
          await platform.exitGame();
          close(false);
        }
      } catch {
        error.textContent = yes ? '未能保存你的选择。请检查设备可用空间后重试。' : '未能退出，请关闭游戏窗口或从系统退出。';
        busy = false;
        accept.disabled = exit.disabled = false;
      }
    }
    // 安卓的系统返回键由宿主派发 Escape，也要遵守首次确认的边界。
    function onKey(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      choose(false);
    }
    doc.addEventListener('keydown', onKey, true);
    dialog.addEventListener('cancel', event => { event.preventDefault(); choose(false); });
    accept.addEventListener('click', () => choose(true));
    exit.addEventListener('click', () => choose(false));
  });
}
