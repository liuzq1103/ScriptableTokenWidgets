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

function resetLabel(window) {
  if (window.expired) return '窗口已到期 · 等待更新';
  if (!window.resetsAt) return '重置时间未提供';
  const minutes = Math.ceil((Date.parse(window.resetsAt) - Date.now()) / 60000);
  if (minutes <= 0) return '窗口已到期 · 等待更新';
  const duration = minutes < 60 ? minutes + ' 分钟' : minutes < 1440 ? Math.floor(minutes / 60) + ' 小时 ' + minutes % 60 + ' 分钟' : Math.floor(minutes / 1440) + ' 天 ' + Math.floor(minutes % 1440 / 60) + ' 小时';
  return duration + '后重置';
}
function windowName(name) {
  return /5\s*h|5\s*hour/i.test(name) ? '5 小时剩余' : /7\s*d|7\s*day|week/i.test(name) ? '本周剩余' : name + '剩余';
}
function progress(value, className) {
  const bar = node('progress', className);
  bar.max = 100;
  bar.value = value || 0;
  bar.setAttribute('aria-label', '剩余 ' + (value == null ? '未知' : Math.round(value) + '%'));
  return bar;
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
      const remaining = window.expired ? null : window.remainingPercent;
      const state = remaining == null ? '' : remaining <= 10 ? 'critical' : remaining <= 25 ? 'low' : '';
      const block = node('div', 'window ' + (i ? '' : 'primary ') + state);
      const row = node('div', 'window-heading');
      const value = node('span', 'window-value', remaining == null ? '—' : String(Math.round(remaining)));
      if (remaining != null) value.append(node('small', '', '%'));
      row.append(node('span', 'window-name', windowName(window.label)), value);
      block.append(row, progress(remaining, state), node('p', 'window-reset', resetLabel(window)));
      windows.append(block);
    });
    article.append(windows);
    if (!card.windows.length) article.append(node('p', 'fine-print', '此套餐未提供额度窗口'));
    if (card.stale) article.append(node('p', 'stale-label', '缓存额度 · ' + (card.updatedAt ? time(card.updatedAt) : '读取时间未知')));
    article.title = '额度读数：' + time(card.updatedAt);
    parent.append(article);
  }
}
function renderRanking(id, rows, total) {
  const parent = $(id); parent.replaceChildren();
  if (!rows.length) { parent.append(node('p', 'empty', '此周期暂无记录')); return; }
  for (const item of rows) {
    const row = node('div', 'ranking-row'), heading = node('div', 'ranking-heading');
    heading.append(node('span', '', item.label), node('strong', '', compact(item.totalTokens)));
    const bar = progress(total ? item.totalTokens / total * 100 : 0);
    bar.setAttribute('aria-label', item.label + '：' + exact(item.totalTokens) + ' Token');
    row.append(heading, bar); parent.append(row);
  }
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
function render(data, offline = false) {
  const stale = offline || Object.values(data.sources).some(source => source.state !== 'ok');
  $('connection').textContent = offline ? '离线 · 显示缓存' : stale ? '部分数据待更新' : '已连接 · Tailscale';
  $('status-dot').className = 'status-dot ' + (stale ? 'warn' : 'ok');
  const notices = [];
  if (data.demo) notices.push('演示模式 · 所有数字、模型和设备用量均为虚构数据。');
  if (stale) notices.push('当前显示最后成功的统计，请查看下方更新时间；未获取到的数据以 — 表示。');
  $('notice').hidden = !notices.length; $('notice').textContent = notices.join(' ');
  renderQuotas(data.subscriptions);
  const day = value => new Date(value + 8 * 3600000).toISOString().slice(0, 10);
  const oldDay = data.sources.today.outdated || data.sources.today.observedAt && day(Date.parse(data.sources.today.observedAt)) !== day(Date.now());
  const today = oldDay ? null : data.usage.today, week = data.usage.week;
  $('today-total').textContent = compact(today?.totalTokens);
  $('today-total').title = today ? exact(today.totalTokens) + ' Token' : '';
  $('today-caption').textContent = today ? exact(today.totalTokens) + ' Token · 上海时间今日累计' : '尚未读取到今日用量';
  const breakdown = $('breakdown'); breakdown.replaceChildren();
  for (const [text, field] of [['输入', 'inputTokens'], ['输出', 'outputTokens'], ['缓存读取', 'cacheReadTokens'], ['缓存写入', 'cacheWriteTokens']]) {
    const item = node('div', 'breakdown-item');
    item.append(node('span', '', text), node('strong', '', compact(today?.[field]))); breakdown.append(item);
  }
  $('requests').textContent = (today ? exact(today.requests) : '—') + ' 次请求';
  $('cache-hit').textContent = (today?.cacheHitPercent == null ? '—' : today.cacheHitPercent.toFixed(1) + '%') + ' 缓存命中';
  $('reasoning').textContent = '推理 ' + (today ? compact(today.reasoningTokens) : '—') + ' Token · 已包含在输出中';
  $('week-total').textContent = compact(week?.totalTokens);
  $('week-requests').textContent = (week ? exact(week.requests) : '—') + ' 次请求';
  renderChart(data.trend);
  renderRanking('models', data.rankings.models, week?.totalTokens);
  renderRanking('computers', data.rankings.computers, week?.totalTokens);
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
