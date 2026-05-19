# PinNote

PinNote 是一个基于 **Tauri + SvelteKit + TypeScript** 的极简桌面 Markdown 贴屏便签。

它不是完整笔记软件，也不打算替代 Obsidian、Notion 或 Typora。它的目标很克制：提供一个轻量、漂亮、可置顶、可导出 Markdown 的桌面便签窗口，让你在工作、学习、写代码或等待 AI 结果时，随手记录当前要做的事情。

## 为什么做 PinNote？

很多时候，我们不是缺一个复杂的笔记系统，而是缺一个“贴在眼前的小提醒”。

比如：

- 等 AI 生成结果时，顺手刷了一会儿手机，回来就忘了刚才要继续做什么；
- 写代码时，一边改 bug，一边临时想到几个待办，但又不想打开 Obsidian 或 Notion；
- 开会时，只想快速记几条要点，不想进入完整笔记流程；
- 写论文或做项目时，需要把当前思路、TODO、命令、提示词贴在屏幕边上；
- 临时复制了一段 Markdown 内容，只想稍后导出保存，而不是放进复杂的笔记库。

PinNote 想解决的就是这类问题：

> 把“当前正在做什么”贴在屏幕上，减少上下文丢失。

它更像是一张桌面便利贴，而不是一个笔记管理系统。

## 产品定位

PinNote 只做一件事：

> 一个可以贴在屏幕上的 Markdown 临时便签。

它适合这些场景：

- 写代码时放今日 TODO；
- 等待 AI、编译、训练、下载结果时记录下一步动作；
- 开会时记录临时要点；
- 写论文时贴一段思路；
- 做项目时放当前计划；
- 临时记录 Markdown 片段；
- 把当前任务清单放在屏幕角落，避免被浏览器、聊天软件或手机打断。

默认情况下，PinNote 更强调“临时记录”和“快速导出”，而不是长期管理。重要内容建议手动导出为 `.md` 文件，沉淀到你自己的笔记系统中。

## 功能特性

当前版本已经支持：

- 极简无边框桌面窗口；
- 自定义标题栏；
- 标题栏拖拽移动窗口；
- 右下角拖拽调整窗口大小；
- 窗口置顶开关；
- Markdown 编辑体验；
- Milkdown Markdown 编辑器；
- Markdown 源码模式切换；
- Markdown 导出为 `.md` 文件；
- 导出时可选择保存位置；
- 背景主题切换；
- 自定义背景色；
- 透明度调节；
- 开机自启设置；
- 基于 Tauri 的跨平台桌面应用基础。

## 当前设计原则

PinNote 的第一版遵循这些原则：

- 只做单个桌面便签；
- 不做完整笔记管理；
- 不做账号和云同步；
- 不做复杂知识库；
- 不强迫用户进入完整编辑器页面；
- 优先保证轻量、好看、随手可用；
- 重要内容通过 Markdown 导出沉淀；
- 尽量减少对用户工作流的打扰。

换句话说，PinNote 不是用来“管理所有知识”的，而是用来“保住当前上下文”的。

## 技术栈

- [Tauri 2](https://tauri.app/)
- [SvelteKit](https://svelte.dev/)
- TypeScript
- Rust
- Milkdown
- lucide-svelte
- Tauri Dialog Plugin
- Tauri Autostart Plugin

## 项目结构

```txt
src/
  components/       Svelte 组件
  lib/              前端工具函数和设置逻辑
  routes/           SvelteKit 页面入口

src-tauri/
  src/              Rust 命令和 Tauri 启动逻辑
  capabilities/     Tauri 权限配置
  tauri.conf.json   桌面窗口和打包配置

```

## 开发运行

安装依赖：

```
pnpm install
```

启动桌面开发环境：

```
pnpm tauri dev
```

类型检查：

```
pnpm check
```

构建前端：

```
pnpm build
```

打包桌面应用：

```
pnpm tauri build
```

## 打包说明

Tauri 支持同一套代码跨平台开发，但安装包通常需要在对应系统上分别构建。

- 在 Windows 上构建 Windows 安装包或 `.exe`；
- 在 macOS 上构建 `.app` 或 `.dmg`；
- Windows 的 `.exe` 不能直接在 macOS 上运行；
- macOS 打包、签名和公证需要额外配置。

后续可以通过 GitHub Actions 在 Windows 和 macOS 环境中自动打包发布。

## Roadmap

### 已完成

-  Tauri + SvelteKit 项目基础结构；
-  无边框桌面窗口；
-  自定义标题栏；
-  窗口拖拽移动；
-  右下角拖拽缩放；
-  Markdown 编辑体验；
-  Markdown 源码模式切换；
-  Markdown 导出；
-  自定义背景色；
-  透明度调节；
-  开机自启设置。

### 近期计划

-  优化 Markdown 编辑体验；
-  优化 Milkdown 样式和排版；
-  增加更自然的 Typora-like 编辑体验；
-  增加系统托盘；
-  支持隐藏到托盘；
-  支持托盘菜单退出；
-  支持快捷键呼出 / 隐藏；
-  优化窗口状态记忆；
-  优化状态栏展示；
-  支持多便签；
-  支持 Windows 正式打包发布；
-  支持 macOS 打包测试。

### 后续可能加入

-  多便签管理；
-  按时间查看历史便签；
-  待办清单模式；
-  Markdown 模板；
-  导出目录记忆；
-  主题预设；
-  更完善的快捷键设置；
-  自动保存草稿；
-  GitHub Actions 自动构建 Windows / macOS 安装包。

### 暂不计划

-  账号系统；
-  云同步；
-  团队协作；
-  完整知识库管理；
-  双链笔记；
-  插件系统；
-  富媒体文件管理。

## 版本状态

当前版本仍处于早期阶段，主要用于验证桌面便签的核心体验。

现阶段更适合作为：

- 临时 TODO 便签；
- Markdown 草稿纸；
- AI 等待期间的任务提醒；
- 项目当前计划板；
- 桌面上的轻量 Markdown 便利贴。

如果你需要长期、复杂、结构化的知识管理，建议继续使用 Obsidian、Notion、Logseq 等成熟工具。PinNote 更适合承担“临时记录”和“当前上下文提醒”的角色。

## 使用建议

PinNote 更适合记录短内容，例如：

```
# 当前任务

- [ ] 等 AI 返回后继续修改 README
- [ ] 检查 pnpm tauri build 是否成功
- [ ] 上传 release 包
- [ ] 补充 GitHub Actions
```

或者：

```
# 今日计划

1. 修复窗口样式
2. 优化 Markdown 编辑体验
3. 发布 v0.1.0
```

如果内容变得很重要，建议及时导出为 `.md` 文件，放入自己的正式笔记库中。

## License

MIT