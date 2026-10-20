// UsageWidget · ScriptableTokenWidgets · MIT
// Configure once with SetupUsageWidget.js. No credentials belong in this file.
const SETTINGS_KEY = "usage-bridge-v1";
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "usage-bridge-cache.json");
const family = ["small", "medium", "large"].includes(config.widgetFamily) ? config.widgetFamily : "medium";
const dark = Device.isUsingDarkAppearance();
const colors = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1f221e")),
  text: Color.dynamic(new Color("#232523"), new Color("#ebeee7")),
  muted: Color.dynamic(new Color("#8a8f85"), new Color("#92998d")),
  track: dark ? new Color("#30362d") : new Color("#eef0eb"),
  fill: dark ? new Color("#b9c8b0") : new Color("#4c544a"),
  warning: new Color(dark ? "#d2a061" : "#b77c36"),
  critical: new Color(dark ? "#e09c88" : "#b35447")
};
const widget = new ListWidget();
widget.backgroundColor = colors.bg;
widget.setPadding(14, 16, 14, 16);
widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);
let settings, data, cached = false, failure = "";
try { settings = JSON.parse(Keychain.get(SETTINGS_KEY)); } catch {}
try { if (fm.fileExists(cachePath)) data = JSON.parse(fm.readString(cachePath)); } catch {}
if (settings && settings.baseURL && settings.token) {
  try {
    const req = new Request(settings.baseURL + "/api/v1/overview");
    req.headers = { Authorization: "Bearer " + settings.token };
    req.timeoutInterval = 10;
    const fresh = await req.loadJSON();
    if (req.response && req.response.statusCode === 401) throw new Error("令牌无效");
    if (fresh.schemaVersion !== 1) throw new Error("数据格式不兼容");
    data = fresh;
    try { fm.writeString(cachePath, JSON.stringify(data)); } catch {}
  } catch (error) {
    cached = true;
    failure = String(error.message).includes("令牌") ? "令牌无效，请重新设置" : "离线缓存";
  }
  widget.url = settings.baseURL + "/#token=" + encodeURIComponent(settings.token);
}
function text(parent, value, size, color, weight) {
  const element = parent.addText(String(value));
  element.font = weight === "medium" ? Font.mediumSystemFont(size) : Font.systemFont(size);
  element.textColor = color || colors.text;
  element.lineLimit = 1;
  element.minimumScaleFactor = 0.7;
  return element;
}
function compact(value) {
  if (value == null) return "—";
  if (value >= 1e9) return (value / 1e9).toFixed(2).replace(/\.?0+$/, "") + "B";
  if (value >= 1e6) return (value / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (value >= 1e3) return (value / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.round(value));
}
function expired(window) {
  return window.expired || !!window.resetsAt && Date.parse(window.resetsAt) <= Date.now();
}
function remaining(window) { return expired(window) ? null : window.remainingPercent; }
function percent(window) { const value = remaining(window); return value == null ? "—" : Math.round(value) + "%"; }
function accent(window) {
  const value = remaining(window);
  return value == null ? colors.muted : value <= 10 ? colors.critical : value <= 25 ? colors.warning : colors.text;
}
function reset(window) {
  if (expired(window)) return "已到期 · 待更新";
  if (!window.resetsAt) return "重置时间未知";
  const mins = Math.ceil((Date.parse(window.resetsAt) - Date.now()) / 60000);
  if (mins < 60) return mins + " 分钟后重置";
  if (mins < 1440) return Math.floor(mins / 60) + "时 " + mins % 60 + "分后重置";
  return Math.floor(mins / 1440) + "天 " + Math.floor(mins % 1440 / 60) + "时后重置";
}
function windowLabel(window) {
  return /5\s*h|5\s*hour/i.test(window.label) ? "5h" : /7\s*d|7\s*day|week/i.test(window.label) ? "7d" : window.label;
}
function clock(value) {
  if (!value) return "未更新";
  return new Date(value).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false });
}
function bar(parent, window, width) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, 4); ctx.opaque = false; ctx.respectScreenScale = true;
  ctx.setFillColor(colors.track); ctx.fillRect(new Rect(0, 0, width, 4));
  const value = remaining(window);
  if (value != null) {
    ctx.setFillColor(value <= 10 ? colors.critical : value <= 25 ? colors.warning : colors.fill);
    ctx.fillRect(new Rect(0, 0, width * Math.max(0, Math.min(100, value)) / 100, 4));
  }
  const image = parent.addImage(ctx.getImage()); image.imageSize = new Size(width, 4);
}
function header(status) {
  const row = widget.addStack(); row.centerAlignContent();
  text(row, "usage.", 15, colors.text, "medium"); row.addSpacer();
  text(row, status, 9, cached ? colors.warning : colors.muted);
}
const emptyWindow = { label: "Quota", remainingPercent: null, resetsAt: null };
if (!settings || !data || data.schemaVersion !== 1) {
  header("未连接"); widget.addSpacer(18);
  text(widget, settings ? "暂时无法连接" : "先连接你的用量", 16, colors.text, "medium");
  widget.addSpacer(8);
  const hint = text(widget, settings ? "检查 PC 与 Tailscale，稍后重试。" : "运行 SetupUsageWidget 完成设置。", 11, colors.muted);
  hint.lineLimit = 3; widget.addSpacer();
} else {
  const observations = Object.values(data.sources).map(s => s.observedAt).filter(Boolean).sort();
  const day = value => new Date(value + 8 * 3600000).toISOString().slice(0, 10);
  if (data.sources.today.outdated || data.sources.today.observedAt && day(Date.parse(data.sources.today.observedAt)) !== day(Date.now())) data.usage.today = null;
  cached = cached || Object.values(data.sources).some(s => s.state !== "ok") || data.subscriptions.some(c => c.stale) || observations.some(s => Date.now() - Date.parse(s) > 180000);
  const status = failure || (cached ? "缓存 " : "") + clock(observations[0]);
  header(status);
  if (family === "small") {
    const requested = String(args.widgetParameter || "codex").trim().toLowerCase();
    const card = data.subscriptions.find(c => c.provider === requested);
    widget.addSpacer(12);
    const primary = card && card.windows[0] || emptyWindow;
    const name = widget.addStack();
    text(name, card ? card.label : "暂无该套餐", 12, colors.muted, "medium");
    name.addSpacer(4); text(name, windowLabel(primary), 9, colors.muted);
    widget.addSpacer(3); text(widget, percent(primary), 34, accent(primary), "medium");
    widget.addSpacer(7); bar(widget, primary, 120); widget.addSpacer(7);
    text(widget, reset(primary), 9, colors.muted);
    if (card && card.windows[1]) {
      widget.addSpacer(3); text(widget, windowLabel(card.windows[1]) + " 剩余 " + percent(card.windows[1]), 9, colors.muted);
    }
    widget.addSpacer();
    text(widget, "今日 " + compact(data.usage.today && data.usage.today.totalTokens) + " token", 10, colors.muted);
  } else if (family === "medium") {
    widget.addSpacer(12);
    const columns = widget.addStack();
    for (const [index, id] of ["codex", "minimax", "glm"].entries()) {
      if (index) columns.addSpacer();
      const card = data.subscriptions.find(c => c.provider === id);
      const column = columns.addStack(); column.layoutVertically();
      const primary = card && card.windows[0] || emptyWindow;
      const name = column.addStack();
      text(name, card ? card.label : id === "glm" ? "GLM" : id === "minimax" ? "MiniMax" : "Codex", 11, colors.muted, "medium");
      name.addSpacer(4); text(name, windowLabel(primary), 8, colors.muted);
      column.addSpacer(3); text(column, percent(primary), 28, accent(primary), "medium");
      column.addSpacer(7); bar(column, primary, 88);
      column.addSpacer(7); text(column, reset(primary), 8, colors.muted);
    }
    widget.addSpacer();
    const foot = widget.addStack();
    text(foot, "今日 " + compact(data.usage.today && data.usage.today.totalTokens) + " token", 10, colors.muted);
    foot.addSpacer(); text(foot, "剩余额度 · 含缓存用量", 8, colors.muted);
  } else {
    widget.addSpacer(14);
    for (const id of ["codex", "minimax", "glm"]) {
      const card = data.subscriptions.find(c => c.provider === id);
      const row = widget.addStack(); row.centerAlignContent();
      text(row, card ? card.label : id === "glm" ? "GLM" : id === "minimax" ? "MiniMax" : "Codex", 13, colors.text, "medium");
      row.addSpacer();
      const windows = card && card.windows.length ? card.windows : [emptyWindow];
      for (let i = 0; i < windows.length; i++) {
        if (i) row.addSpacer(12);
        text(row, windowLabel(windows[i]) + " " + percent(windows[i]), 12, accent(windows[i]), "medium");
      }
      widget.addSpacer(5);
      const primary = windows[0];
      bar(widget, primary, 290);
      widget.addSpacer(5);
      text(widget, reset(primary) + (card && card.stale ? " · 缓存额度" : ""), 9, colors.muted);
      widget.addSpacer(16);
    }
    const totals = widget.addStack();
    text(totals, "今日 " + compact(data.usage.today && data.usage.today.totalTokens), 19, colors.text, "medium");
    totals.addSpacer(); text(totals, "近七日 " + compact(data.usage.week && data.usage.week.totalTokens), 10, colors.muted);
    widget.addSpacer(10);
    const rows = data.trend || [], ctx = new DrawContext();
    ctx.size = new Size(290, 49); ctx.opaque = false; ctx.respectScreenScale = true;
    const max = Math.max(1, ...rows.map(r => r.totalTokens));
    rows.forEach((r, i) => {
      ctx.setFillColor(i === rows.length - 1 ? colors.fill : colors.track);
      const height = Math.max(2, r.totalTokens / max * 45);
      ctx.fillRect(new Rect(290 / rows.length * i + 5, 49 - height, 290 / rows.length - 12, height));
    });
    const image = widget.addImage(ctx.getImage()); image.imageSize = new Size(290, 49);
    widget.addSpacer(5);
    const dates = widget.addStack();
    rows.forEach((r, i) => {
      if (i) dates.addSpacer();
      text(dates, r.at ? new Date(r.at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }) : r.label, 8, colors.muted);
    });
    widget.addSpacer();
    text(widget, "Token 含缓存 · 点击查看详情", 9, colors.muted);
  }
}
Script.setWidget(widget);
if (!config.runsInWidget) {
  if (family === "small") await widget.presentSmall();
  else if (family === "large") await widget.presentLarge();
  else await widget.presentMedium();
}
Script.complete();
