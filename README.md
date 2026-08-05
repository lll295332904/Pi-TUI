# PiDesk

PiDesk 是一个基于 **Tauri 2 + React + TypeScript** 的 Pi Agent 桌面客户端。它通过内置的 Pi runtime 启动 `dist/rpc-entry.js`，用 stdin/stdout JSONL 协议驱动 agent，并将事件流渲染为桌面 UI。

## 当前状态

项目已经进入可运行实现阶段，不再是早期 Electron 方案/静态原型阶段。

当前重点：

- Windows NSIS/MSI release 包构建
- 内置 Pi runtime 打包
- 多会话、历史恢复、模型配置、工具卡片、Inspector/Console 面板
- 向“干净电脑只通过 setup.exe 安装即可使用”的产品标准推进

产品化差距评估见：

- [docs/05-setup安装即用产品化差距评估.md](docs/05-setup安装即用产品化差距评估.md)

## 开发

```bash
npm install
npm run tauri -- dev
```

## 构建

构建前确保 `src-tauri/pi-bundle/` 已包含 Pi runtime。可用脚本从全局 npm 安装的 Pi 复制：

```bat
scripts\bundle-pi.bat
```

然后构建 release：

```bash
npm run tauri -- build
```

产物位置：

- `src-tauri/target/release/bundle/nsis/PiDesk_0.2.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/PiDesk_0.2.0_x64_en-US.msi`

## 验证

```bash
npm run build
cd src-tauri && cargo check
```

如修改 release 打包链路，还需要运行：

```bash
npm run tauri -- build
```

并检查 release 产物中存在：

- `pi-bundle/node.exe`
- `pi-bundle/package.json`
- `pi-bundle/dist/rpc-entry.js`
- `pi-bundle/node_modules/`

## 文档

保留文档：

- `docs/05-setup安装即用产品化差距评估.md`：安装即用产品化差距与路线图
- `docs/session-per-file-refactor.md`：会话文件级重构记录
- `AUDIT.md` / `IMPROVEMENTS.md`：历史审计与改进记录

早期 Electron 方案文档已删除，避免与当前 Tauri 实现冲突。
