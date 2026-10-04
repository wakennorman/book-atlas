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
  const factionNameByKey = (key) => {
    const f = (pack.factions || []).find((x) => x.key === key);
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
  // ⚠ 分组键与图注都要走 effectiveFactionKey（"按进度的当前归属"），不能读原始 c.faction。
  // 三国 groupMode=faction 且 11 个人物有 factionHistory（贾诩 faction=wei，但 history 起点是 qunxiong@9），
  // 用原始 faction 分组会把"此刻还在群雄"的人画进"曹魏"组，图注也会和节点颜色对不上。
  const groupKeyOf = (c) => (isGen ? `g${c.generation}` : `f${effectiveFactionKey(c) || 'other'}`);
  const groupLabelOf = (c) => (isGen ? (c.generation === 0 ? '前史' : `第 ${c.generation} 代`) : factionNameByKey(effectiveFactionKey(c)));

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

  /* ---------------- 锁定时的可见集合 ----------------
   * v89。锁定（搜索单个人物 / 两人关系）时，图上**只画**锁定集合内的点与线，其余不画。
   *
   * 为什么不能继续"灰掉"：淡掉的线只是把 opacity 调到 0.05，**仍然留在系列里，也没有
   * silent**，而 zrender 的命中测试不看 opacity —— 谁后画谁在上面，就把鼠标事件吃掉。
   * 刘备—诸葛亮那 9 条线在 links 数组里的下标是 472…1438，散落在 1545 条中间，
   * 于是瞄准一条亮线却点不动（实测"大多数线点不动、偶尔能点"）。
   * 不画 = 不存在遮挡，这类问题从根上消失。
   *
   * 下面两个纯函数是这套集合计算的唯一口径，三份实现都要跟它一致（test/parity.mjs 守）。 */

  /** 无向边的 key：同一对人物不论 from/to 谁在前，都是同一个 key。
   *  高亮/锁定都按人物对走（同一对之间的多条线一起亮、一起可点），所以必须是归一的。 */
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  /** 某人 depth 跳以内的邻域。
   *  relLocked / relVisibleAt / relVisible 三个都要查 —— 漏一个就会出现"图上不画的边
   *  却把人算进了集合"，于是冒出一大堆悬空节点（三国曾有 50999 个）。
   *  与 focusSet 同一口径；刻意不查 passEdge（关系类型过滤），跟聚焦保持一致。 */
  function neighborhoodNodes(startId, depth) {
    const set = new Set([startId]);
    let frontier = [startId];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const id of frontier) {
        for (const e of adj.get(id) || []) {
          if (relLocked(e.rel) || !relVisibleAt(e.rel) || !relVisible(e.rel)) continue;
          if (set.has(e.to)) continue;
          set.add(e.to);
          next.push(e.to);
        }
      }
      frontier = next;
    }
    return set;
  }

  /** 两端都在 nodes 里、且关系本身通过可见性判定的边 key 集合。
   *  刻意**不**查关系类型过滤 / 人数过滤 —— 那些是 buildOption 画图时自己过滤的，
   *  在这里重复一遍只会造成两处口径漂移。被过滤掉的边不会画，自然也不会被点到。 */
  function edgesWithin(nodes) {
    const out = new Set();
    for (const r of pack.relations) {
      if (!nodes.has(r.from) || !nodes.has(r.to)) continue;
      if (relLocked(r) || !relVisibleAt(r) || !relVisible(r)) continue;
      out.add(edgeKey(r.from, r.to));
    }
    return out;
  }

  /* ---------------- 聚焦：某人 N 跳以内 ----------------
   * v85 补齐：这份参考实现原本没有 focusSet，导致 app.js 与小程序的两份都没法跟它对拍 ——
   * 而恰恰是 focusSet 在 v85 之前漏查了 relVisible（关掉「族谱补全」聚焦时出现大批悬空节点）。 */
  const focusSet = () => (state.focus ? neighborhoodNodes(state.focus.id, state.focus.depth) : null);

  return {
    chOf, STYLE_OF, KIN_BUCKET,
    charCh, relCh, relFrom, maxChapter, timeCeiling, asOf, beforeAsOf,
    lockedCh, charLocked, relLocked, eventLocked, charVisibleAt, relVisibleAt,
    relVisible, passEdge,
    isMinor, isMentioned, isHidden, symbolSize,
    isGen, factionOrder, groupKeyOf, groupLabelOf, effectiveFactionKey,
    bfs, visibleRelEvents, charLastCh, fateLocked, periodText, chapterDigest,
    focusSet, edgeKey, neighborhoodNodes, edgesWithin, forceLayout,
  };
}

