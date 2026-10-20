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
| rankings.models / providers / computers | 近七日排行，条数由 `display` 决定 |

来源 state 为 `ok`、`stale` 或 `unavailable`。读取失败或超过三分钟未成功观测时为 stale。跨日的今日读数也标记 stale，增加 `outdated: true` 并将 `usage.today` 设为 null。

`display` 段字段：

| 字段 | 含义 | 默认 |
|---|---|---|
| modelLimit | `rankings.models` 条数，1–20 | 8 |
| providerLimit | `rankings.providers` 条数，1–20 | 20 |
| computerLimit | `rankings.computers` 条数，1–20 | 20 |
| subscriptions | 套餐展示的 id 列表与顺序；`*` 表示全部 | `["codex","minimax","glm"]` |

模型与厂商条目来自 Magpie 的实际用量，不做模型名白名单以外的裁剪：同一模型若以不同厂商前缀或不同大小写出现（如 `glm-5.3`、`GLM-5.3`、`zhipu/glm-5.3`），会合并为一行并累加各项计数。厂商标签按上游稳定 id 解析（`minimax-cn` → `MiniMax`、`zhipu` → `GLM`、`session-unknown` → `本地会话`）；无法识别的 id 显示为 `Unknown`，上游自由文本不会作为标签输出。

套餐字段：`id`、`provider`、`label`、`plan`、`updatedAt`、`stale`、`windows`。多个同厂商账号使用匿名序号，不输出账号身份。额度 windows 包含：
- `label`：厂商窗口名。
- `usedPercent`、`remainingPercent`：0–100；未知为 null。
- `resetsAt`：UTC ISO 时间或 null。
- `expired`：窗口是否已到期；客户端在离线时也必须重新计算。
- `amount`、`limit`：厂商明确提供时保留；不推断额度单位。

指标字段：`requests`、`errors`、`inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens`、`totalTokens`、`cacheHitPercent`。缓存命中率分母为输入＋缓存读取＋缓存写入，没有输入时为 null。

总 Token = 输入＋输出＋缓存读取＋缓存写入。额度百分比是厂商独立指标，不与这个总数换算。费用与账户账单不属于本接口。

## 其他路由

- `GET /health`：最小存活响应，不包含用量或系统信息。
- `GET /`：详情页外壳，真实统计仍需令牌。
- `GET /scriptable/SetupUsageWidget.js`、`GET /scriptable/UsageWidget.js`：无密钥的公开脚本。

未列出的静态路径返回 404；本地配置、原始日志、Git 文件与快照不会通过静态路由公开。
