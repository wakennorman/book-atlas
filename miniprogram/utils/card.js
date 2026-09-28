/**
 * 书脉小程序 · 分享卡片（canvas 2D 通用，不碰 wx API）
 *
 * 卡片结构：标题 + 统计 + 关系图（按当前布局自适应缩放）+ 阵营图例 + 页脚
 * 页面里用 wx.createOffscreenCanvas 画它，然后 canvasToTempFilePath → 保存/分享。
 */
const { drawGraph, THEME } = require('./render.js');

const CARD = { w: 1200, h: 900, pad: 56, headH: 176, footH: 104 };

/** 可见节点的包围盒（适配要用"画出来的那些"，而不是全部坐标——大书里被折叠的人会把框撑大） */
function visibleBBox(g, key) {
  const pos = (g.pack.layouts[key || g.state.layout] || g.pack.layouts['gen-v']).pos;
  const nodes = g.visible().nodes;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
  for (const c of nodes) {
    const p = pos[c.id];
    if (!p) continue;
    n++;
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  if (!n) {                                  // 兜底：没有可见节点时用全部坐标
    for (const id in pos) {
      const p = pos[id];
      if (!p) continue;
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
  }
  return { minX, maxX, minY, maxY, n };
}

/** 卡片用哪套布局：长宽比太极端（大书的"分组"布局会排成一条长线）就换自由布局 */
function cardLayoutKey(g) {
  const keys = ['gen-v', 'gen-h', 'force'].filter((k) => g.pack.layouts[k] && g.pack.layouts[k].pos);
  const aspectOf = (k) => {
    const b = visibleBBox(g, k);
    if (!isFinite(b.minX)) return Infinity;
    const sx = Math.max(1, b.maxX - b.minX), sy = Math.max(1, b.maxY - b.minY);
    return Math.max(sx / sy, sy / sx);
  };
  const cur = aspectOf(g.state.layout);
  if (cur <= 2.2) return g.state.layout;                  // 当前布局够方正，就用它（分享卡片偏好看"铺得开"的）
  let best = null;
  for (const k of keys) {
    const a = aspectOf(k);
    if (!best || a < best.a) best = { k, a };
  }
  return best && best.a < cur ? best.k : g.state.layout;
}

/** 卡片里关系图区域的自适应变换（与网页版分享图同思路；按可见节点适配） */
function fitCard(g, area) {
  const b = visibleBBox(g);
  if (!isFinite(b.minX)) return { scale: 1, tx: area.x + area.w / 2, ty: area.y + area.h / 2 };
  const spanX = Math.max(60, b.maxX - b.minX), spanY = Math.max(60, b.maxY - b.minY);
  const scale = Math.min((area.w - 40) / spanX, (area.h - 40) / spanY);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  return { scale, tx: area.x + area.w / 2 - cx * scale, ty: area.y + area.h / 2 - cy * scale };
}

/**
 * @param ctx  2D 上下文（小程序 canvas / 浏览器 canvas 均可）
 * @param g    utils/graph.js 的实例
 * @param opts { width, height, theme, note }
 * @returns { nodes, links, labels, scale } —— 便于测试断言
 */
function drawCard(ctx, g, opts) {
  const o = opts || {};
  const W = o.width || CARD.w, H = o.height || CARD.h;
  const th = THEME[o.theme] || THEME.light;
  const pad = CARD.pad, headH = CARD.headH, footH = CARD.footH;
  const st = g.state;
  const title = `《${g.pack.title}》`;
  const cardKey = cardLayoutKey(g);
  const switched = cardKey !== st.layout;
  const LAYOUT_CN = { 'gen-v': '分组·纵', 'gen-h': '分组·横', force: '自由' };
  const sub = [
    g.pack.author || '',
    switched ? `${LAYOUT_CN[cardKey] || cardKey}（自动）` : (o.layoutLabel || LAYOUT_CN[cardKey] || ''),
    st.timeTravel ? `🕰 第 ${g.asOf()} 章的世界` : (st.progress === null ? '全部解锁' : `剧透保护：读到第 ${st.progress} 章`),
  ].filter(Boolean).join(' · ');
  const n = g.visible();

  // 底板
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = th.panel;
  roundRect(ctx, 20, 20, W - 40, H - 40, 24);
  ctx.fill();
  ctx.strokeStyle = th.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 标题区
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = th.ink;
  ctx.font = 'bold 46px sans-serif';
  ctx.fillText(title, pad, 108);
  ctx.fillStyle = th.muted;
  ctx.font = '24px sans-serif';
  ctx.fillText(sub, pad, 146);
  ctx.fillStyle = '#c99a3f';
  ctx.fillRect(pad, 118, 84, 7);
  // 统计（右对齐）
  ctx.textAlign = 'right';
  ctx.fillStyle = th.muted;
  ctx.font = '23px sans-serif';
  ctx.fillText(`${n.nodes.length} / ${g.pack.characters.length} 人 · ${n.links.length} 段关系 · ${g.pack.events.length} 个事件`, W - pad, 146);

  // 关系图区域
  const area = { x: pad, y: headH, w: W - pad * 2, h: H - headH - footH };
  ctx.fillStyle = th.bg;
  roundRect(ctx, area.x, area.y, area.w, area.h, 18);
  ctx.fill();
  ctx.strokeStyle = th.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const keepLayout = g.state.layout;
  g.state.layout = cardKey;                    // 卡片可能临时换布局（见 cardLayoutKey）——必须在 fitCard 之前
  const fit = fitCard(g, area);
  ctx.save();
  roundRect(ctx, area.x, area.y, area.w, area.h, 18);
  ctx.clip();
  const info = drawGraph(ctx, g, {
    width: W, height: H, noBg: true, theme: o.theme,
    scale: fit.scale, tx: fit.tx, ty: fit.ty,
    allLabels: true,                            // 卡片：候选给全，能放几个由避让决定
    densityFit: true,                           // 卡片：字号按节点密度反推（大书才不会只剩一个标签）
  });
  g.state.layout = keepLayout;
  ctx.restore();

  // 图例
  let lx = pad;
  const ly = H - 62;
  ctx.textAlign = 'left';
  ctx.font = '22px sans-serif';
  for (const f of (g.pack.factions || []).slice(0, 8)) {
    const label = f.name || '';
    const w = ctx.measureText(label).width + 34;
    if (lx + w > W - pad - 260) break;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(lx + 9, ly - 8, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = th.muted;
    ctx.fillText(label, lx + 26, ly);
    lx += w;
  }
  // 页脚
  ctx.textAlign = 'right';
  ctx.fillStyle = th.muted;
  ctx.font = '22px sans-serif';
  ctx.fillText(o.note || '书脉 BookAtlas · 微信小程序', W - pad, ly);
  return { nodes: info.nodes, links: info.links, labels: info.labels, scale: fit.scale };
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

module.exports = { drawCard, fitCard, cardLayoutKey, visibleBBox, CARD };