/* ---------------- 力导向布局（v92 新增：固定种子 + 固定轮数 ⇒ 可复现） ----------------
 *
 * 用户问"为什么每次打开人物所在的位置都不一样，是不是每次都重新生成"。
 * 实测下来 ECharts 自带的力导向**不可复现**：它是按帧跑的（`layoutAnimation`），
 * 冻结时刻落在第几步取决于帧率 —— 同一本书、同一视口，两次冷启动实测最大差 22 个单位。
 * d3 的文档把这件事讲得很直白：
 *   "events are only dispatched by the internal timer... and are intended for interactive rendering"
 *   —— 帧驱动只适合"边看边动"；要可复现必须 `simulation.stop()` 然后按固定次数 `tick()`。
 * ECharts 没暴露"跑固定步数"的接口，所以这里自己实现一份（和
 * `scripts/make-miniprogram-packs.mjs` 的那份同源，见那里的注释）：
 *   · 固定种子 20260927 的 LCG 决定初始点（按 id 顺序，可复现）
 *   · 固定轮数（按节点数选档，不看时间）
 *   · 每轮固定步长，没有帧、没有时间参与
 *   · 网格近似算斥力：n > 400 时 O(n) 而不是 O(n²)
 *
 * 实测三国 871 人 / 2232 关系：**209–299ms**，两次结果 871/871 逐位相同。
 * 顺带一提，ECharts 那版要 1096–1151ms —— 比它快 4 倍，还更稳。
 *
 * @param {number} n 节点数
 * @param {Array<[number,number]>} links 下标对（两端都是 0..n-1）
 * @param {number} seed 固定种子
 * @returns {{xs: Float64Array, ys: Float64Array, iters: number}}
 */
export function forceLayout(n, links, seed = 20260927) {
  const xs = new Float64Array(n), ys = new Float64Array(n);
  const disp = new Float64Array(n * 2);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const R = Math.max(400, Math.sqrt(n) * 42);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
    xs[i] = Math.cos(a) * r; ys[i] = Math.sin(a) * r;
  }
  const k = Math.sqrt((R * R * 4) / Math.max(1, n));
  let t = k * 0.9;
  const iters = n > 500 ? 90 : n > 200 ? 160 : 320;
  for (let it = 0; it < iters; it++) {
    disp.fill(0);
    if (n <= 400) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const dx = xs[i] - xs[j], dy = ys[i] - ys[j];
        const d = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
        const f = (k * k) / d, ux = dx / d, uy = dy / d;
        disp[i * 2] += ux * f; disp[i * 2 + 1] += uy * f;
        disp[j * 2] -= ux * f; disp[j * 2 + 1] -= uy * f;
      }
    } else {
      const cell = k * 2;
      const grid = new Map();
      const key = (x, y) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
      for (let i = 0; i < n; i++) { const gk = key(xs[i], ys[i]); if (!grid.has(gk)) grid.set(gk, []); grid.get(gk).push(i); }
      for (let i = 0; i < n; i++) {
        const gx = Math.floor(xs[i] / cell), gy = Math.floor(ys[i] / cell);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const arr = grid.get(`${gx + ox}:${gy + oy}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue;
            const dx = xs[i] - xs[j], dy = ys[i] - ys[j];
            const d = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
            const f = (k * k) / d, ux = dx / d, uy = dy / d;
            disp[i * 2] += ux * f; disp[i * 2 + 1] += uy * f;
            disp[j * 2] -= ux * f; disp[j * 2 + 1] -= uy * f;
          }
        }
      }
    }
    for (const [a, b] of links) {
      const dx = xs[a] - xs[b], dy = ys[a] - ys[b];
      const d = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const f = (d * d) / k, ux = dx / d, uy = dy / d;
      disp[a * 2] -= ux * f; disp[a * 2 + 1] -= uy * f;
      disp[b * 2] += ux * f; disp[b * 2 + 1] += uy * f;
    }
    // 按温度限幅移动（不限幅会爆成 Infinity/NaN）+ 轻微向心
    for (let i = 0; i < n; i++) {
      const dx = disp[i * 2], dy = disp[i * 2 + 1];
      const d = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
      const lim = Math.min(d, t) / d;
      xs[i] = (xs[i] + dx * lim) * 0.999;
      ys[i] = (ys[i] + dy * lim) * 0.999;
    }
    t *= 0.94;
  }
  // 兜底：非有限坐标归零（宁可堆在中心，也不要 NaN 传下去变成 null）
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) { xs[i] = 0; ys[i] = 0; }
  }
  return { xs, ys, iters };
}
