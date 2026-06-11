<div align="center">

# ui-inspect

### 让 AI coding agent 看懂你在浏览器里选中的真实界面

[![npm cli](https://img.shields.io/npm/v/@ui-inspect/cli?label=%40ui-inspect%2Fcli&color=2f6fed)](https://www.npmjs.com/package/@ui-inspect/cli)
[![MCP](https://img.shields.io/badge/MCP-ready-22c55e)](https://modelcontextprotocol.io/)
[![Vite](https://img.shields.io/badge/Vite-supported-646cff)](docs/zh-CN/getting-started.md)
[![Next.js](https://img.shields.io/badge/Next.js-supported-111111)](docs/zh-CN/getting-started.md)

简体中文 · [English](README.en.md)

[快速开始](docs/zh-CN/getting-started.md) · [Agent 使用指南](docs/zh-CN/agent-guide.md) · [MCP 与 CLI 参考](docs/zh-CN/reference.md)

</div>

---

## 一句话

ui-inspect 是一个面向本地前端开发的 MCP 上下文桥。

你在浏览器里点选元素、输入要求、点击 Send，AI coding agent 就能拿到结构化的前端上下文：DOM、selector、组件名、源码线索、样式、console 诊断、批量目标备注和任务状态。它的目标不是替代 agent，而是让 agent 少猜一点，改得更准一点。

## 为什么需要它

和 agent 做前端开发时，最难说清的经常不是“要改什么功能”，而是“到底是哪一块 UI”。

```text
把这个按钮往右一点。
不是整个卡片，是标题下面那一行。
这个 hover 状态不对，你看我鼠标指的这个元素。
这一组列表项都要改，但每个改法不一样。
```

截图、自然语言和文件搜索都很容易丢上下文。ui-inspect 把浏览器里的“我正在看的这里”变成 agent 可以直接使用的数据，让它从真实页面出发，再回到源码里修改。

## 它做什么

| 能力 | 说明 |
| --- | --- |
| 浏览器元素选择 | 采集被选元素的 DOM、selector、文本、尺寸、组件信息和源码 hint |
| 源码定位 | 将页面元素关联到文件路径、行号范围、模板片段和样式来源 |
| 批量任务 | 一次选择多个元素，为每个目标写不同备注后一起交给 agent |
| 排错上下文 | 将用户确认过的 console error、warning 和运行时摘要发送给 agent |
| MCP 工具链 | 通过 `start_ui_inspect`、`wait_for_frontend_request`、`complete_frontend_request` 等工具形成连续任务 loop |
| CLI 等价入口 | 在没有 MCP 主动调用时，也可以用 CLI 查看 selection、等待任务、回复、完成任务和更新状态 |
| 自动接入 | `setup` 可以配置前端集成、MCP 配置和支持的 hooks，不写 `AGENTS.md` |

## 支持范围

### Agent / MCP Client

ui-inspect 不绑定某个编辑器或模型。只要 agent 支持 MCP stdio，就可以接入。

当前自动安装器覆盖：

| Agent | MCP 配置 | Hooks |
| --- | --- | --- |
| Claude Code | 支持 | 支持 |
| Cursor | 支持 | 支持 |
| Codex | 支持 | 安装共享脚本，但不自动启用 |
| OpenCode | 支持 | 安装共享脚本，但不自动生成插件 |

说明：ui-inspect 不会写入 `AGENTS.md`、`CLAUDE.md` 或 Cursor rules。agent 使用说明由 MCP server 的 instructions 分发，避免项目文件里残留重复指令。

### 前端项目

| 场景 | 包 |
| --- | --- |
| MCP server / CLI | `@ui-inspect/cli` |
| Vite | `@ui-inspect/vite-plugin` |
| Next.js | `@ui-inspect/next` |
| Webpack | `@ui-inspect/webpack-plugin` |
| Rspack | `@ui-inspect/rspack-plugin` |
| Rsbuild | `@ui-inspect/rsbuild-plugin` |
| 协议类型 | `@ui-inspect/protocol` |

Vite 项目可以自动安装并 patch；Next.js 会尝试自动安装 `@ui-inspect/next`，但 layout/API route 文件仍给出手动接入指引；Webpack、Rspack、Rsbuild 会给出插件接入指引。

## 快速开始

### 1. 自动接入

在前端项目根目录运行：

```bash
npx -y @ui-inspect/cli@latest setup --dry-run
npx -y @ui-inspect/cli@latest setup
```

`setup` 会尽量完成三件事：

- 检测当前前端项目，并配置可自动接入的插件。
- 为支持的本地 agent 写入 MCP 配置。
- 为支持 hooks 的 agent 安装或配置 hooks。

它不会写入 agent 指令 Markdown。想只配置某一部分，可以这样运行：

```bash
ui-inspect setup project
ui-inspect setup agent --agent claude
ui-inspect setup agent --agent cursor
ui-inspect setup agent --agent codex
ui-inspect setup agent --agent opencode
ui-inspect setup doctor
```

### 2. 启动前端项目

按项目原本方式启动 dev server：

```bash
npm run dev
```

### 3. 在 agent 里启用

对你的 coding agent 说：

```text
启用 ui-inspect
```

也可以说：

```text
使用 ui-inspect
调用 ui-inspect
启动 ui-inspect
打开 UI 检查
start ui-inspect
enable ui-inspect
```

agent 会先调用 `start_ui_inspect` 来启动或校验本地 daemon，并检查项目接入状态；再调用 `wait_for_frontend_request`。如果前端集成已经完成，浏览器页面出现 Diana 面板后，你就可以选择元素、补充要求并 Send。

## 手动 MCP 配置

如果你不想用自动安装器，可以手动把 MCP server 加到 agent 配置里。

JSON 风格：

```json
{
  "mcpServers": {
    "ui-inspect": {
      "command": "npx",
      "args": ["-y", "@ui-inspect/cli@latest", "mcp"]
    }
  }
}
```

TOML 风格：

```toml
[mcp_servers.ui-inspect]
type = "stdio"
command = "npx"
args = ["-y", "@ui-inspect/cli@latest", "mcp"]
```

OpenCode 风格：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ui-inspect": {
      "type": "local",
      "command": ["npx", "-y", "@ui-inspect/cli@latest", "mcp"],
      "enabled": true
    }
  }
}
```

## 手动前端接入

### Vite

```bash
npm install -D @ui-inspect/vite-plugin@latest
```

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { uiInspect } from '@ui-inspect/vite-plugin';

export default defineConfig({
  plugins: [vue(), uiInspect()],
});
```

### Next.js

Next.js 使用 `@ui-inspect/next`。App Router 和 Pages Router 的文件位置不同，建议看完整指南：

[Next.js 接入说明](docs/zh-CN/getting-started.md#nextjs)

### Webpack / Rspack / Rsbuild

这些构建器都有独立插件包。完整配置见：

[前端项目接入](docs/zh-CN/getting-started.md)

## 推荐工作流

ui-inspect 最适合配合 agent 连续处理浏览器任务：

```text
启用 ui-inspect，并持续处理我从浏览器发送的任务。
```

理想流程是：

```text
start_ui_inspect
  -> wait_for_frontend_request
  -> agent 阅读浏览器上下文和源码 hint
  -> agent 修改项目代码
  -> complete_frontend_request
  -> 自动等待下一条浏览器 Send
```

`complete_frontend_request` 会完成当前任务、把回复写回浏览器面板，并继续等待下一条任务。这样你可以一直留在浏览器里选元素、发要求，而不用每次回到聊天窗口提醒 agent。

MCP server 不能主动唤醒 agent，所以连续处理依赖 agent 遵守 MCP instructions。对支持 hooks 的 agent，`setup` 会尽量配置 hooks 来减少漏接任务的概率。

## 浏览器任务里有什么

agent 收到 `wait_for_frontend_request` 的结果后，通常应该优先看这些字段：

| 字段 | 用途 |
| --- | --- |
| `elementSnapshotSummary` | Cursor 风格的元素快照：ELEMENT、PATH、ATTRIBUTES、COMPUTED STYLES、POSITION、INNER TEXT 和 HTML |
| `domSearchHints` | 从元素和祖先节点提取的高价值 class/id/text 搜索线索，帮助 agent 快速定位源码 |
| `contextSummary` | 当前选择或任务的快速摘要 |
| `targetsSummary` | 批量模式下每个目标的选择信息和备注 |
| `sourceHintSummary` | 可能相关的源码文件、行号和置信度 |
| `runtimeSummary` | troubleshoot 模式下的 console 诊断摘要 |
| `session` | 当前任务状态、消息和会话 id |
| `nextCursor` | 完成任务后继续等待下一条请求所需的游标 |

如果 compact 响应里没有完整源码，agent 可以调用 `get_frontend_source`，或者请求 `responseMode: "full"`。

## CLI 常用命令

```bash
ui-inspect setup [all|agent|project|doctor]
ui-inspect update
ui-inspect status
ui-inspect selection --json
ui-inspect sessions
ui-inspect wait
ui-inspect task-status --status working
ui-inspect reply --content "我在处理"
ui-inspect complete --session-id <id> --after-request-id <id> --content "已完成"
ui-inspect source --context 80
ui-inspect clear
```

更多参数见 [MCP 与 CLI 参考](docs/zh-CN/reference.md)。

## 更新

在前端项目根目录运行：

```bash
ui-inspect update
```

常用选项：

```bash
ui-inspect update --dry-run
ui-inspect update --project /path/to/frontend
ui-inspect update --self
```

`update` 会尝试更新当前项目里的 ui-inspect 前端集成包。`--self` 会尝试更新全局安装的 CLI。如果 MCP 配置使用 `npx -y @ui-inspect/cli@latest mcp`，通常只需要重启 agent/MCP 会话即可获得最新 CLI。

更新后建议：

- 重启前端 dev server，让浏览器注入脚本刷新。
- 重启 agent/MCP 会话，避免旧进程继续运行。

## 工作原理

```text
浏览器页面
  -> Diana 面板
  -> 本地 ui-inspect daemon
  -> MCP tools / CLI
  -> AI coding agent
  -> 工作区源码
```

各部分职责：

| 模块 | 职责 |
| --- | --- |
| 浏览器插件脚本 | 采集选择、样式、组件和运行时诊断 |
| Diana 面板 | 展示悬浮入口、任务状态、历史消息和 Send 操作 |
| daemon | 保存本地会话，读取源码，提供 HTTP API |
| MCP server | 把浏览器上下文暴露给 agent |
| CLI | 提供 MCP 等价的命令行入口和安装器 |
| 前端插件包 | 把 ui-inspect 注入到 Vite、Next.js、Webpack、Rspack、Rsbuild 项目 |

## 安全边界

- ui-inspect 不会从浏览器直接修改源码。
- ui-inspect 不会自动发送 cookies、localStorage、网络请求正文或截图。
- console 诊断需要用户确认后才会进入任务上下文。
- 会话历史保存在当前项目的 `.ui-inspect/sessions.json`。
- daemon 默认服务本地开发场景，请只在可信工作区使用。
- agent 是否修改代码、如何修改代码，仍由你使用的 coding agent 决定。

## 文档

| 文档 | 内容 |
| --- | --- |
| [快速开始](docs/zh-CN/getting-started.md) | MCP 配置和各类前端项目接入 |
| [Agent 使用指南](docs/zh-CN/agent-guide.md) | agent 如何正确调用 MCP tools |
| [MCP 与 CLI 参考](docs/zh-CN/reference.md) | tools、命令、本地数据和协议说明 |
| [维护者指南](docs/zh-CN/maintainer.md) | 本地开发、检查和发布前验收 |
| [发布流程](docs/release-flow.md) | dev、release、main 分支发布规则 |

## Roadmap

- 更稳定的 React、Next.js、Svelte、Angular 源码定位。
- 更完整的 CSS cascade 和跨文件样式来源分析。
- 更成熟的 OpenCode / Codex hooks 自动配置。
- 更友好的安装器输出、卸载器和配置修复能力。
- 更强的批量选择、历史任务和浏览器内反馈体验。

## 贡献

欢迎提交 issue、想法和 PR。

ui-inspect 的方向很简单：把浏览器里的真实前端事实，变成 AI coding agent 可以可靠使用的上下文。

## 仓库

[github.com/MashiroJ/ui-inspect](https://github.com/MashiroJ/ui-inspect)
