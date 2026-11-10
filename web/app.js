const $ = id => document.getElementById(id);
const savedTheme = sessionStorage.getItem('usage-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$('theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark' || !document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  sessionStorage.setItem('usage-theme', theme);
});
const compact = value => value == null ? '—' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
const exact = value => new Intl.NumberFormat('en').format(value);
const money = value => value == null ? '—' : value >= 100 ? value.toFixed(0) : value.toFixed(2);
const time = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '未知';
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
};
let token = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null, '', location.pathname);
if (token) sessionStorage.setItem('usage-token', token);
token ||= sessionStorage.getItem('usage-token');
let last;
try { last = JSON.parse(sessionStorage.getItem('usage-overview')); } catch { /* No cached response. */ }
// Percent direction and ranking tab are per-device viewing choices,
// not changes to what the service projects.
let quotaMode = sessionStorage.getItem('usage-quota-mode') === 'used' ? 'used' : 'remaining';
const RANKING_TABS = ['models', 'providers', 'agents', 'computers'];
let rankTab = RANKING_TABS.includes(sessionStorage.getItem('usage-ranking')) ? sessionStorage.getItem('usage-ranking') : 'models';
function syncQuotaToggle() {
  for (const mode of ['remaining', 'used']) {
    const button = $('mode-' + mode);
    button.classList.toggle('active', quotaMode === mode);
    button.setAttribute('aria-pressed', String(quotaMode === mode));
  }
}
function syncRankTabs() {
  for (const id of RANKING_TABS) {
    const button = $('tab-' + id);
    button.classList.toggle('active', rankTab === id);
    button.setAttribute('aria-pressed', String(rankTab === id));
  }
}
for (const mode of ['remaining', 'used']) $('mode-' + mode).addEventListener('click', () => {
  quotaMode = mode;
  sessionStorage.setItem('usage-quota-mode', mode);
  syncQuotaToggle();
  if (last) renderQuotas(last.subscriptions);
});
for (const id of RANKING_TABS) $('tab-' + id).addEventListener('click', () => {
  rankTab = id;
  sessionStorage.setItem('usage-ranking', id);
  syncRankTabs();
  if (last) renderRankings(last);
});
syncQuotaToggle();
syncRankTabs();
function resetLabel(window) {
  if (window.expired) return '窗口已到期· 等待更新';
  if (!window.resetsAt) return '重置时间未提供';
  const minutes = Math.ceil((Date.parse(window.resetsAt) - Date.now()) / 60000);
  if (minutes <= 0) return '窗口已到期· 等待更新';
  const duration = minutes < 60 ? minutes + ' 分钟' : minutes < 1440 ? Math.floor(minutes / 60) + ' 小时 ' + minutes % 60 + ' 分钟' : Math.floor(minutes / 1440) + ' 天 ' + Math.floor(minutes % 1440 / 60) + ' 小时';
  return duration + '后重置';
}
function windowName(name) {
  const suffix = quotaMode === 'used' ? '已用' : '剩余';
  return /5\s*h|5\s*hour/i.test(name) ? '5 小时' + suffix : /7\s*d|7\s*day|week/i.test(name) ? '本周' + suffix : name + suffix;
}
function progress(value, className, label) {
  const bar = node('progress', className);
  bar.max = 100;
  bar.value = value || 0;
  bar.setAttribute('aria-label', (label || '剩余') + ' ' + (value == null ? '未知' : Math.round(value) + '%'));
  return bar;
}
function quotaValue(window) {
  return window.expired ? null : quotaMode === 'used' ? window.usedPercent : window.remainingPercent;
}
function quotaState(value) {
  if (value == null) return '';
  const consumed = quotaMode === 'used' ? value : 100 - value;
  return consumed >= 90 ? 'critical' : consumed >= 75 ? 'low' : '';
}
function renderQuotas(cards) {
  const parent = $('quotas'); parent.replaceChildren();
  if (!cards.length) { parent.append(node('div', 'empty panel', '尚未读取到有效套餐。请确认 Magpie 已登录订阅并更新额度。')); return; }
  for (const card of cards) {
    const article = node('article', 'panel quota-card');
    const heading = node('div', 'provider-heading');
    heading.append(node('span', 'provider-monogram', card.label[0]), node('span', 'provider-name', card.label), node('span', 'tag', card.plan));
    article.append(heading);
    const windows = node('div', 'windows');
    card.windows.forEach((window, i) => {
      const value = quotaValue(window);
      const state = quotaState(value);
      const block = node('div', 'window ' + (i ? '' : 'primary ') + state);
      const row = node('div', 'window-heading');
      const valueNode = node('span', 'window-value', value == null ? '—' : String(Math.round(value)));
      if (value != null) valueNode.append(node('small', '', '%'));
      row.append(node('span', 'window-name', windowName(window.label)), valueNode);
      block.append(row, progress(value, state, quotaMode === 'used' ? '已用' : '剩余'), node('p', 'window-reset', resetLabel(window)));
      if (window.amount != null && window.limit != null) {
        block.append(node('p', 'window-amount', '读数 ' + compact(window.amount) + ' / ' + compact(window.limit)));
      }
      windows.append(block);
    });
    article.append(windows);
    if (!card.windows.length) article.append(node('p', 'fine-print', '此套餐未提供额度窗口'));
    if (card.usage && card.usage.today) {
      const today = card.usage.today;
      article.append(node('p', 'fine-print', '今日 ' + compact(today.totalTokens) + ' Token · ' + today.requests + ' 次请求'));
    } else {
      // The usage of this subscription is unknown; the total of all is never
      // shown in its place.
      article.append(node('p', 'fine-print', '今日用量未知'));
    }
    if (card.stale) article.append(node('p', 'stale-label', '缓存额度· ' + (card.updatedAt ? time(card.updatedAt) : '读取时间未知')));
    article.title = '额度读数：' + time(card.updatedAt);
    parent.append(article);
  }
}
const RANKING_NOTES = {
  models: '同名模型已合并，含不同厂商前缀与大小写',
  providers: '按上游稳定 id 解析厂商',
  agents: 'Magpie 识别的调用客户端',
  computers: '发起请求的设备，沿用 Magpie 的合并结果',
};
function renderRanking(rows, total) {
  const parent = $('rank-body'); parent.replaceChildren();
  if (!rows.length) { parent.append(node('p', 'empty', '此周期暂无记录')); return; }
  for (const item of rows) {
    const row = node('div', 'ranking-row'), heading = node('div', 'ranking-heading');
    const value = node('span', 'ranking-value');
    value.append(node('strong', '', compact(item.totalTokens)));
    if (item.cost > 0) value.append(node('span', 'ranking-cost', money(item.cost)));
    heading.append(node('span', '', item.label), value);
    const bar = progress(total ? item.totalTokens / total * 100 : 0);
    bar.setAttribute('aria-label', item.label + '：' + exact(item.totalTokens) + ' Token' + (item.cost > 0 ? '· 预估费用 ' + money(item.cost) : ''));
    row.append(heading, bar); parent.append(row);
  }
}
function renderRankings(data) {
  renderRanking(data.rankings[rankTab] || [], data.usage.week?.totalTokens);
  $('rank-note').textContent = RANKING_NOTES[rankTab] || '';
}
const NS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attrs, text) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (text != null) element.textContent = text;
  return element;
}
function renderChart(rows) {
  const parent = $('chart'); parent.replaceChildren();
  if (!rows.length) { parent.append(node('p', 'empty', '暂无趋势数据')); return; }
  const svg = svgNode('svg', { viewBox: '0 0 420 175', role: 'img', 'aria-label': '近七日 Token 用量' });
  const max = Math.max(1, ...rows.map(row => row.totalTokens));
  for (const y of [35, 80, 125]) svg.append(svgNode('line', { x1: 0, x2: 420, y1: y, y2: y, class: 'gridline' }));
  rows.forEach((row, i) => {
    const x = 420 / rows.length * (i + .5), height = row.totalTokens / max * 100;
    const rect = svgNode('rect', { x: x - 12, y: 139 - height, width: 24, height: Math.max(2, height), rx: 3, class: i === rows.length - 1 ? 'last' : '' });
    rect.append(svgNode('title', {}, row.label + '：' + exact(row.totalTokens) + ' Token'));
    const date = row.at ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).format(new Date(row.at)) : row.label;
    svg.append(rect, svgNode('text', { x, y: 159, 'text-anchor': 'middle' }, date));
  });
  parent.append(svg);
}
function speedText(metrics) {
  const parts = [];
  if (metrics?.outputTokensPerSecond != null) parts.push('输出 约' + metrics.outputTokensPerSecond + ' tok/s');
  if (metrics?.ttftMs != null) parts.push('首字 约' + (metrics.ttftMs >= 1000 ? (metrics.ttftMs / 1000).toFixed(1) + ' 秒' : metrics.ttftMs + ' 毫秒'));
  return parts.join('· ');
}
function render(data, offline = false) {
  const stale = offline || Object.values(data.sources).some(source => source.state !== 'ok');
  $('connection').textContent = offline ? '离线· 显示缓存' : stale ? '部分数据待更新' : '已连接· Tailscale';
  $('status-dot').className = 'status-dot ' + (stale ? 'warn' : 'ok');
  const notices = [];
  if (data.demo) notices.push('演示模式· 所有数字、模型和设备用量均为虚构数据。');
  if (stale) notices.push('当前显示最后成功的统计，请查看下方更新时间；未获取到的数据以 — 表示。');
  $('notice').hidden = !notices.length; $('notice').textContent = notices.join(' ');
  renderQuotas(data.subscriptions);
  const day = value => new Date(value + 8 * 3600000).toISOString().slice(0, 10);
  const oldDay = data.sources.today.outdated || data.sources.today.observedAt && day(Date.parse(data.sources.today.observedAt)) !== day(Date.now());
  const today = oldDay ? null : data.usage.today, week = data.usage.week;
  $('today-total').textContent = compact(today?.totalTokens);
  $('today-total').title = today ? exact(today.totalTokens) + ' Token' : '';
  $('today-caption').textContent = today ? exact(today.totalTokens) + ' Token·上海时间今日累计' : '尚未读取到今日用量';
  const breakdown = $('breakdown'); breakdown.replaceChildren();
  for (const [text, field] of [['输入', 'inputTokens'], ['输出', 'outputTokens'], ['缓存读取', 'cacheReadTokens'], ['缓存写入', 'cacheWriteTokens']]) {
    const item = node('div', 'breakdown-item');
    item.append(node('span', '', text), node('strong', '', compact(today?.[field]))); breakdown.append(item);
  }
  $('reasoning').textContent = '推理 ' + (today ? compact(today.reasoningTokens) : '—') + ' Token· 已包含在输出中';
  const extras = [speedText(today), today && today.cost != null ? '预估费用 ' + money(today.cost) : ''].filter(Boolean).join('· ');
  $('today-extras').textContent = extras;
  $('today-extras').title = today && today.unpriced > 0 ? '有 ' + today.unpriced + ' 条未计价请求，费用估算可能偏低' : '';
  $('requests').textContent = (today ? exact(today.requests) : '—') + ' 次请求' + (today && today.errors > 0 ? '·失败 ' + today.errors : '');
  $('cache-hit').textContent = (today?.cacheHitPercent == null ? '—' : today.cacheHitPercent.toFixed(1) + '%') + ' 缓存命中';
  $('week-total').textContent = compact(week?.totalTokens);
  $('week-requests').textContent = (week ? exact(week.requests) : '—') + ' 次请求' + (week && week.cost != null ? '· 预估费用 ' + money(week.cost) : '');
  $('week-requests').title = week && week.unpriced > 0 ? '有 ' + week.unpriced + ' 条未计价请求，费用估算可能偏低' : '';
  renderChart(data.trend);
  renderRankings(data);
  const observations = Object.values(data.sources).map(source => source.observedAt).filter(Boolean).sort();
  $('updated').textContent = '汇总更新于 ' + time(observations[0]);
}
function auth(message = '') {
  $('auth-error').textContent = message;
  if (!$('auth').open) $('auth').showModal();
}
async function load() {
  if (!token) { auth(); return; }
  $('refresh').disabled = true;
  try {
    const response = await fetch('/api/v1/overview', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (response.status === 401) {
      token = null; sessionStorage.removeItem('usage-token'); auth('令牌无效，请重新输入。'); return;
    }
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    if (data.schemaVersion !== 1) throw new Error('Unsupported response');
    last = data; sessionStorage.setItem('usage-overview', JSON.stringify(data));
    $('auth').close(); render(data);
  } catch {
    if (last) render(last, true);
    else { $('connection').textContent = '连接失败'; $('notice').hidden = false; $('notice').textContent = '无法连接服务。请检查 PC 服务和 iPhone 的 Tailscale 连接。'; }
  } finally { $('refresh').disabled = false; }
}
$('auth-form').addEventListener('submit', event => {
  event.preventDefault(); token = $('token').value.trim(); sessionStorage.setItem('usage-token', token); void load();
});
$('auth').addEventListener('cancel', event => event.preventDefault());
$('refresh').addEventListener('click', () => void load());
document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); });
if (last) render(last, true);
void load();
setInterval(() => { if (!document.hidden && token) void load(); }, 60000);
