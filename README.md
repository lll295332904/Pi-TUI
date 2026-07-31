# PiDesk — PI Agent 桌面 UI 工具

> 用一个原生桌面应用（Windows `.exe`）取代 PI Agent 的命令行 TUI，交互模式对标 Hermes TUI / Codex，但拥有更符合个人使用习惯的图形界面。

本仓库当前阶段为 **制作方案（设计文档 + UI 原型）**，尚未开始编码实现。

## 目录

| 路径 | 内容 |
|---|---|
| `docs/01-方案总览.md` | 项目目标、调研结论、整体结论 |
| `docs/02-技术方案.md` | 技术选型（决策矩阵）、系统架构、通信层设计、打包方案 |
| `docs/03-UI界面说明.md` | 界面布局、各区域说明、交互与快捷键、审批流、参考对标 |
| `docs/04-实施计划.md` | 目录结构、迭代里程碑、风险与对策 |
| `prototype/index.html` | 可在浏览器直接打开的高保真界面原型（静态） |

## 一句话结论

PI Agent(`@earendil-works/pi-coding-agent` v0.82.0)**原生提供 `--mode rpc` 接口**，并导出了完整 TypeScript 类型的 `RpcClient` 客户端类。桌面 UI 只需作为该 RPC 内核的「前端外壳」，**无需修改 Pi 源码、无需逆向协议**，即可完整驱动会话、流式回复、模型切换、工具执行与审批。

推荐技术栈：**Electron + React + TypeScript + Vite**（主进程直接复用 `RpcClient`，零协议重写成本）。
