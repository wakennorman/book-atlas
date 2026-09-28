/**
 * 书脉 BookAtlas · 共享核心逻辑（纯函数，不碰 DOM / wx）
 *
 * 这层代码在网页版（js/app.js）、小程序（miniprogram/utils/graph.js）、
 * Node 测试（test/smoke.mjs）里都能跑，确保两边口径一致。
 *
 * 用法：
 *   import { createGraphCore } from '../shared/graph-core.js';
 *   const core = createGraphCore({ pack, adj, byId, deg, state });
 *   const steps = core.bfs('a', 'b');
 */
export function createGraphCore({ pack, adj, byId, deg, state }) {
  const maxDeg = Math.max(1, ...[...deg.values()]);

  /* ---------------- 基础工具 ---------------- */
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

  /* ---------------- 章节 / 剧透 / 时间旅行 ---------------- */
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

  /* ---------------- 节点属性 ---------------- */
  const isMinor = (c) => !!c && c.tier === 'minor';
  const isMentioned = (c) => !!c && c.tier === 'mentioned';
  const isHidden = (c) => {
    if (!c) return false;
    if (isMentioned(c)) return !state.showMentioned;
    if (isMinor(c)) return !state.showMinor;
    return false;
  };
  const symbolSize = (id) => Math.max(13, Math.min(40, 13 + 27 * Math.sqrt((deg.get(id) || 0) / maxDeg)));

  /* ---------------- 分组 / 阵营 ---------------- */
  const isGen = (pack.meta.groupMode || 'generation') === 'generation';
  const factionOrder = new Map((pack.factions || []).map((f, i) => [f.key, i]));
  const groupKeyOf = (c) => (isGen ? `g${c.generation}` : `f${c.faction || 'other'}`);
  const groupLabelOf = (c) => {
    if (isGen) return c.generation === 0 ? '前史' : `第 ${c.generation} 代`;
    const f = (pack.factions || []).find((x) => x.key === c.faction);
    return (f && f.name) || '其他';
  };
  const effectiveFactionKey = (c) => {
    const h = c && c.factionHistory;
    if (!Array.isArray(h) || !h.length) return (c && c.faction) || '';
    const n = asOf();
    const ch = n !== null ? n : (state.progress === null ? Infinity : state.progress);
    let pick = h[0];
    for (const seg of h) if (typeof seg.fromCh === 'number' && seg.fromCh <= ch) pick = seg;
    return pick.faction || (c && c.faction) || '';
  };

  /* ---------------- BFS 最短路 ---------------- */
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

  /* ---------------- 关系事件可见性 ---------------- */
  const visibleRelEvents = (r) => (r.events || []).filter((e) =>
    (state.progress === null || (chOf(e.chapter) || 0) <= state.progress) && !beforeAsOf(chOf(e.chapter) || 0));

  /* ---------------- 人物最后出场章 / 结局锁定 ---------------- */
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

  /* ---------------- 时间区间文本 ---------------- */
  const periodText = (r) => {
    if (typeof r.fromCh !== 'number' && typeof r.toCh !== 'number') return '';
    const from = relFrom(r);
    let to = typeof r.toCh === 'number' ? r.toCh : null;
    const cands = [state.progress, asOf()].filter((x) => typeof x === 'number');
    const limit = cands.length ? Math.min.apply(null, cands) : null;
    if (to !== null && limit !== null && to - 1 > limit) to = null;
    return to !== null ? `第 ${from}–${to - 1} 章` : `第 ${from} 章起`;
  };

  /* ---------------- 章节摘要 ---------------- */
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
      placesNew: [...places].filter((id) => {
        const p = (pack.places || []).find((x) => x.id === id);
        return p && (p.firstCh ?? 0) === n;
      }),
    };
  }

  return {
    chOf, STYLE_OF, KIN_BUCKET,
    charCh, relCh, relFrom, maxChapter, timeCeiling, asOf, beforeAsOf,
    lockedCh, charLocked, relLocked, eventLocked, charVisibleAt, relVisibleAt,
    relVisible, passEdge,
    isMinor, isMentioned, isHidden, symbolSize,
    isGen, factionOrder, groupKeyOf, groupLabelOf, effectiveFactionKey,
    bfs, visibleRelEvents, charLastCh, fateLocked, periodText, chapterDigest,
  };
}
