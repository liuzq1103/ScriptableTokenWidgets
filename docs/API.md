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
| subscriptions | 当前有效 Codex / MiniMax / GLM 卡片 |
| usage.today / week | 今日与七日指标；未读取时为 null |
| trend | 七日逐日指标 |
| rankings.models / providers / computers | 近七日排行 |

来源 state 为 `ok`、`stale` 或 `unavailable`。读取失败或超过三分钟未成功观测时为 stale。跨日的今日读数也标记 stale，增加 `outdated: true` 并将 `usage.today` 设为 null。

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
