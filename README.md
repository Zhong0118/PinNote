# PinNote

一张放在桌面上的 Markdown 便签。随手写，自动保存；暂时不用时，收成一颗小胶囊。

当前源码版本 **1.1.2**。对应安装包请以 GitHub Releases 中实际发布的版本为准。

## 界面

默认白底、黑字、蓝色强调。标题栏只保留标题、收起按钮和圆形菜单，低频操作集中在菜单里。

<img src="image/note.png" alt="PinNote 极简便签" width="350" />
<img src="image/menu.png" alt="圆形菜单展开后的操作面板" width="350" />

收起后的胶囊：

<img src="image/capsule.png" alt="可拖动、点击展开的便签胶囊" width="180" />

以上为真实前端使用测试内容的预览，不含个人便签。

## 使用

- **写字**：支持 Markdown 标题、列表、任务项、引用、代码和表格，内容自动保存。
- **收起 / 展开**：点击标题栏的向内收拢箭头，窗口缩为 `180 × 40` 胶囊；点击胶囊或按 Enter / 空格恢复。收起期间保留编辑器和撤销历史。
- **移动 / 缩放**：拖动标题栏空白处或胶囊移动；拖动展开窗口的边缘、四角缩放。展开模式最小 `260 × 180`，边角没有装饰性斜线。
- **圆形菜单**：新建、置顶、所有便签、模板、源码、导出、设置、隐藏和删除。菜单支持方向键、Escape 关闭及焦点返回。
- **多张便签**：每张是独立窗口，分别记住内容、外观、展开尺寸和胶囊位置。恢复位置时会限制在显示器工作区内，避免落到屏幕外或任务栏下。
- **托盘**：显示 / 隐藏全部便签、新建、设置、退出。关闭窗口会保存并隐藏；删除需要确认。
- **外观**：默认纯白，保留已有主题、自定义颜色和透明度。轻量过渡支持系统“减少动态效果”。

托盘和全局快捷键共用显示逻辑：只要有便签可见，就隐藏所有可见便签；全部隐藏时，恢复全部未删除的便签。重要记录可通过菜单导出 `.md` 文件。

## 快捷键

全局快捷键可在设置中修改；若被其他软件占用，便签会提示注册失败。

| 操作 | macOS 默认 | Windows 默认 |
| --- | --- | --- |
| 显示 / 隐藏全部便签 | Cmd + Option + N | Alt + N |
| 新建便签 | Cmd + Option + Shift + N | Alt + Shift + N |
| 导出当前便签 | Cmd + S | Ctrl + S |
| 切换置顶 | Cmd + T | Ctrl + T |
| 切换源码 | Cmd + / | Ctrl + / |
| 打开设置 | Cmd + , | Ctrl + , |
| 加粗 / 斜体 | Cmd + B / I | Ctrl + B / I |

后五项仅在便签聚焦时生效。源码与可视编辑使用各自的撤销历史，切换模式不共享撤销栈；收成胶囊不会切换编辑模式。

## 安装与平台状态

