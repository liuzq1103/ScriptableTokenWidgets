# ScriptableTokenWidgets

让 iPhone 桌面显示 **Codex Plus、MiniMax、GLM 的套餐余量与真实 Token 用量**。数据直接来自 Magpie，保持它已有的跨设备同步与统计口径。

黑白灰、细进度条、少量状态色。一个中号组件，默认三家订阅（数量与顺序在 PC 端配置）；点击进入手机详情页。

> 预览使用虚构演示数据，不代表真实账号、模型价格或套餐消耗。

![虚构数据的详情页预览](docs/preview-desktop.png)

## 如何工作

```mermaid
flowchart LR
  S[服务器 Magpie] -->|既有用量同步| M[PC Magpie]
  A[PC 上的 Agent 与网关] --> M
  M -->|本机只读 API| B[Node.js 观测服务]
  B -->|Tailscale 私有连接| W[iPhone Scriptable]
  W -->|点击| D[手机详情页]
```

- 所选套餐的剩余比例、5 小时／周额度窗口与重置时间，以 Magpie 实际返回为准；详情页与组件均可切换剩余／已用两种视图。
- 今日 Token、七日趋势、模型／厂商／客户端排行和两端设备用量，包含 Magpie 已识别的原生 Agent 日志。模型与厂商条目来自实际用量，新增模型无需改代码。客户端排行覆盖 Magpie 支持的全部 agent，每个 agent 按自己的名称显示（Claude Code、Codex、Gemini CLI、OpenCode、MiMo Code、DevEco Code、Pi、Goose、Cursor CLI、Copilot CLI、VS Code、Crush、DeepSeek Harness、Command Code、fx、omp、OmO、Devin、Hermes Agent、Mister Morph、Kimi Code、Muse Code、Empryo、MiniMax Code、Droid、Grok Build、ZCode、OpenHanako、AtomCode、Snow CLI、QwenPaw 等）。
- 预估费用与流式输出速度为 Magpie 的估算值，在详情页与排行的费用列中展示。
- Token 为输入＋输出＋缓存读取＋缓存写入；推理用量单列，已含在输出中。
- 深浅色自适应；网页也可手动切换。断网保留最后结果，窗口到期不会伪造新额度。
- 后端每分钟汇总，组件申请约五分钟刷新，实际由 iOS 调度。
- 无第三方运行依赖，无 Docker、n8n、数据库或公网入口。

## 在 PC 安装

需要 Windows、Node.js 22+、已运行的 Magpie，以及已连接的 Tailscale。PC 与 iPhone 必须能按你的 Tailnet 访问规则互通。

在当前用户的 PowerShell 中执行：

```powershell
git clone https://github.com/liuzq1103/ScriptableTokenWidgets.git
cd ScriptableTokenWidgets
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1
```

安装器会生成独立只读令牌，创建隐藏运行的当前用户登录任务，并配置仅在 Tailnet 内可用的 TCP 转发。它不会改动 Magpie 配置或订阅登录。该转发无需 HTTPS 域名或 Windows 防火墙管理员权限；其他 Serve 端口保持原样。

**连接地址和令牌位于 `.local/iphone-setup.txt`。请在本地打开，不要上传到 GitHub。**

## 在 iPhone 安装

