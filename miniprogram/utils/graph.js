/**
 * 书脉小程序 · 纯逻辑层（不碰 DOM / 不碰 wx API）
 *
 * 为什么单独一层：这层代码在小程序、浏览器、Node 里都能跑 ⇒ 可以在浏览器里用真实数据
 * 跑一遍并看图（小程序开发者工具不在手边时，这是唯一可靠的验证方式）。
 *
 * 口径与网页版 js/app.js 保持一致：剧透保护 / 时间旅行 / 折叠 / 关系过滤 / 两人关系。
 */
const KIN = { blood: '血缘', marriage: '婚姻', inlaw: '姻亲', adoptive: '收养', foster: '抚养', step: '继亲', sworn: '结义' };
/* 无障碍：色盲友好配色（Okabe–Ito 八色，按阵营顺序分配）+ 字号档位 */
const A11Y_PALETTE = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#8b94a7'];
const FONT_SCALE = { s: 0.9, m: 1, l: 1.2 };
const KIN_HINT = {
  blood: '亲生血缘', marriage: '夫妻（婚姻）', inlaw: '姻亲（配偶方亲属）',
  adoptive: '正式收养', foster: '非正式（被谁带大、寄养）', step: '继亲（继父母/继子女）', sworn: '结义／干亲／教父',
};
const chOf = (s) => { const m = String(s || '').match(/(\d+)/); return m ? Number(m[1]) : null; };
const STYLE_OF = (r) => (r.style === 'dashed' ? 'dashed' : r.style === 'dotted' ? 'dotted' : 'solid');
const KIN_BUCKET = (r) => {
  const k = r && r.kin;
  if (k === 'blood') return 'blood';
  if (k === 'marriage' || k === 'inlaw') return 'marriage';
  if (k === 'adoptive' || k === 'foster' || k === 'step') return 'adopt';
  if (k === 'sworn') return 'sworn';
  return 'none';
};

