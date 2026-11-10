# API v1

服务默认提供只读汇总，不提供写入或网关代理功能。

```http
GET /api/v1/overview
Authorization: Bearer <local-read-only-token>
```

缺失或错误令牌返回 401。令牌查询参数不被接受。仅支持 GET / HEAD；其他方法返回 405。所有响应禁用缓存，API 不开放跨域访问。

## 响应

| 字段 | 含义 |
|---|---|
| schemaVersion | 固定为 1 |
| generatedAt | 本次投影时间；不是厂商额度的读取时间 |
| timezone | Asia/Shanghai |
| sources.quotas / today / week | 每个来源的 state 与 observedAt |
| display | 本次生效的展示配置（回显 PC 端 `display` 段） |
| subscriptions | 当前有效套餐卡片，按 `display.subscriptions` 过滤并排序 |
| usage.today / week | 今日与七日指标；未读取时为 null |
| trend | 七日逐日指标 |
| rankings.models / agents / providers / computers | 近七日排行，条数由 `display` 决定 |

来源 state 为 `ok`、`stale` 或 `unavailable`。读取失败或超过三分钟未成功观测时为 stale。跨日的今日读数也标记 stale，增加 `outdated: true` 并将 `usage.today` 设为 null。

额度按厂商优先采用正常接口结果；接口缺项、报错或没有有效窗口时，依次使用 Magpie 本地 `quotas.json` 和服务上次成功结果，整组保留同厂商的独立账号。回退卡片的 `stale` 为 true，`updatedAt` 保持原始读取时间；全部卡片均为回退结果时，`sources.quotas.state` 也为 `stale`。缓存不能使已经到期的窗口恢复有效。

`display` 段字段：

| 字段 | 含义 | 默认 |
|---|---|---|
| modelLimit | `rankings.models` 条数，1–20 | 8 |
| agentLimit | `rankings.agents` 条数，1–20 | 6 |
| providerLimit | `rankings.providers` 条数，1–20 | 20 |
| computerLimit | `rankings.computers` 条数，1–20 | 20 |
| subscriptions | 套餐展示的 id 列表与顺序；`*` 表示全部 | `["codex","minimax","glm"]` |

模型与厂商条目来自 Magpie 的实际用量，不做模型名白名单以外的裁剪：同一模型若以不同厂商前缀或不同大小写出现（如 `glm-5.3`、`GLM-5.3`、`zhipu/glm-5.3`），会合并为一行并累加各项计数。厂商标签按上游稳定 id 解析（`minimax-cn` → `MiniMax`、`zhipu` → `GLM`、`session-unknown` → `本地会话`）；无法识别的 id 显示为 `Unknown`，上游自由文本不会作为标签输出。

Agent 条目同样按上游稳定 id 解析，覆盖 Magpie 已知的全部 agent（`claude` → `Claude Code`、`mimocode` → `MiMo Code`、`dsh` → `DeepSeek Harness`、`morph` → `Mister Morph` 等）；上游的 `name` 可能来自客户端 User-Agent，因此不作为标签输出。在 WSL 中运行的 agent 会在 id 后带 `@发行版`（如 `codex@wsl:Ubuntu-22.04`），仍按 agent 本身显示。

`subscriptions` 的顺序即手机组件的显示顺序；API 保留全部所选套餐，分页仅在手机端进行。中号与大号每页最多显示 6 个，随当前页数量自动调整布局；通过组件参数 `page=2` 指定第二页，支持 `page=2|used`。默认第一页，无效页码使用第一页，超出范围使用最后一页；多页时显示当前页码及总页数。

套餐字段：`id`、`provider`、`label`、`plan`、`account`、`alias`、`updatedAt`、`stale`、`windows`。同一厂商有多个账号时，每个账号单独成卡：`id` 为 `厂商@账号`（如 `codex@liuzq`），`label` 为 `Codex · liuzq`，`account` 为账号标识；只有一个账号的厂商保持 `Codex` 这样的普通名称，不输出账号身份。账号只取上游 `user` 中 `@` 前的部分，邮箱域名与凭据不会离开本机。Magpie 中给账户起的名字（`magpie accounts alias codex <email> <name>`）由上游放在 `alias`，符合纯文本规则的才显示，出现在 `label` 与 `alias` 字段中，它不改变 `id`。`display.subscriptions` 既可写厂商名（`codex`），也可写某个账号（`codex@liuzq`）；组件参数同样支持这两种写法，厂商名表示该厂商的第一个账号。

额度 windows 包含：
- `label`：厂商窗口名。
- `usedPercent`、`remainingPercent`：0–100；未知为 null。
- `resetsAt`：UTC ISO 时间或 null。
- `expired`：窗口是否已到期；客户端在离线时也必须重新计算。
- `amount`、`limit`：厂商明确提供时保留；不推断额度单位。

每个套餐还带 `usage`：该套餐自己的今日用量（`today.totalTokens`、`today.requests`）。同一厂商有多个账号时，这是那一个账号自己的用量（Magpie 按账号过滤用量后只回总量，账号地址不离开本机、不写入快照）；只有一个账号的厂商，取该厂商自己的用量行。取不到时为 null，客户端不得用全量顶替。

指标字段：`requests`、`errors`、`inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens`、`totalTokens`、`cacheHitPercent`、`cost`、`unpriced`、`outputTokensPerSecond`、`ttftMs`。缓存命中率分母为输入＋缓存读取＋缓存写入，与 `totalTokens` 的口径一致；分母为 0 时为 null。`cost` 为 Magpie 按实效价格的估算值，`unpriced` 为未计价请求数（估算可能偏低），货币单位以 Magpie 价格表为准；`outputTokensPerSecond` 为流式解码吞吐，`ttftMs` 为平均首字延迟，两者只统计有测量的请求，无测量时为 null。

总 Token = 输入＋输出＋缓存读取＋缓存写入。额度百分比是厂商独立指标，不与这个总数换算；详情页与组件可在剩余/已用两种视图间切换。费用为 Magpie 的估算值，仅供参考；账户账单不属于本接口。

## 其他路由

- `GET /health`：最小存活响应，不包含用量或系统信息。
- `GET /`：详情页外壳，真实统计仍需令牌。
- `GET /scriptable/SetupUsageWidget.js`、`GET /scriptable/UsageWidget.js`：无密钥的公开脚本。

未列出的静态路径返回 404；本地配置、原始日志、Git 文件与快照不会通过静态路由公开。