1. 安装 [Scriptable](https://scriptable.app/)，连接 Tailscale。
2. 打开 [SetupUsageWidget.js](scriptable/SetupUsageWidget.js)，复制完整内容，在 Scriptable 新建脚本后粘贴、运行。
3. 填入本地连接说明中的 Service URL 和 Read-only token。安装器验证连接后自动下载 `UsageWidget`。
4. 长按 iPhone 桌面添加 Scriptable 小组件，选择 `UsageWidget`，推荐中号。

   不要用 Scriptable 脚本内的 "Add to Home Screen" 按钮：它在较新的 iOS 上会被 Safari 拦截并提示"不允许使用受限制的网络端口"，与你的服务无关。

| 尺寸 | 内容 | Widget Parameter |
|---|---|---|
| 小号 | 单家额度、重置倒计时、今日 Token | `codex`（默认）、`minimax`、`glm`；某账号写作 `codex@账号名`；加 `|used` 改显已用 |
| 中号 | 每页最多 6 个；1–4 个并排，5–6 个两行三列；今日 Token | 留空；`page=2` 查看第二页 |
| 大号 | 每页最多 6 个；两列卡片，显示主额度、重置时间及第二窗口百分比；今日与近七日 Token | 留空；`page=2` 查看第二页 |

订阅增减后布局自动调整。同一厂商登录了两个账号时，两张卡分别显示为 `Codex · 账号名` 与 `Codex · 另一个账号名`（账号名取邮箱 `@` 前的部分；在 Magpie 里给账户起的名字会优先显示），只有一个账号时仍显示 `Codex`。同一厂商内的顺序按账号名排定，账号不会互相换位，参数 `codex` 永远指同一个账号；两个账号名字完全相同时，后一个带序号（`Codex · 账号名-2`）。中号 1–4 个时显示重置倒计时，5–6 个时采用紧凑卡片并省略倒计时。大号不再显示趋势图，趋势仍可在详情页查看。

正文按屏幕尺寸选择组件宽度，与页眉、页脚对齐；名称单独一行，卡片名称按长度取字号，长到放不下时才在手机上缩短，完整名字在详情页看得到；重置倒计时简写为 `3时49分`。主窗口相同时在页脚统一标注 `剩余 · 5h`，不同时各卡分别标注窗口。参考 [布局模拟预览](docs/preview-widgets.png)（演示数据，非 iOS 截图）。本地运行 `node scripts/preview-widgets.mjs` 可重新生成预览，需要 Python、Pillow 和 Windows 系统字体。

超过六个订阅时，每页显示六个并标注页码；在“编辑 Widget”的 Parameter 中填 `page=2`，或用 `page=2|used` 同时切为已用视图。默认第一页，不自动轮播；可以添加多个组件指定不同页，再用系统组件堆叠切换。无效页码回到第一页，超出范围显示最后一页，订阅减少后也会自动适配。

更新组件：将最新的 `SetupUsageWidget.js` 粘贴到手机安装器脚本并运行，已保存的地址和令牌会自动带入。验证并安装后，桌面现有的 `UsageWidget` 会使用新布局，无需重新添加组件。已有旧安装器也能下载新版组件，但需要重新填写地址和令牌。

令牌保存在 iPhone 的 Keychain，不需要将任何密钥写入脚本。点击组件打开详情页；网页会立即移除地址中的令牌片段，仅在本标签页保存访问状态。

小号组件按 Widget Parameter 选择套餐（默认 `codex`）。如果 PC 端 `subscriptions` 里没有这一家，组件显示"暂无该套餐"而不是回退到别家——改参数或在 PC 端加上这一家即可。同一个厂商有多个账号时，参数可写 `codex@liuzq` 指定其中一个账号，写 `codex` 表示该厂商的第一个账号；PC 端的 `subscriptions` 也接受这种写法。

小号组件底部的“今日 … token”是**这个套餐自己的**用量：多个账号时各算各的（今天没被调用的账号显示 0），只有一个账号的厂商按该厂商自己的用量算；参数没有对应的套餐时显示“—”，不用全部用量的合计顶替。中号与大号一次显示多个套餐，页脚仍是全部用量的合计。

## 日常维护

```powershell
.\scripts\status.ps1
.\scripts\restart.ps1
.\scripts\uninstall.ps1
```

展示项在 PC 端配置，手机端只渲染服务投影的结果：

```powershell
node scripts/configure.mjs --model-limit 12 --subscriptions codex,minimax,glm
.\scripts\restart.ps1
```

`modelLimit` 控制"常用模型"条数，`agentLimit` 控制"客户端"条数，`subscriptions` 控制手机组件显示哪些套餐及顺序。中号与大号组件在 Widget Parameter 填 `used` 可整体切换为已用视图。模型与厂商条目来自 Magpie 的实际用量，新增模型无需改代码。

任务在当前用户登录后启动；PC 睡眠、关机或未登录时，手机显示最后缓存。卸载保留本地配置与缓存，并只清理本项目创建的转发。

更多配置、排障与验收说明见 [部署文档](docs/DEPLOYMENT.md)，接口字段见 [API 文档](docs/API.md)，独立模型复核进展见 [复核记录](docs/REVIEW.md)。

## 本地验证与虚构预览

```powershell
npm test
npm run check
npm run demo
```

演示服务仅监听本机 `8800`，打开 `http://127.0.0.1:8800/#token=demo`。它使用内置虚构数据，不读取真实账号或写入生产快照。按 Ctrl+C 退出。

已配置真实服务时，还可运行 `node scripts/verify-live.mjs`，核对 Magpie 同一批响应中的统计，不输出私人用量或凭据。CI 在 Windows 与 Linux 上运行边界测试、语法与发布隐私检查；iOS 原生排版与系统刷新仍需真机确认。

## 来源与许可

项目采用 [MIT](LICENSE)。参考了 [DaleXiao/ScriptableTokenWidgets](https://github.com/DaleXiao/ScriptableTokenWidgets) 的产品思路和 [Hj714110-oss/ScriptableTokenTrackerV2](https://github.com/Hj714110-oss/ScriptableTokenTrackerV2) 的功能组织；当前组件、网页与后端为独立实现，未复制两个参考目录的源文件。

数据接口依据 [Magpie 官方文档](https://github.com/yetone/magpie/blob/main/docs/reference.md)。本项目并非 Magpie、OpenAI、MiniMax 或智谱的官方客户端。[第三方说明](THIRD_PARTY_NOTICES.md)。
