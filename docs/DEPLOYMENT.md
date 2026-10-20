# 部署与维护

## 数据前提

PC 上 Magpie 的网关需要正在运行，默认地址为 `http://127.0.0.1:3425`。请在 Magpie 中开启现有两台机器之间的用量同步；共享 Agent 配置本身不保证历史用量同步。

后端读取：
- `GET /v1/magpie/quotas?kept=1`：Magpie 保留的额度读数，不额外触发厂商查询。
- `GET /v1/magpie/usage/requests?period=today&limit=1`。
- `GET /v1/magpie/usage/requests?period=7d&limit=1`。

后两个接口已包含 Magpie 原生会话解析、网关统计、同步与去重。普通 `/v1/magpie/usage` 接口的覆盖范围较窄，本项目不使用它。返回的单条原始请求会立即丢弃，仅保留统计字段。

可展示名称按字段类型限制：已知套餐和窗口名称、常见模型标识及受限设备名；不符合规则的名称使用通用标签，统计数值保留。趋势标签由时间戳生成，加载旧缓存时同样重新过滤。自定义模型名称可能显示为 Unknown。

额度 API 缺失读取时间时，补充读取 Magpie `quotas.json` 中对应套餐的时间戳；文件中的账号标识与其他字段不输出、不保存到快照。后端不会读取模型 API Key 或 OAuth 登录文件。

## 安装和配置

运行 `scripts/install.ps1`。配置文件在 `.local/config.json`，包括：
- `port`：默认 8799。
- `nodePath`：配置时实际使用的 Node 可执行文件，计划任务与防火墙规则共同使用；更换 Node 安装位置后重新安装。
- `upstream`：只接受本机回环 HTTP 地址。
- `magpieDir`：当前用户的 Magpie 配置目录。
- `tailnetIP`、`phoneIPs`：自动识别的设备地址。
- `token`：随机生成的 256 位只读令牌。

整个 `.local` 目录使用当前用户、SYSTEM 和 Administrators 的访问权限，且被 Git 忽略。再次安装保留令牌。不要在共享终端打印配置内容。

### 展示配置

`.local/config.json` 的 `display` 段决定详情页与手机组件显示多少内容。手机端不保存任何展示选项，只渲染服务投影的结果。

| 键 | 含义 | 默认 |
|---|---|---|
| `modelLimit` | "常用模型"显示条数，1–20 | 8 |
| `providerLimit` | 厂商排行条数 | 20 |
| `computerLimit` | 设备排行条数 | 20 |
| `subscriptions` | 手机组件显示哪些套餐及顺序（`codex` / `minimax` / `glm`；`*` 表示全部） | `["codex","minimax","glm"]` |

用配置脚本调整（会保留令牌、端口与其它设置）：

```powershell
node scripts/configure.mjs --model-limit 12 --subscriptions codex,minimax,glm
```

改完重启服务生效：

```powershell
.\scripts\restart.ps1
```

模型与厂商条目本身来自 Magpie 的实际用量，新增模型无需改代码。**新增订阅家族**（Magpie 里出现本项目未映射的额度卡）需要在 `backend/normalize.mjs` 的 `PROVIDERS` 增加一行 id 与固定显示名，再写进 `subscriptions`；标签只允许取自代码里的固定映射，不读取上游自由文本。

