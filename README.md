# PinNote

PinNote 是一个基于 Tauri + SvelteKit + TypeScript 的极简桌面 Markdown 贴屏便签。

它不是完整笔记软件，也不打算替代 Obsidian、Notion 或 Typora。它的目标很克制：提供一个轻量、漂亮、可置顶、可导出 Markdown 的桌面便签窗口。

## 功能特性

- 极简无边框桌面窗口
- 自定义标题栏
- 标题栏拖拽移动窗口
- 右下角拖拽调整窗口大小
- 窗口置顶开关
- 临时便签内容，默认不持久化正文
- Markdown 导出为 `.md` 文件
- 导出时可选择保存位置
- Milkdown Markdown 编辑体验
- 可切换 Markdown 源码模式
- 背景主题切换
- 自定义背景色
- 透明度调节
- 开机自启设置
- 基于 Tauri 的跨平台桌面应用基础

## 产品定位

PinNote 只做一件事：

> 一个可以贴在屏幕上的 Markdown 临时便签。

适合这些场景：

- 写代码时放今日 TODO
- 开会时记录临时要点
- 写论文时贴一段思路
- 做项目时放当前计划
- 临时记录 Markdown 片段

默认情况下，便签正文不会在下次启动时自动恢复。重要内容请手动导出为 `.md` 文件。

这样设计是为了让 PinNote 更接近“桌面便利贴”，而不是变成一个复杂的笔记管理软件。

## 技术栈

- Tauri 2
- SvelteKit
- TypeScript
- Rust
- Milkdown
- lucide-svelte
- Tauri Dialog Plugin
- Tauri Autostart Plugin

## 开发运行

安装依赖：

```bash
pnpm install
```

启动桌面开发环境：

```bash
pnpm tauri dev
```

类型检查：

```bash
pnpm check
```

构建前端：

```bash
pnpm build
```

打包桌面应用：

```bash
pnpm tauri build
```

## 打包说明

Tauri 支持同一套代码跨平台开发，但安装包需要分别在对应系统上构建。

- 在 Windows 上构建 Windows 安装包或 `.exe`
- 在 macOS 上构建 `.app` 或 `.dmg`
- Windows 的 `.exe` 不能直接在 macOS 上运行

后续可以通过 GitHub Actions 分别在 Windows 和 macOS 环境中自动打包。

## 当前范围

当前版本聚焦于单个桌面便签窗口。

暂不包含：

- 多便签
- 搜索
- 标签
- 云同步
- 账号系统
- 富媒体管理
- 系统托盘

系统托盘是比较适合作为下一步补充的功能。加入托盘后，可以支持“隐藏到托盘”“托盘菜单退出”“快捷键呼出”等桌面小工具能力。

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

## 设计原则

- 第一版只做单便签
- 不做完整笔记管理
- 不做账号和同步
- 优先保证轻量、好看、随手可用
- 重要内容通过 Markdown 导出沉淀

## License

MIT