已发布安装包见 [Releases](https://github.com/Zhong0118/PinNote/releases)。请区分发布版本与当前源码版本。

- **macOS**：打开对应 `.dmg`，将应用复制到应用目录；本地构建也可直接运行 `.app`。当前开发版已在 Apple Silicon macOS 构建验证，并用隔离数据确认原生胶囊为 180 × 40、恢复坐标正确；使用本地临时签名，未做 Developer ID 签名与公证。
- **Windows**：在 Windows 上构建安装包并运行安装程序。界面、快捷键、托盘和自启使用同一套 Tauri 实现；macOS 专属行为有平台分支。本轮增加了 Windows CI 构建和测试配置，但尚未在真实 Windows 桌面验收，不能把模拟平台测试当作实机通过。

Windows 需要 WebView2；从源码构建还需要 Microsoft C++ Build Tools（桌面 C++ 工作负载）。macOS 构建需要 Xcode Command Line Tools。完整环境要求见 [Tauri 官方前置条件](https://v2.tauri.app/start/prerequisites/)。

## 开发与构建

技术栈：Tauri 2、Rust、Svelte 5 / SvelteKit、TypeScript、Milkdown、Lucide。沿用现有组件，没有新增 UI 依赖。

准备 Node.js 22+、pnpm 9、Rust stable 及对应平台工具链，然后运行：

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

检查与测试：

```sh
pnpm check
pnpm test
pnpm build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

在目标平台打包：

```sh
# macOS：构建 .app
pnpm tauri build --bundles app -- --locked

# macOS：构建可上传 Release 的 .dmg 安装包
pnpm tauri build --bundles dmg -- --locked

# Windows：构建本机安装包
pnpm tauri build -- --locked
```

构建产物位于 `src-tauri/target/release/bundle/`。本机 macOS 开发包必要时可做临时签名：

```sh
codesign --force --deep --sign - src-tauri/target/release/bundle/macos/PinNote.app
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/PinNote.app
```

`.github/workflows/check.yml` 为 push / PR 配置 macOS、Windows 编译、类型检查和测试，不发布安装包；`release.yml` 保留 `v*` 标签触发的发布流程。推送普通分支不会创建 Release；推送 `v1.1.2` 等版本标签后，工作流会在 Windows 和 macOS runner 上打包并上传到对应 Release。macOS CI 构建通用包，支持 Apple Silicon 与 Intel；本机默认构建只包含当前架构。

Windows 安装包推荐交给上述 GitHub Actions 生成，无需本地 Windows 电脑。Mac 也能使用 NSIS、LLVM 和 `cargo-xwin` 交叉构建 Windows `.exe`，但配置更复杂；`.msi` 必须在 Windows 上构建。详见 [Tauri Windows 打包文档](https://v2.tauri.app/distribute/windows-installer/#build-windows-apps-on-linux-and-macos)。

## 数据与可靠性

数据保存在系统应用数据目录，通过“设置 → 行为 → 用户数据”可打开目录或复制路径。

| 文件 | 内容 |
| --- | --- |
| `notes.json` | 所有便签正文、外观和窗口状态 |
| `settings.json` | 快捷键与全局设置 |
| `templates.json` | 自定义模板，最多 8 个 |

应用标识继续使用 `com.pinnote.app`，可读取旧数据；旧版单便签 `note.json` 自动迁移。备份时先从托盘退出，再复制整个数据目录。

保存失败会显示错误并保留草稿；隐藏或退出前会等待写入，退出保存失败会取消退出。损坏的便签文件会保留原文件并报告错误，不会当作空数据覆盖。修改外观不覆盖未保存的正文，多窗口按便签合并保存。

移动和缩放事件按 150 毫秒合并，正文按 500 毫秒合并写入。胶囊的尺寸不会覆盖展开尺寸；macOS 位置统一使用全局逻辑坐标，Windows 保留全局物理坐标，窗口大小使用逻辑像素。选屏按窗口覆盖面积，展开时保持右上锚点，超出目标屏幕工作区时向内收回。旧文件会在保存时迁移；旧胶囊未记录 DPI，首次迁移按当前窗口缩放换算。

## 回归验证

- `tests/notesStore.test.mjs`：保存失败重试、草稿快照、损坏数据和并发删除。
- `tests/windowGeometry.test.mjs`：胶囊往返、负坐标、多屏缩放、断开显示器和工作区边界。
- `tests/platform.test.mjs`：Windows / macOS 默认快捷键、并发注册与销毁、长按去重、部分注册失败、Option / 死键和空格录制。
- `tests/windowVisibility.test.mjs`：显隐确认、启动期请求重试、去重、串行执行、失败及过期请求。
- Rust 单元测试：并发原子写入、退出保存确认及过期请求。
- 本轮本地结果：51 项 Node 测试、4 项 Rust 测试、34 项浏览器检查通过，类型检查与 Rust clippy 通过；浏览器场景另以 Windows 平台模拟运行通过。
- macOS 隔离应用实测：双屏往返移动、跨屏边界选屏、屏幕边缘展开和托盘事件显隐通过。逐帧采样确认页面随原生窗口连续展开，顶部和右边缘固定。当前两块实测屏幕均为 2× 缩放；混合 DPI 与断屏恢复另有模拟测试。
- `tests/browser-regression.mjs`：真实 Svelte / Milkdown 页面配合模拟 Tauri IPC，验证编辑、保存、菜单和胶囊交互，不读取个人便签。

浏览器场景是接受 Playwright `page` 的异步函数。先运行 `pnpm dev --host 127.0.0.1`，再用 Playwright MCP 的代码执行工具运行该文件内容。它不替代真实系统窗口测试。

发布前仍需在 Windows 实机检查安装、托盘、快捷键冲突、自启和胶囊拖动，并在真实混合 DPI 多屏环境验证拔插显示器。基础图片引用可用，但暂不提供本地图片导入或资源管理。

## 1.1.2 托盘、多屏与动画修复

- 修复 macOS 展开时先左移、页面最后才变大的问题：使用非阻塞原生动画，让 WebView 随窗口逐帧重绘。
- 胶囊跨屏后按主要覆盖区域决定展开屏幕；统一 macOS 跨 DPI 坐标，恢复被拔掉的屏幕上的隐藏窗口时重新限制位置。
- 连续托盘操作等待实际保存和显隐结果；新窗口启动期间重试请求，过期请求不再延迟隐藏便签。
- 快捷键注册与注销串行执行，旧回调立即失效，长按只触发一次。
- 保持 1.1.1 的极简界面布局。

## 1.1.1 外观与动画

- 正文首行与标题栏的间距从约 26 像素缩到 8 像素，标题与正文统一左侧对齐，调整标题字号和字重。
- 收起按钮改为向内箭头，与胶囊的展开图标成对。
- macOS 使用系统原生窗口动画同步位置与尺寸，正文先淡出、展开后再淡入，避免直接跳变和缩放中的文字重排。
- 系统开启“减少动态效果”时跳过原生动画。Windows 保留通用窗口调整路径与界面淡入淡出。
- 当时的采样只验证了原生窗口边框，未覆盖页面重绘延迟；该问题在 1.1.2 中补测并修复。

## 1.1.0 改动

- 工具栏收为圆形菜单，统一默认白色界面，增加按钮反馈与轻量过渡。
- 新增真正缩小原生窗口的胶囊模式，保留编辑尺寸、位置和当前编辑历史。
- 移除右下角斜线，保留边缘和四角缩放。
- 修复保存队列重试、模式切换丢字、外观同步覆盖正文、退出与删除的竞态问题。
- 补齐位置恢复、工作区约束、快捷键录制和跨平台构建检查；修复 macOS 调整高度时上边缘跳动。
- 重写 README，移除过期 Roadmap。后续优先完成桌面实机验收，继续保持极简便签定位。

## License

MIT