默认安装器使用 [Tailscale TCP 转发](https://tailscale.com/docs/reference/tailscale-cli/serve)，将 Tailnet 上的本项目端口转发至本机回环服务。转发在 Tailscale 重启后保留，不需要开启公网 Funnel。已有同端口且指向其他目标的转发会阻止安装，不覆盖它。

如希望直接通过 Windows 网络栈提供服务，可在管理员 PowerShell 中使用 `scripts/install.ps1 -Firewall`；它仅为当前 iOS Tailnet 对端建立精确的本地地址、端口和 Node 程序规则。默认模式不需要此规则。

两种模式之间切换时，先运行 `scripts/uninstall.ps1` 清理当前模式，再安装另一模式；卸载防火墙模式需要管理员 PowerShell。安装器会在任何配置或任务改动前阻止带有旧模式记录的直接切换，避免旧入口绕过新的限制。默认转发的访问范围由 Tailnet ACL 和本项目令牌控制，防火墙模式的规则另有限制 iOS 对端。

任务名为 `ScriptableTokenWidgets`，当前用户登录后隐藏启动，无最长运行时间，失败每分钟重启。它不是登录前启动的系统服务。再次安装会重启已有服务，使代码和配置立即生效；新建或迁移网络入口前，安装器先验证带鉴权的本机 API，启动失败时不会新增转发。

创建或迁移网络入口前，会先原子保存待完成的归属记录；若安装中断，再运行同模式安装器即可核验并继续，也可卸载清理。发现实际目标被其他配置改动时会保留并报错，不执行全局重置。

## iPhone 使用

本地 `.local/iphone-setup.txt` 保存服务地址、只读令牌和含令牌片段的详情页地址。通过你自己的方式将这些信息交给手机，不要提交或公开分享。

在 Scriptable 新建安装器脚本，粘贴仓库中的 `SetupUsageWidget.js` 全文并运行。验证成功后，组件写入 Scriptable 的 iCloud 文档目录（iCloud 不可用时使用本机目录）；Keychain 保存连接信息，本机文档目录保存最后成功快照。已有同名且不是本项目的脚本不会被覆盖。

再次运行安装器可以更新或重新配置组件。iOS 可能在首次运行时询问网络、文件或 Keychain 相关权限，需要由你在手机上完成。

**添加桌面组件用系统的小组件机制**：长按桌面空白处 → 左上角"＋" → 搜索 Scriptable → 选**中号**小组件 → 长按组件 → "编辑 Widget" → 脚本选 `UsageWidget`。不要用 Scriptable 脚本内的 "Add to Home Screen" 按钮，它在较新的 iOS 上会被 Safari 拦截（见"iPhone 上打不开详情页"）。

## 刷新与数据状态

| 场景 | 行为 |
|---|---|
| 正常运行 | PC 每分钟读取三路 Magpie 数据；网页前台每分钟请求汇总 |
| 额度未刷新 | 显示最后的读数时间；超过 15 分钟标记缓存额度 |
| 服务刚重启 | 快照先标记缓存，首次采集成功后恢复正常 |
| Magpie 部分不可达 | 保留对应来源上次结果，其他来源继续更新 |
| PC 或 Tailscale 不可达 | 组件保留最后成功缓存并标记离线 |
| 首次运行且无缓存 | 显示连接或设置提示，不显示虚构的零用量 |
| 窗口已经到期 | 显示待更新，不将剩余额度自动设为 100% |
| 上海时区跨日且仍离线 | 今日用量显示未知，避免将昨天的累计标为今天 |
| 原始用量未同步 | 只显示 Magpie 已合并的数据，不推算服务器缺失部分 |

五分钟是组件的刷新申请，不是 iOS 的保证间隔。网页“刷新”读取最近一分钟的后端汇总，不强制刷新厂商额度；需要最新额度时在 Magpie 中刷新。Token 与套餐百分比是两种口径，API 等价成本没有作为实际费用展示。

## 检查与排障

```powershell
.\scripts\status.ps1
node scripts/tailnet.mjs status
node scripts/verify-live.mjs
```

- 本机 API 不可达：检查任务和 `.local/service.log`、`.local/service-error.log`，再运行重启脚本。
- 手机不可达：确认两端 Tailscale 已连接、Tailnet ACL 允许访问该端口，再检查转发状态。
- 缺少额度：在 Magpie 中确认对应订阅或 Coding Plan 登录有效，并等待 Magpie 自动更新额度。
- 少算服务器用量：确认 Magpie 的用量同步开启，且服务器端已产生并同步该天的记录。
- 端口冲突：修改本地配置端口后重新运行安装器；它会依据本项目的归属记录移除旧转发并创建新转发。若原转发已被修改或新端口属于其他目标，安装器报错并保留相关配置。不要使用 `tailscale serve reset` 清空其他服务。
- 地址或 iPhone 更换：再次配置；若使用直接防火墙模式，还需重新应用对应精确规则。
- 令牌需要更换：停止服务，在本地配置中删除 token 字段，再运行安装器生成新令牌，最后重新运行手机安装器。

## iPhone 上打不开详情页

### 提示"不允许使用受限制的网络端口"

**这不是本服务的问题，也不是端口被封。** 先看 Safari 地址栏：

- 地址栏是 `data:text/html;base64,…` → 是 **Scriptable 的 "Add to Home Screen" 功能**。它会生成一个内嵌的引导页（标题是脚本名，提示"Run script from home screen"，图标指向手机本机的 `http://localhost:8425/…`）并要求 Safari 打开它。新版 iOS Safari 禁止从其它 App 跳转打开 `data:` 网址，于是直接拦截并显示该提示，**根本还没访问到你的服务**。
  - 处理：关掉那个页面即可。桌面组件要通过系统的小组件机制添加——长按桌面空白处 → 左上角"＋" → 搜索 **Scriptable** → 选**中号**小组件 → 长按组件 → "编辑 Widget" → 脚本选 `UsageWidget`（中号参数留空；小号才填 `codex` / `minimax` / `glm`）。
  - 该功能创建的是"运行脚本的图标"，与本项目需要的 Scriptable 小组件不是一回事，正常流程本来就不需要它。
- 地址栏是 `http://<Tailscale IP>:8799/…` → 才需要按下面的连接问题排查。本项目默认端口 8799 不在 Safari 的受限端口名单内；若地址栏里的端口与 `.local/iphone-setup.txt` 不一致，多半是地址敲错或用了旧地址。

### 其它常见现象

| 现象 | 原因与处理 |
|---|---|
| Safari 显示"无法连接"或空白页 | 两端 Tailscale 未连接；或 Tailnet ACL 未放行该端口。用 `node scripts/tailnet.mjs status` 确认转发仍在。 |
| 组件显示"离线缓存" | PC 睡眠、关机或未登录，组件保留最后一次成功快照；PC 恢复后自动更新。 |
| 组件提示"令牌无效，请重新设置" | 本地配置的令牌已更换或 `.local/config.json` 被重写，重新运行 `SetupUsageWidget.js` 并填入新的令牌。 |
| 组件显示"暂时无法连接" | 首次运行还没有缓存，且这次请求失败。检查 PC 服务与 Tailscale 后重跑组件。 |
| 点组件打不开详情页 | 详情页地址由 `SetupUsageWidget.js` 写入 Keychain 的 `baseURL` 决定。重新运行安装器可重写。 |
| 详情页要求输入令牌 | 浏览器用片段 `#token=` 传令牌，页面加载后立即从地址栏移除，只在该标签页的 sessionStorage 里保存。跨标签页或重启浏览器后需重新输入。 |

## 验证边界

自动测试还在临时目录中模拟 Windows 计划任务、启动探测和防火墙接口，验证重装会重启、失败不新增入口、不同网络模式拒绝直接混用，以及规则归属检查；它不会改动测试机器的真实任务或防火墙。

自动测试执行真实组件脚本并模拟 Scriptable API，覆盖小中大三种布局分支、首次设置、离线和过期读数。浏览器预览检查响应式页面和深浅色。它们不能替代 iOS 上的真实字体、组件尺寸和刷新调度验证。

卸载脚本只删除本项目任务、由本项目管理且目标未变化的 TCP 转发，以及有本项目归属记录且校验一致的防火墙规则；保留个人配置、缓存和 Magpie。只读令牌拥有读取汇总的权限，无法使用模型网关或修改账号配置。
