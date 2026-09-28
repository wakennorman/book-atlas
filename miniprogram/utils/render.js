/**
 * 书脉小程序 · 绘制层（canvas 2D 通用，不碰 wx API）
 * 传入的 ctx 只要支持标准 2D 接口即可：小程序 canvas 2d / 浏览器 canvas 都能跑。
 */
const THEME = {
  light: { bg: '#f4f1ea', panel: '#ffffff', ink: '#232a35', muted: '#6c7482', line: '#e5dfd3', locked: '#9aa3b0' },
  dark: { bg: '#10141c', panel: '#1a202b', ink: '#e9e4d8', muted: '#98a1ae', line: '#2a3240', locked: '#5b6675' },
};

function setDash(ctx, type, scale) {
  if (!ctx.setLineDash) return;
  const s = Math.max(scale, 0.35);
  if (type === 'dashed') ctx.setLineDash([6 / s, 5 / s]);
  else if (type === 'dotted') ctx.setLineDash([1.5 / s, 4 / s]);
  else ctx.setLineDash([]);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const screenToWorld = (view, x, y) => [(x - view.tx) / view.scale, (y - view.ty) / view.scale];

/**
 * @param ctx  2D 上下文
 * @param g    utils/graph.js 的实例
 * @param view { width, height, scale, tx, ty, theme, highlight:{nodes:Set,edges:Set}, allLabels, status }
 */
function drawGraph(ctx, g, view) {
  const th = THEME[view.theme] || THEME.light;
  const { width, height, scale } = view;
  const { nodes, links } = g.visible();
  const layout = g.pack.layouts[g.state.layout] || g.pack.layouts['gen-v'];
  const pos = layout.pos;
  const hl = view.highlight || {};

  if (!view.noBg) {                     // 分享卡片会自己画底板，所以给个开关
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.save();
  ctx.translate(view.tx, view.ty);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';

  // 连线：同一对之间的多条边（阶段关系）按序号扇开
  const seen = new Map();
  for (const r of links) {
    const a = pos[r.from], b = pos[r.to];
    if (!a || !b) continue;
    const key = r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`;
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    const curve = n === 0 ? 0.08 : (n % 2 === 1 ? -1 : 1) * (0.08 + 0.12 * Math.floor(n / 2));
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    const cx = mx + (nx / len) * curve * len * 0.5, cy = my + (ny / len) * curve * len * 0.5;
    const dim = hl.nodes && hl.nodes.size && !hl.nodes.has(r.from) && !hl.nodes.has(r.to);
    ctx.globalAlpha = dim ? 0.08 : (r.derived ? 0.32 : 0.5);
    ctx.strokeStyle = g.factionColorOf(g.byId.get(r.from));
    ctx.lineWidth = ((hl.edges && hl.edges.has(key)) ? 2.4 : 1.2) / Math.max(scale, 0.35);
    setDash(ctx, r.derived || r.style === 'dashed' ? 'dashed' : (r.style === 'dotted' ? 'dotted' : 'solid'), scale);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(cx, cy, b[0], b[1]);
    ctx.stroke();
  }
  setDash(ctx, 'solid', scale);

  // 节点
  for (const c of nodes) {
    const p = pos[c.id];
    if (!p) continue;
    const locked = g.charLocked(c);
    const mentioned = g.isMentioned(c);
    const r = g.symbolSize(c.id) / 2;
    const dim = hl.nodes && hl.nodes.size && !hl.nodes.has(c.id);
    ctx.globalAlpha = dim ? 0.18 : (mentioned ? 0.9 : (locked ? 0.45 : 1));
    ctx.fillStyle = mentioned ? th.bg : (locked ? th.locked : g.factionColorOf(c));
    ctx.strokeStyle = mentioned ? th.locked : th.panel;
    ctx.lineWidth = (mentioned ? 1.4 : 1) / Math.max(scale, 0.35);
    if (c.gender === 'f') roundRect(ctx, p[0] - r, p[1] - r, r * 2, r * 2, r * 0.32);
    else { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); }
    ctx.fill();
    if (mentioned) setDash(ctx, 'dashed', scale);
    ctx.stroke();
    setDash(ctx, 'solid', scale);
  }

  // 标签（屏幕字号恒定：字号 / 缩放；位置与对齐由 labels() 给出，支持上/右/左三个候选位）
  const labels = g.labels(scale, { showAll: view.allLabels, densityFit: view.densityFit });
  const size = Math.max(9, Math.min(20, 11.5 / Math.max(scale, 0.35))) * g.fontScale();
  ctx.font = `${size}px sans-serif`;
  ctx.textBaseline = 'bottom';
  for (const l of labels) {
    const c = g.byId.get(l.id);
    if (!c || g.charLocked(c)) continue;
    const x = l.dx, y = l.dy;
    const align = l.align || 'center';
    const w = ctx.measureText(l.name).width;
    ctx.textAlign = align;
    const boxX = align === 'left' ? x - 2 : (align === 'right' ? x - w - 2 : x - w / 2 - 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.panel;
    ctx.fillRect(boxX, y - size - 1, w + 4, size + 3);
    ctx.fillStyle = th.ink;
    ctx.fillText(l.name, x, y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // 屏幕坐标上的状态行
  if (view.status) {
    ctx.font = '12px sans-serif';
    const w = Math.min(width - 16, ctx.measureText(view.status).width + 16);
    ctx.fillStyle = th.panel;
    ctx.globalAlpha = 0.86;
    ctx.fillRect(8, 8, w, 26);
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(view.status, 16, 21);
  }
  return { nodes: nodes.length, links: links.length, labels: labels.length };
}

module.exports = { drawGraph, screenToWorld, THEME };
