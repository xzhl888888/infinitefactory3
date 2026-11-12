# 无限工厂3

从金、木、水、火、土开始，把卡牌拖到一起，看能合出什么。第一次遇到的组合可以交给你选择的 AI，发现的卡牌和配方会留在自己的存档里。游戏支持 Windows 和安卓。

## 怎么玩

1. 第一次打开游戏时，阅读使用协议，填写自己的 API Key 并检测连接。调用云端模型需要联网，费用由所选服务商按你的账户计收。
2. 进入工厂，把两张卡拖到一起开始合成。想试更多材料，可以展开合成台。已学会的配方可以离线再合，不会重复调用 AI。
3. 在词典查看发现的卡，在「更多」里查看合成历史、配方或编辑这个存档的提示词。主页的金色数字显示已发现的卡牌种数，五张起始卡不计入。

在主页的存档菜单可以新建、切换或导出存档。分享给朋友时，卡牌、配方、提示词和已安装的 Mod 会一起带过去，API Key 留在本机。

## 装一个 Mod

下载 [苔光花园示例](examples/mods/苔光花园.wxgc3-mod)。在主页点「Mod → 导入 Mod 文件」，从下载目录选中它，点「安装 Mod」，再点「启用」。用水和土合出幼苗，再试试幼苗和木。

你也可以给游戏做一套台面、卡面、音效、固定配方，或者编写能记录进度的玩法脚本。每个存档可以启用不同的组合。[Mod 制作指南](docs/Mod制作指南.md)

## 在 Windows 上运行源码

安装 Node.js 24，在项目目录打开终端，执行以下命令。首次安装会从 npm 和 Electron 下载依赖与运行环境。

```powershell
npm ci --ignore-scripts
node node_modules/electron/install.js
npm start
```

运行源码会打开完整的桌面游戏，与同机安装版使用同一份游戏数据。修改存档逻辑前，先在游戏里导出需要保留的存档。自动测试使用独立的临时存档。

| 命令 | 用途 |
| --- | --- |
| `npm test` | 运行合成、存档、Mod、界面与桌面数据读写测试 |
| `npm run check` | 构建前端并核对源文件与打包内容 |
| `npm run build:windows` | 生成 Windows 安装程序，输出到 `dist/windows/` |
| `npm run build:android` | 在 Windows 上生成安卓 APK，输出到 `dist/android/` |

构建 APK 还需 PowerShell 7、JDK 17、Android SDK Platform 36 和 Build Tools 36.0.0。设置 `JAVA_HOME` 为 JDK 根目录、`ANDROID_HOME` 为 SDK 根目录，再运行安卓构建命令。首次构建会在当前用户的本地应用数据目录下创建自己的签名，后续给同一批玩家发更新时请保留它。自签 APK 与其他签名的已装版本不能直接覆盖安装，换装前请在游戏里导出存档。

## 修改游戏

| 想改什么 | 从这里开始 |
| --- | --- |
| 五本源、分类、默认模型 | [内容设置](src/content/catalog.js) |
| 合成规则、卡牌和配方如何保存 | [存档与合成逻辑](src/core/model.js) |
| AI 提示词、材料如何发给模型 | [默认提示词](src/ai/prompt.js) · [模型请求与返回格式](src/ai/protocol.js) |
| 拖卡手感、卡牌画法、合成动画 | [台面操作](src/ui/canvas.js) · [卡牌绘制](src/ui/card-art.js) · [合成动画](src/ui/synthesis-effects.js) |
| 扩展 Mod 接口 | [Mod 格式](src/core/mods.js) · [玩法脚本运行环境](src/mods/runtime.js) |
| 桌面和安卓的存档、文件选择和密钥保存 | [Windows](platforms/windows) · [Android](platforms/android/src/com/geometryworkshop/wxgc3) |

两个平台共用 `src/` 下的游戏界面。修改存档或 Mod 文件格式时，还需同步安卓的读取与校验，并用已有格式的存档测试。

## 许可证

项目使用 [MIT 许可证](LICENSE)。复制或分发时请保留版权声明和许可证文本。
