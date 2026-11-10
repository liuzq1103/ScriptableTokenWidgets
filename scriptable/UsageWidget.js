// UsageWidget · ScriptableTokenWidgets · MIT
// Configure once with SetupUsageWidget.js. No credentials belong in this file.
// Widget parameter: a provider id for the small family (codex, minimax, glm),
// optionally "|used" to show consumed instead of remaining percent (glm|used).
// On medium and large families "used" alone flips every card.
// Both families adapt to 1–6 subscriptions; "page=2|used" selects another page.
const SETTINGS_KEY = "usage-bridge-v1";
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "usage-bridge-cache.json");
const family = ["small", "medium", "large"].includes(config.widgetFamily) ? config.widgetFamily : "medium";
// Screen points -> medium width, medium height, large height. These are widget
// bounds, not screen bounds. 402x874 uses the 349pt width from the iPhone capture.
function widgetDimensions() {
  const sizes = {
    "320x568": [292, 141, 311], "360x780": [329, 155, 345],
    "375x667": [322, 148, 324], "375x812": [329, 155, 345],
    "390x844": [338, 158, 354], "393x852": [338, 158, 354],
    "402x874": [349, 164, 366], "414x736": [348, 159, 357],
    "414x896": [360, 169, 379], "428x926": [364, 170, 382],
    "430x932": [364, 170, 382], "440x956": [364, 170, 382]
  };
  let bounds = [292, 141, 311];
  try {
    const screen = Device.screenSize();
    const short = Math.round(Math.min(screen.width, screen.height));
    const long = Math.round(Math.max(screen.width, screen.height));
    if (Number.isFinite(short) && short >= 320 && Number.isFinite(long)) {
      const width = Math.min(364, Math.floor(short * 0.84));
      bounds = sizes[short + "x" + long] || [width, Math.floor(width * 0.46), Math.floor(width * 1.05)];
    }
  } catch {}
  return { width: bounds[0], height: family === "large" ? bounds[2] : bounds[1] };
}
const dimensions = widgetDimensions();
const layout = {
  side: 16, vertical: family === "medium" && dimensions.height < 155 ? 12 : 14,
  width: dimensions.width - 32, header: 20, footer: family === "large" ? 30 : 13,
  columnGap: family === "large" ? 16 : 10
};
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
widget.setPadding(family === "small" ? 14 : layout.vertical, 16, family === "small" ? 14 : layout.vertical, 16);
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
  element.minimumScaleFactor = family === "small" ? 0.7 : 0.9;
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
// Both directions read the same vendor percentage; only the view changes.
function value(window) {
  if (expired(window)) return null;
  return showUsed ? window.usedPercent : window.remainingPercent;
}
function percent(window) { const current = value(window); return current == null ? "—" : Math.round(current) + "%"; }
function accent(window) {
  const current = value(window);
  if (current == null) return colors.muted;
  const consumed = showUsed ? current : 100 - current;
  return consumed >= 90 ? colors.critical : consumed >= 75 ? colors.warning : colors.text;
}
function reset(window) {
  if (expired(window)) return "已到期· 待更新";
  if (!window.resetsAt) return "重置时间未知";
  const mins = Math.ceil((Date.parse(window.resetsAt) - Date.now()) / 60000);
  if (mins < 60) return mins + " 分钟后重置";
  if (mins < 1440) return Math.floor(mins / 60) + "时 " + mins % 60 + "分后重置";
  return Math.floor(mins / 1440) + "天 " + Math.floor(mins % 1440 / 60) + "时后重置";
}
function shortReset(window) {
  if (expired(window)) return "待更新";
  if (!window.resetsAt) return "时间未知";
  const mins = Math.ceil((Date.parse(window.resetsAt) - Date.now()) / 60000);
  if (mins < 60) return mins + "分";
  if (mins < 1440) return Math.floor(mins / 60) + "时" + String(mins % 60).padStart(2, "0") + "分";
  return Math.floor(mins / 1440) + "天" + Math.floor(mins % 1440 / 60) + "时";
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
  const current = value(window);
  if (current != null) {
    const consumed = showUsed ? current : 100 - current;
    ctx.setFillColor(consumed >= 90 ? colors.critical : consumed >= 75 ? colors.warning : colors.fill);
    ctx.fillRect(new Rect(0, 0, width * Math.max(0, Math.min(100, current)) / 100, 4));
  }
  const image = parent.addImage(ctx.getImage()); image.imageSize = new Size(width, 4);
}
function header(status) {
  const row = widget.addStack(); row.centerAlignContent();
  if (family !== "small") row.size = new Size(layout.width, layout.header);
  text(row, "usage.", 15, colors.text, "medium"); row.addSpacer();
  text(row, status, 9, cached ? colors.warning : colors.muted);
}
const parameter = String(args.widgetParameter || "").split("|").map(part => part.trim().toLowerCase()).filter(Boolean);
const showUsed = parameter.includes("used");
const requested = parameter.find(part => part !== "used") || "codex";
const emptyWindow = { label: "Quota", remainingPercent: null, usedPercent: null, resetsAt: null };
function subscriptionGrid(parent, cards, sharedWindow) {
  const large = family === "large";
  const columns = large ? Math.min(2, cards.length) : cards.length > 4 ? 3 : cards.length;
  const rows = Math.ceil(cards.length / columns);
  const dense = large ? rows === 3 : rows === 2;
  const cellWidth = (layout.width - layout.columnGap * (columns - 1)) / columns;
  const tight = large ? dimensions.height < 345 : dimensions.height < 155;
  // A cell that has several accounts of one vendor carries a longer name, so a
  // narrow cell takes a smaller title font to keep the account readable.
  const style = large
    ? dense
      ? { name: tight ? 10 : 11, value: tight ? 20 : 24, reset: 8, secondary: 8, titleGap: 2, barGap: 3, resetGap: 3, rowGap: 8 }
      : { name: 12, value: 34, reset: 10, secondary: 10, titleGap: 4, barGap: 6, resetGap: 5, rowGap: 16 }
    : dense
      ? { name: tight ? 9 : 10, value: tight ? 18 : 20, titleGap: 1, barGap: 1, rowGap: tight ? 4 : 6 }
      : { name: cellWidth < 67 ? 9 : 11, value: cellWidth < 67 ? 24 : 28, reset: cellWidth < 64 ? 9 : 10, titleGap: 4, barGap: 6, resetGap: 6, rowGap: 0 };
  const grid = parent.addStack(); grid.layoutVertically(); grid.size = new Size(layout.width, 0);
  for (let start = 0; start < cards.length; start += columns) {
    if (start) grid.addSpacer(style.rowGap);
    const row = grid.addStack(); row.topAlignContent();
    for (let index = 0; index < columns; index++) {
      if (index) row.addSpacer(layout.columnGap);
      const column = row.addStack(); column.layoutVertically(); column.size = new Size(cellWidth, 0);
      const card = cards[start + index];
      if (!card) continue; // Keep the final card aligned with the previous rows.
      const primary = card.windows[0] || emptyWindow;
      text(column, card.label, style.name, colors.muted, "medium");
      column.addSpacer(style.titleGap);
      const valueRow = column.addStack(); valueRow.centerAlignContent();
      text(valueRow, percent(primary), style.value, accent(primary), "medium");
      if (!large && dense && !sharedWindow) {
        valueRow.addSpacer(); text(valueRow, windowLabel(primary), 8, colors.muted);
      }
      column.addSpacer(style.barGap);
      bar(column, primary, cellWidth);
      if (large || !dense) {
        column.addSpacer(style.resetGap);
        const label = (sharedWindow ? "" : windowLabel(primary) + " · ") + shortReset(primary);
        const size = sharedWindow ? style.reset : Math.min(style.reset, cellWidth < 64 ? 8 : 9);
        text(column, label, size, colors.muted);
      }
      if (large && card.windows[1]) {
        const secondary = card.windows[1];
        column.addSpacer(dense ? 2 : 4);
        text(column, windowLabel(secondary) + (showUsed ? " 已用 " : " 剩余 ") + percent(secondary), style.secondary, accent(secondary));
      }
    }
  }
}
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
  if (family === "small") {
    header(status);
    // A parameter may name one account of a vendor (codex@fangzt98) or the
    // vendor itself, which then means its first account.
    const card = data.subscriptions.find(c => String(c.id).toLowerCase() === requested)
      || data.subscriptions.find(c => c.provider === requested);
    widget.addSpacer(12);
    const primary = card && card.windows[0] || emptyWindow;
    const name = widget.addStack();
    text(name, card ? card.label : "暂无该套餐", 12, colors.muted, "medium");
    name.addSpacer(4); text(name, windowLabel(primary), 9, colors.muted);
    widget.addSpacer(3); text(widget, percent(primary), 34, accent(primary), "medium");
    widget.addSpacer(7); bar(widget, primary, 120); widget.addSpacer(7);
    text(widget, reset(primary), 9, colors.muted);
    if (card && card.windows[1]) {
      widget.addSpacer(3); text(widget, windowLabel(card.windows[1]) + (showUsed ? " 已用 " : " 剩余 ") + percent(card.windows[1]), 9, colors.muted);
    }
    widget.addSpacer();
    // The tokens of the subscription this widget shows, not the total of all.
    const own = card && card.usage && card.usage.today;
    const tokens = card ? (own ? own.totalTokens : null) : data.usage.today && data.usage.today.totalTokens;
    text(widget, "今日 " + (tokens == null ? "—" : compact(tokens)) + " token", 10, colors.muted);
  } else {
    // Preserve service order and every independent account; page only on the phone.
    const all = data.subscriptions || [];
    const pages = Math.max(1, Math.ceil(all.length / 6));
    const pageToken = parameter.find(part => part.startsWith("page=")) || "page=1";
    const rawPage = pageToken.slice(5);
    const pageNumber = /^\d+$/.test(rawPage) ? Number(rawPage) : NaN;
    const page = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? Math.min(pageNumber, pages) : 1;
    const shown = all.slice((page - 1) * 6, page * 6);
    const windows = shown.map(card => windowLabel(card.windows[0] || emptyWindow));
    const sharedWindow = windows.length && windows.every(label => label === windows[0]) ? windows[0] : "";
    const direction = (showUsed ? "已用" : "剩余") + (sharedWindow ? " · " + sharedWindow : "额度");
    header((pages > 1 ? page + "/" + pages + "页 · " : "") + status);
    const body = widget.addStack(); body.layoutVertically();
    body.size = new Size(layout.width, dimensions.height - 2 * layout.vertical - layout.header - layout.footer);
    body.addSpacer();
    if (!shown.length) text(body, "暂无套餐", 13, colors.muted, "medium");
    else subscriptionGrid(body, shown, sharedWindow);
    body.addSpacer();
    if (family === "medium") {
      const foot = widget.addStack();
      foot.size = new Size(layout.width, layout.footer);
      text(foot, "今日 " + compact(data.usage.today && data.usage.today.totalTokens) + " Token", 9, colors.muted);
      foot.addSpacer(); text(foot, direction, 9, colors.muted);
    } else {
      const foot = widget.addStack(); foot.layoutVertically(); foot.size = new Size(layout.width, layout.footer);
      const totals = foot.addStack();
      text(totals, "今日 " + compact(data.usage.today && data.usage.today.totalTokens), 11, colors.text, "medium");
      totals.addSpacer();
      text(totals, "近七日 " + compact(data.usage.week && data.usage.week.totalTokens), 11, colors.muted);
      foot.addSpacer(4);
      text(foot, direction + " · Token 含缓存", 8, colors.muted);
    }
  }
}
Script.setWidget(widget);
if (!config.runsInWidget) {
  if (family === "small") await widget.presentSmall();
  else if (family === "large") await widget.presentLarge();
  else await widget.presentMedium();
}
Script.complete();