function createGraph(pack) {
  const byId = new Map(pack.characters.map((c) => [c.id, c]));
  const adj = new Map(pack.characters.map((c) => [c.id, []]));
  for (const r of pack.relations) {
    if (!byId.has(r.from) || !byId.has(r.to)) continue;
    adj.get(r.from).push({ to: r.to, rel: r });
    adj.get(r.to).push({ to: r.from, rel: r });
  }
  const deg = new Map(Object.entries(pack.degree || {}));
  const maxDeg = Math.max(1, ...[...deg.values()]);
  const state = {
    layout: 'gen-v',        // gen-v | gen-h | force
    progress: null,         // 剧透保护：读到第几章（null＝全解锁）
    chapter: 1,             // 章节视图 / 时间旅行指针
    timeTravel: false,
    showMinor: false,
    showMentioned: false,
    showDerived: true,
    sizeFilter: 'all',      // all | mid | main
    focus: null,            // { id, depth }
    edgeStyles: [],         // [] = 全显示
    edgeKins: [],
    a11yPalette: false,     // 无障碍：色盲友好配色
    fontSize: 'm',          // 无障碍：字号 s | m | l
  };

  const charCh = (c) => (c && typeof c.firstCh === 'number' ? c.firstCh : 0);
  const relCh = (r) => {
    const l = (r.events || []).map((e) => chOf(e.chapter)).filter((n) => n !== null);
    if (l.length) return Math.min(...l);
    return Math.min(charCh(byId.get(r.from)), charCh(byId.get(r.to)));
  };
  const relFrom = (r) => (typeof r.fromCh === 'number' ? r.fromCh : relCh(r));
  const maxChapter = () => pack.meta.chapters || Math.max(1, ...pack.characters.map(charCh), ...pack.events.map((e) => e.ch || 0));
  const timeCeiling = () => (state.progress === null ? maxChapter() : Math.min(maxChapter(), state.progress));
  const asOf = () => (state.timeTravel ? Math.min(state.chapter || 1, timeCeiling()) : null);
  const beforeAsOf = (ch) => { const n = asOf(); return n !== null && (Number(ch) || 0) > n; };

  const lockedCh = (ch) => state.progress !== null && ch > state.progress;
  const charLocked = (c) => !!c && lockedCh(charCh(c));
  const relLocked = (r) => lockedCh(relCh(r));
  const eventLocked = (e) => lockedCh(typeof e.ch === 'number' ? e.ch : 0);
  const charVisibleAt = (c) => !beforeAsOf(charCh(c));
  const relVisibleAt = (r) => {
    const n = asOf();
    if (n === null) return true;
    const to = typeof r.toCh === 'number' ? r.toCh : null;
    return relFrom(r) <= n && (to === null || to > n);
  };
  const relVisible = (r) => !r.derived || state.showDerived;
  const passEdge = (r) => {
    if (state.edgeStyles.length && state.edgeStyles.indexOf(STYLE_OF(r)) < 0) return false;
    if (state.edgeKins.length && state.edgeKins.indexOf(KIN_BUCKET(r)) < 0) return false;
    return true;
  };
  const isMinor = (c) => !!c && c.tier === 'minor';
  const isMentioned = (c) => !!c && c.tier === 'mentioned';
  const isHidden = (c) => {
    if (!c) return false;
    if (isMentioned(c)) return !state.showMentioned;
    if (isMinor(c)) return !state.showMinor;
    return false;
  };
  const symbolSize = (id) => Math.max(13, Math.min(40, 13 + 27 * Math.sqrt((deg.get(id) || 0) / maxDeg)));

  /** 分组（有代际按代，无代际按阵营） */
  const isGen = (pack.meta.groupMode || 'generation') === 'generation';
  const factionOrder = new Map((pack.factions || []).map((f, i) => [f.key, i]));
  const groupKeyOf = (c) => (isGen ? `g${c.generation}` : `f${c.faction || 'other'}`);
  const groupLabelOf = (c) => {
    if (isGen) return c.generation === 0 ? '前史' : `第 ${c.generation} 代`;
    const f = (pack.factions || []).find((x) => x.key === c.faction);
    return (f && f.name) || '其他';
  };

  /** 阵营（含 factionHistory 的时间旅行/剧透感知） */
  const effectiveFactionKey = (c) => {
    const h = c && c.factionHistory;
    if (!Array.isArray(h) || !h.length) return (c && c.faction) || '';
    const n = asOf();
    const ch = n !== null ? n : (state.progress === null ? Infinity : state.progress);
    let pick = h[0];
    for (const seg of h) if (typeof seg.fromCh === 'number' && seg.fromCh <= ch) pick = seg;
    return pick.faction || (c && c.faction) || '';
  };
  const factionColorOf = (c) => {
    const key = effectiveFactionKey(c);
    if (state.a11yPalette) {
      const i = Math.max(0, (pack.factions || []).findIndex((f) => f.key === key));
      return A11Y_PALETTE[i % A11Y_PALETTE.length];
    }
    const f = (pack.factions || []).find((x) => x.key === key);
    return (f && f.color) || '#8b94a7';
  };
  const factionColorByKey = (key) => {
    if (state.a11yPalette) {
      const i = Math.max(0, (pack.factions || []).findIndex((f) => f.key === key));
      return A11Y_PALETTE[i % A11Y_PALETTE.length];
    }
    const f = (pack.factions || []).find((x) => x.key === key);
    return (f && f.color) || '#8b94a7';
  };
  const fontScale = () => FONT_SCALE[state.fontSize] || 1;
  const factionTextOf = (c) => {
    const key = effectiveFactionKey(c);
    const f = (pack.factions || []).find((x) => x.key === key);
    return (f && f.name) || '其他';
  };

  /** 人数过滤（按关系数排名） */
  let rankCache = null;
  const rank = () => {
    if (!rankCache) {
      rankCache = new Map();
      [...byId.keys()].sort((a, b) => (deg.get(b) || 0) - (deg.get(a) || 0)).forEach((id, i) => rankCache.set(id, i + 1));
    }
    return rankCache;
  };
  const sizeLimit = () => (state.sizeFilter === 'main' ? 60 : state.sizeFilter === 'mid' ? 200 : Infinity);
  const passSize = (id) => {
    const lim = sizeLimit();
    if (lim === Infinity) return true;
    if (state.focus && state.focus.id === id) return true;
    return (rank().get(id) || 9999) <= lim;
  };

  /** 聚焦：某人 N 跳以内 */
  const focusSet = () => {
    if (!state.focus) return null;
    const set = new Set([state.focus.id]);
    let frontier = [state.focus.id];
    for (let d = 0; d < state.focus.depth; d++) {
      const next = [];
      for (const id of frontier) {
        for (const e of adj.get(id) || []) {
          if (relLocked(e.rel) || !relVisibleAt(e.rel) || !relVisible(e.rel)) continue;
          if (set.has(e.to)) continue;
          set.add(e.to); next.push(e.to);
        }
      }
      frontier = next;
    }
    return set;
  };
  const passFocus = (id) => { const s = focusSet(); return !s || s.has(id); };

  /** 当前该画什么（节点 / 连线） */
  function visible() {
    const nodes = pack.characters.filter((c) => !isHidden(c) && charVisibleAt(c) && passSize(c.id) && passFocus(c.id));
    const idset = new Set(nodes.map((c) => c.id));
    const links = pack.relations.filter((r) =>
      idset.has(r.from) && idset.has(r.to) && !relLocked(r) && relVisible(r) && passEdge(r) && relVisibleAt(r));
    return { nodes, links };
  }

  /** 标签避让（和网页版同一思路：先按关系数排，再贪婪放；碰撞盒用世界坐标，字号按屏幕尺寸折算）
   *  opts.densityFit = true 时按"节点平均间距"反推字号（分享卡片用：大书才不会只剩一个标签） */
  function labels(scale, opts) {
    const { nodes } = visible();
    const showAll = !!(opts && opts.showAll);
    const zoomedIn = scale >= 0.55;
    const rankMap = rank();
    const pos = (pack.layouts[state.layout] || pack.layouts['gen-v']).pos;
    let fsScreen = Math.max(9, Math.min(20, 11.5 / Math.max(scale, 0.35))) * fontScale();
    if (opts && opts.densityFit && nodes.length > 4) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let cnt = 0;
      for (const c of nodes) {
        const p = pos[c.id];
        if (!p) continue;
        cnt++;
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      }
      if (cnt > 4 && isFinite(minX)) {
        const spacing = Math.sqrt(Math.max(1, (maxX - minX) * (maxY - minY)) / cnt);
        fsScreen = Math.max(8, Math.min(20, spacing * 0.42 * scale)) * fontScale();
      }
    }
    const cands = nodes
      .filter((c) => (isMentioned(c) ? false : (zoomedIn || showAll || (rankMap.get(c.id) || 9999) <= 40)))
      .filter((c) => pos[c.id])
      .map((c) => ({ id: c.id, name: c.name, deg: deg.get(c.id) || 0, size: symbolSize(c.id), p: pos[c.id] }))
      .sort((a, b) => b.deg - a.deg);
    const placed = [], keep = [];
    for (const n of cands) {
      if (keep.length >= 400) break;
      const w = (n.name.length * fsScreen) / scale + 4;
      const h = (fsScreen * 1.25) / scale;
      const r = n.size / 2;
      const gap = 2 / scale;
      const midY = n.p[1] + (fsScreen * 0.35) / scale;
      // 三个候选位：上 / 右 / 左（分组布局里左右通常是空的，能多放不少标签）
      const slots = [
        { align: 'center', x: n.p[0], y: n.p[1] - r - gap, boxX: n.p[0] - w / 2 },
        { align: 'left', x: n.p[0] + r + gap, y: midY, boxX: n.p[0] + r + gap },
        { align: 'right', x: n.p[0] - r - gap, y: midY, boxX: n.p[0] - r - gap - w },
      ];
      let chosen = null;
      for (const s of slots) {
        const box = { x: s.boxX, y: s.y - h / 2, w, h };
        if (placed.some((o) => !(box.x > o.x + o.w || box.x + box.w < o.x || box.y > o.y + o.h || box.y + box.h < o.y))) continue;
        chosen = { s, box };
        break;
      }
      if (!chosen) continue;
      placed.push(chosen.box);
      keep.push({ id: n.id, name: n.name, dx: chosen.s.x, dy: chosen.s.y, align: chosen.s.align });
    }
    return keep;
  }

  /** 命中测试：先节点后连线（世界坐标） */
  function hitTest(wx, wy, scale) {
    const { nodes, links } = visible();
    const pos = (pack.layouts[state.layout] || pack.layouts['gen-v']).pos;
    let best = null;
    for (const c of nodes) {
      const p = pos[c.id];
      if (!p) continue;
      const r = Math.max(8, symbolSize(c.id) / 2) + 6 / Math.max(scale, 0.2);
      const d = Math.hypot(wx - p[0], wy - p[1]);
      if (d <= r && (!best || d < best.d)) best = { kind: 'node', id: c.id, d };
    }
    if (best) return best;
    const seen = new Map();
    for (const r of links) {
      const a = pos[r.from], b = pos[r.to];
      if (!a || !b) continue;
      const key = r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`;
      const n = seen.get(key) || 0;
      seen.set(key, n + 1);
      // 与网页版一致：同一对之间的多条边按序号扇开
      const curve = n === 0 ? 0.08 : (n % 2 === 1 ? -1 : 1) * (0.08 + 0.12 * Math.floor(n / 2));
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const len = Math.hypot(nx, ny) || 1;
      const cx = mx + (nx / len) * curve * len * 0.5, cy = my + (ny / len) * curve * len * 0.5;
      const d = distToQuad(wx, wy, a, [cx, cy], b);
      if (d <= 8 / Math.max(scale, 0.2) && (!best || d < best.d)) best = { kind: 'edge', rel: r, d, curve };
    }
    return best;
  }

  function distToQuad(px, py, a, c, b) {
    let best = Infinity;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, mt = 1 - t;
      const x = mt * mt * a[0] + 2 * mt * t * c[0] + t * t * b[0];
      const y = mt * mt * a[1] + 2 * mt * t * c[1] + t * t * b[1];
      best = Math.min(best, Math.hypot(px - x, py - y));
    }
    return best;
  }

  /** 两人关系：本地 BFS 最短路（每一跳带依据事件） */
  function bfs(fromId, toId) {
    if (fromId === toId) return [];
    const prev = new Map([[fromId, null]]);
    const queue = [fromId];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === toId) break;
      for (const e of adj.get(cur) || []) {
        if (!relVisible(e.rel) || !passEdge(e.rel) || !relVisibleAt(e.rel) || relLocked(e.rel)) continue;
        if (!prev.has(e.to)) { prev.set(e.to, { from: cur, rel: e.rel }); queue.push(e.to); }
      }
    }
    if (!prev.has(toId)) return null;
    const steps = [];
    let cur = toId;
    while (prev.get(cur)) { const p = prev.get(cur); steps.unshift({ from: p.from, to: cur, rel: p.rel }); cur = p.from; }
    return steps;
  }

  const visibleRelEvents = (r) => (r.events || []).filter((e) =>
    (state.progress === null || (chOf(e.chapter) || 0) <= state.progress) && !beforeAsOf(chOf(e.chapter) || 0));

  const charLastCh = (c) => {
    if (!c) return 0;
    let last = charCh(c);
    for (const e of pack.events) if ((e.chars || []).indexOf(c.id) >= 0) last = Math.max(last, e.ch || 0);
    for (const r of pack.relations) {
      if (r.from !== c.id && r.to !== c.id) continue;
      for (const ev of r.events || []) last = Math.max(last, chOf(ev.chapter) || 0);
    }
    return last;
  };
  const fateLocked = (c) => state.progress !== null && charLastCh(c) > state.progress;
  const periodText = (r) => {
    if (typeof r.fromCh !== 'number' && typeof r.toCh !== 'number') return '';
    const from = relFrom(r);
    let to = typeof r.toCh === 'number' ? r.toCh : null;
    const cands = [state.progress, asOf()].filter((x) => typeof x === 'number');
    const limit = cands.length ? Math.min.apply(null, cands) : null;
    if (to !== null && limit !== null && to - 1 > limit) to = null;
    return to !== null ? `第 ${from}–${to - 1} 章` : `第 ${from} 章起`;
  };

  /** 章节视图：第 N 章的世界 */
  function chapterDigest(n) {
    const charsNew = [], charsHere = new Set(), relsNew = [], relsHere = [], places = new Set();
    const placeIds = new Set((pack.places || []).map((p) => p.id));
    for (const c of pack.characters) if (charCh(c) === n) { charsNew.push(c); charsHere.add(c.id); }
    for (const r of pack.relations) {
      if (r.derived) continue;
      const evs = (r.events || []).filter((e) => (chOf(e.chapter) || 0) === n);
      if (!evs.length) continue;
      relsHere.push(r);
      if (relCh(r) === n) relsNew.push(r);
      charsHere.add(r.from); charsHere.add(r.to);
    }
    const events = pack.events.filter((e) => e.ch === n);
    for (const e of events) {
      for (const id of e.chars || []) charsHere.add(id);
      if (e.place && placeIds.has(e.place)) places.add(e.place);
    }
    for (const r of relsHere) for (const ev of r.events || []) if ((chOf(ev.chapter) || 0) === n && ev.place && placeIds.has(ev.place)) places.add(ev.place);
    return {
      n, charsNew, relsNew, events,
      charsHere: [...charsHere].filter((id) => byId.has(id)),
      places: [...places],
      placesNew: [...places].filter((id) => ((pack.places.find((p) => p.id === id) || {}).firstCh || 0) === n),
    };
  }

  const charName = (id) => (byId.get(id) || {}).name || id;
  const placeName = (id) => ((pack.places || []).find((p) => p.id === id) || {}).name || '';

  /** 找人：全名 / 别名（字号、俗称、别的译名）/ 部分匹配；区分"被折叠"与"被剧透保护" */
  function findChar(q) {
    const s = String(q || '').trim();
    if (!s) return null;
    const match = (c) => c.name === s || (c.aliases || []).indexOf(s) >= 0
      || c.name.indexOf(s) >= 0 || (c.aliases || []).some((a) => a.indexOf(s) >= 0);
    const visibleHit = pack.characters.find((c) => !charLocked(c) && charVisibleAt(c) && !isHidden(c) && match(c));
    if (visibleHit) return { hit: visibleHit, hidden: false };
    const hiddenHit = pack.characters.find((c) => !charLocked(c) && charVisibleAt(c) && isHidden(c) && match(c));
    if (hiddenHit) return { hit: hiddenHit, hidden: true };
    const lockedHit = pack.characters.find((c) => charLocked(c) && match(c));
    if (lockedHit) return { hit: null, locked: lockedHit };
    return { hit: null };
  }

  /** 可选人物（两人关系用）：可见、未锁定、未被折叠，按关系数排 */
  function selectable() {
    return pack.characters
      .filter((c) => !charLocked(c) && charVisibleAt(c) && !isHidden(c))
      .sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0));
  }

  return {
    pack, state, byId, adj, deg, KIN, KIN_HINT,
    charCh, relCh, relFrom, maxChapter, timeCeiling, asOf,
    charLocked, relLocked, eventLocked, charVisibleAt, relVisibleAt, relVisible,
    isMinor, isMentioned, isHidden, symbolSize, groupKeyOf, groupLabelOf,
    effectiveFactionKey, factionColorOf, factionTextOf, isGen,
    rank, passSize, focusSet, passFocus,
    visible, labels, hitTest, bfs, visibleRelEvents, fateLocked, periodText,
    chapterDigest, charName, placeName, findChar, selectable, factionColorByKey, fontScale,
  };
}

module.exports = { createGraph, KIN, KIN_HINT };
