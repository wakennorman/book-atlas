/* 书脉 BookAtlas · 前端逻辑
 * 数据与渲染分离：每本书一个 JSON，见 data/ 目录。
 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const state = {
    books: [],
    book: null,
    byId: new Map(),
    adj: new Map(),        // id -> [{ to, rel }]
    chart: null,
    frozen: false,         // 力导向布局是否已冻结（冻结后按 x/y 渲染，便于稳定高亮）
    pos: new Map(),        // id -> { x, y }
    hlNodes: new Set(),    // 当前高亮的节点
    hlEdges: new Set(),    // 当前高亮的边（key = `a|b` 无序）
    activeChar: null,
    activeEvent: null,
    activeFaction: null,
    allLabels: false,
    view: 'force',         // force | gen-h | gen-v
    bands: new Map(),      // 代际视图：generation -> 主坐标
    fit: { s: 1, cx: 0, cy: 0 }, // 最近一次 fitPositions 的变换（供代际参考线换算）
    bbox: null,            // 节点包围盒（缩放后、居中于 0）——图注按它定位
    freezeTimer: null,
    progress: null,        // 剧透保护：null=全部解锁；数字=已读到第几章，之后的锁定
    chapter: 1,            // 章节视图：当前翻到第几章
    timeTravel: false,     // 时间旅行：把图谱拨回第 chapter 章（只画当时已发生的关系）
    nodeDrag: false,       // 是否允许拖动单个节点（默认关，避免与画布平移打架）
    maxDeg: 1,             // 本书最大关系数（symbolSize 的开方刻度用）
    groupMode: 'generation', // 'generation'（有代际）| 'faction'（无代际，按阵营分组）
    bandLabels: new Map(),   // 分组键 -> 图注文字（第 N 代 / 阵营名）
    places: new Map(),       // placeId -> place
    placeFilter: null,       // 当前地点筛选
    showMentioned: false,    // 是否显示「仅被提及」的人物（默认折叠）
    showMinor: false,        // 是否显示 tier=minor 的次要人物（大书默认折叠）
    showDerived: true,       // 是否显示"族谱补全"推导出来的祖孙/叔侄等关系（默认显示）
    a11yPalette: false,      // 无障碍：色盲友好配色（Okabe–Ito 八色，按阵营顺序分配）
    fontSize: 'm',           // 无障碍：字号 s | m | l
    edgeStyles: new Set(),   // 关系过滤：只显示这些线条（空＝全部）solid | dashed | dotted
    edgeKins: new Set(),     // 关系过滤：只显示这些亲缘桶（空＝全部）blood | marriage | adopt | sworn | none
    sizeFilter: 'all',       // all | mid | main（按关系数只显示主要人物；大书用）
    focus: null,             // { id, depth } 只看某人 N 跳以内（无限画布的"放大镜"）
    focusCache: null,        // 聚焦集合缓存
    rank: null,              // id -> 关系数排名（sizeFilter 用）
    zoom: 1,                 // 当前缩放（标签按缩放分级显示）
    viewCenter: [0, 0],      // 视角中心（graph series 的 center；0,0 = 节点云中心）
    labelTimer: null,
    fold: {},                // 长列表折叠：key -> 当前显示条数（缺省＝默认收起）
  };

  /* ---------------- 工具 ---------------- */
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ---- 长列表「展开/收起」（规范：docs/superpowers/specs/2026-09-28-panel-fold-design.md）---- */
  const FOLD_BATCH = 20;     // 超长列表每次「再显示」的条数
  const FOLD_ONESTEP = 40;   // 总数 ≤ 此值时一键展开（不分批）

  // 折叠段的视图模型：按 state.fold[key] 算当前显示几条、按钮文案与语义
  function foldVM(key, n, unit, total) {
    const shown = Math.min(Math.max(state.fold[key] || n, n), total);
    const open = shown > n;
    const full = shown >= total;
    let act = 'more';
    const step = Math.min(FOLD_BATCH, total - shown);   // 最后一批常不足 20，文案必须说真话
    let text = `再显示 ${step} ${unit}（${shown} / ${total}）`;
    if (full) { act = 'collapse'; text = '⌃ 收起'; }
    else if (total <= FOLD_ONESTEP) { act = 'all'; text = `⌄ 展开全部 ${total} ${unit}`; }
    return { shown, open, full, act, text };
  }

  // 把"已渲染好的条目 HTML 数组"包成可折叠段；总数 ≤ n 时原样返回（不折）
  // opts: { key, n, unit, cls, wrap('ul'|'div'), bare(不折时 true＝不包外层), items }
  function foldSection(opts) {
    const { key, n, unit = '条', cls = '', wrap = 'ul', bare = false, items } = opts;
    const total = items.length;
    if (total <= n) return bare ? items.join('') : `<${wrap} class="${cls}">${items.join('')}</${wrap}>`;
    const v = foldVM(key, n, unit, total);
    const bid = `fold-${String(key).replace(/[^a-zA-Z0-9]+/g, '-')}`;
    // 超出当前显示数的条目，在开标签后补 hidden（条目都是我们自己拼的开标签：要同时认 <li>/<button>/<div>，否则关系卡 bare 模式的 div 条目烘不上 hidden）
    const body = items.map((h, i) => {
      if (i < v.shown) return h;
      const out = h.replace(/^(\s*<[a-zA-Z][\w-]*)/, '$1 hidden');
      if (out === h) console.warn('foldSection: 条目未以开标签开头，hidden 烘焙失败（会漏到首屏）', key, i);
      return out;
    }).join('');
    return `<section class="fold${v.open ? ' is-open' : ''}" data-fold-key="${esc(key)}" data-n="${n}" data-unit="${esc(unit)}">
      <div class="fold-head"${v.open ? '' : ' hidden'}><button class="fold-btn" type="button" data-fold="${esc(key)}" data-fold-act="collapse" aria-expanded="${v.open}" aria-controls="${bid}">⌃ 收起</button></div>
      <${wrap} class="${cls} fold-body${v.full ? '' : ' is-cut'}" id="${bid}">${body}</${wrap}>
      <div class="fold-foot">
        <button class="fold-btn" type="button" data-fold="${esc(key)}" data-fold-act="${v.act}" aria-expanded="${v.open}" aria-controls="${bid}">${v.text}</button>
        <button class="fold-btn fold-alt" type="button" data-fold="${esc(key)}" data-fold-act="all" aria-expanded="${v.open}" aria-controls="${bid}"${total > FOLD_ONESTEP && !v.full ? '' : ' hidden'}>全部展开</button>
      </div>
    </section>`;
  }

  // 点击后原地刷新一个折叠段：只切 hidden 与按钮文案，不重渲染面板（AI 结果等状态不丢）
  function applyFolds(sec) {
    if (!sec || !sec.classList || !sec.classList.contains('fold')) return;
    const key = sec.dataset.foldKey;
    const n = Number(sec.dataset.n) || 6;
    const unit = sec.dataset.unit || '条';
    const foldBody = sec.querySelector('.fold-body');
    if (!foldBody) return;
    const kids = [...foldBody.children];
    const v = foldVM(key, n, unit, kids.length);
    kids.forEach((el, i) => { el.hidden = i >= v.shown; });
    sec.classList.toggle('is-open', v.open);
    foldBody.classList.toggle('is-cut', !v.full);
    const head = sec.querySelector('.fold-head');
    if (head) head.hidden = !v.open;
    const foot = sec.querySelectorAll('.fold-foot .fold-btn');
    if (foot[0]) {
      foot[0].dataset.foldAct = v.act;
      foot[0].textContent = v.text;
      foot[0].setAttribute('aria-expanded', String(v.open));
    }
    if (foot[1]) {
      foot[1].hidden = !(kids.length > FOLD_ONESTEP && !v.full);
      foot[1].setAttribute('aria-expanded', String(v.open));
    }
    const headBtn = head && head.querySelector('.fold-btn');
    if (headBtn) headBtn.setAttribute('aria-expanded', String(v.open));
  }

  // 亲属关系（kin）徽章：血缘 / 婚姻 / 姻亲 / 收养 / 抚养 / 继亲 / 结义
  const KIN_LABEL = { blood: '血缘', marriage: '婚姻', inlaw: '姻亲', adoptive: '收养', foster: '抚养', step: '继亲', sworn: '结义' };
  const KIN_HINT = {
    blood: '亲生血缘', marriage: '夫妻（婚姻）', inlaw: '姻亲（配偶方亲属）',
    adoptive: '正式收养', foster: '非正式（被谁带大、寄养）', step: '继亲（继父母/继子女）', sworn: '结义／干亲／教父'
  };
  const kinBadge = (rel) => {
    const k = rel && rel.kin;
    return k && KIN_LABEL[k] ? ` <span class="kin-badge k-${esc(k)}" title="${KIN_LABEL[k]}：${KIN_HINT[k] || ''}">${KIN_LABEL[k]}</span>` : '';
  };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const genText = (g) => (g === 0 ? '前史' : `第 ${g} 代`);
  const charName = (id) => state.byId.get(id)?.name || id;

  /* ---------------- 分组（有代际按代，无代际按阵营） ---------------- */
  const factionNameOf = (c) => (state.book?.factions.find((f) => f.key === c.faction) || {}).name || '其他';
  /**
   * 阵营变化的"当前归属"：characters[].factionHistory = [{ faction, fromCh, label }]
   * · 剧透保护开着时，按"你读到的那一回"算（读者不该在第 3 回就看到他后来投了谁）
   * · 没开保护 → 取最后一段（最终归属）
   */
  function effectiveFactionKey(c) {
    const h = c && c.factionHistory;
    if (!Array.isArray(h) || !h.length) return (c && c.faction) || '';
    const n = asOf();
    const ch = n !== null ? n : (state.progress === null ? Infinity : state.progress);
    let pick = h[0];
    for (const seg of h) if (typeof seg.fromCh === 'number' && seg.fromCh <= ch) pick = seg;
    return pick.faction || (c && c.faction) || '';
  }
  /* ---------------- 无障碍：色盲友好配色 + 字号 ---------------- */
  const A11Y_PALETTE = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#8b94a7'];
  const FONT_SCALE = { s: 0.9, m: 1, l: 1.18 };
  const fontScale = () => FONT_SCALE[state.fontSize] || 1;
  const factionIndexOf = (key) => Math.max(0, state.book ? state.book.factions.findIndex((f) => f.key === key) : 0);
  const factionColorByKey = (key) => {
    if (state.a11yPalette) return A11Y_PALETTE[factionIndexOf(key) % A11Y_PALETTE.length];
    const f = state.book && state.book.factions.find((x) => x.key === key);
    return (f && f.color) || '#8b94a7';
  };
  function syncDisplayUI() {
    document.body.dataset.fontsize = state.fontSize;
    document.querySelectorAll('[data-palette]').forEach((el) => el.classList.toggle('on', (el.dataset.palette === 'a11y') === !!state.a11yPalette));
    document.querySelectorAll('[data-font]').forEach((el) => el.classList.toggle('on', el.dataset.font === state.fontSize));
    const btn = document.getElementById('display-btn');
    if (btn) btn.classList.toggle('active', !!state.a11yPalette || state.fontSize !== 'm');
  }
  function applyDisplay() {
    try {
      localStorage.setItem('ba-a11y-palette', state.a11yPalette ? '1' : '0');
      localStorage.setItem('ba-fontsize', state.fontSize);
    } catch (e) { /* 隐私模式忽略 */ }
    syncDisplayUI();
    renderLegend();
    if (state.chart) { computeLabels(state.zoom); state.chart.clear(); state.chart.setOption(buildOption(), { notMerge: true }); }
  }

  const factionColorOf = (c) => {
    const key = effectiveFactionKey(c);
    return factionColorByKey(key);
  };
  const factionTextOf = (c) => {
    const key = effectiveFactionKey(c);
    return (state.book?.factions.find((f) => f.key === key) || {}).name || '其他';
  };
  const groupKeyOf = (c) => (state.groupMode === 'generation' ? `g${c.generation}` : `f${effectiveFactionKey(c) || 'other'}`);
  const groupLabelOf = (c) => (state.groupMode === 'generation' ? genText(c.generation) : factionNameOf(c));
  const genPrefix = (c) => (state.groupMode === 'generation' ? esc(genText(c.generation)) + ' · ' : '');
  const isMentioned = (c) => c && c.tier === 'mentioned';
  const isMinor = (c) => c && c.tier === 'minor';
  const isDerived = (r) => !!(r && r.derived);                 // 由亲子关系推导出来的族谱边（原文没有直接互动）
  const relVisible = (r) => !isDerived(r) || state.showDerived;

  /* —— 关系过滤（边的类型）：亲缘桶 + 线条样式，两轴独立，空＝不过滤 —— */
  const styleOf = (r) => (r.style === 'dashed' ? 'dashed' : r.style === 'dotted' ? 'dotted' : 'solid');
  const kinBucketOf = (r) => {
    const k = r && r.kin;
    if (k === 'blood') return 'blood';
    if (k === 'marriage' || k === 'inlaw') return 'marriage';
    if (k === 'adoptive' || k === 'foster' || k === 'step') return 'adopt';
    if (k === 'sworn') return 'sworn';
    return 'none';
  };
  const passEdgeFilter = (r) => {
    if (!r) return true;
    if (state.edgeStyles.size && !state.edgeStyles.has(styleOf(r))) return false;
    if (state.edgeKins.size && !state.edgeKins.has(kinBucketOf(r))) return false;
    return true;
  };
  const edgeFilterCount = () => state.edgeStyles.size + state.edgeKins.size;
  function syncEdgeFilterUI() {
    const btn = document.getElementById('edge-filter-btn');
    if (btn) {
      const n = edgeFilterCount();
      btn.textContent = n ? `关系：筛选 ${n} 项` : '关系：全部';
      btn.classList.toggle('active', n > 0);
    }
    document.querySelectorAll('[data-edge-kin]').forEach((el) => { el.checked = state.edgeKins.has(el.dataset.edgeKin); });
    document.querySelectorAll('[data-edge-style]').forEach((el) => { el.checked = state.edgeStyles.has(el.dataset.edgeStyle); });
    const dv = document.getElementById('edge-derived');
    if (dv) dv.checked = !!state.showDerived;
  }
  function saveEdgeFilter() {
    try { localStorage.setItem('ba-edge-filter', JSON.stringify({ styles: [...state.edgeStyles], kins: [...state.edgeKins] })); } catch (e) { /* 隐私模式忽略 */ }
  }
  function applyEdgeFilter() {
    saveEdgeFilter();
    syncEdgeFilterUI();
    if (state.chart) { freezeNow(); state.chart.setOption(buildOption({ keepView: true })); }
    refreshPanel();
    updateCountHint();
  }
  // 折叠：mentioned（没出场）/ minor（只跟一两个人有关系，大书里默认收起）——被高亮/搜索命中时照样显示
  const isCharHidden = (c) => {
    if (!c) return false;
    if (state.hlNodes.has(c.id)) return false;
    if (isMentioned(c)) return !state.showMentioned;
    if (isMinor(c)) return !state.showMinor;
    return false;
  };
  const placeOf = (id) => state.places.get(id) || null;
  const placeName = (id) => (placeOf(id) || {}).name || '';
  // 地点范围：该地点的事件涉及的人物 + 该地点发生的关系事件的两端
  const placeNodeScope = () => {
    if (!state.placeFilter) return null;
    const nodes = new Set();
    for (const e of state.book.events) if (e.place === state.placeFilter && !eventLocked(e) && eventVisibleAt(e)) for (const cid of e.chars || []) if (state.byId.has(cid)) nodes.add(cid);
    for (const r of state.book.relations) for (const ev of r.events || []) if (ev.place === state.placeFilter) { nodes.add(r.from); nodes.add(r.to); }
    return nodes;
  };
  const placeRelSet = (r) => (r.events || []).some((ev) => ev.place === state.placeFilter);

  /* ---------------- 剧透保护（按章节进度锁定） ---------------- */
  const chOf = (s) => { const m = String(s || '').match(/(\d+)/); return m ? Number(m[1]) : null; };
  const charCh = (c) => (typeof c?.firstCh === 'number' ? c.firstCh : (chOf(c?.chapter) || 0));
  const relCh = (r) => {
    const list = (r.events || []).map((e) => chOf(e.chapter)).filter((n) => n !== null);
    if (list.length) return Math.min(...list);
    return Math.min(charCh(state.byId.get(r.from)), charCh(state.byId.get(r.to)));
  };
  const lockedCh = (ch) => state.progress !== null && ch > state.progress;
  const charLocked = (c) => !!c && lockedCh(charCh(c));
  const relLocked = (r) => lockedCh(relCh(r));
  const eventLocked = (e) => lockedCh(typeof e.ch === 'number' ? e.ch : 0);
  const eventChOf = (ev) => chOf(ev?.chapter) ?? 0;

  /* ---------------- 时间旅行（把图谱拨回第 N 章，不动真实阅读进度） ---------------- */
  const asOf = () => {
    if (!state.timeTravel) return null;
    return Math.min(state.chapter || 1, timeCeiling());   // 剧透保护开着时，图谱最多拨到"读到的那一章"
  };
  const beforeAsOf = (ch) => { const n = asOf(); return n !== null && (Number(ch) || 0) > n; };
  // 关系的时间区间：fromCh＝成立章（缺省用「解锁章」）、toCh＝结束章（独占：第 toCh 章起不再存在）
  const relFrom = (r) => (typeof r.fromCh === 'number' ? r.fromCh : relCh(r));
  const relAliveAt = (r, n) => {
    const from = relFrom(r);
    const to = typeof r.toCh === 'number' ? r.toCh : null;
    return from <= n && (to === null || to > n);
  };
  const relVisibleAt = (r) => { const n = asOf(); return n === null || relAliveAt(r, n); };
  const charVisibleAt = (c) => !beforeAsOf(charCh(c));
  const eventVisibleAt = (e) => !beforeAsOf(typeof e.ch === 'number' ? e.ch : 0);
  const periodText = (r) => {
    if (typeof r.fromCh !== 'number' && typeof r.toCh !== 'number') return '';
    const from = relFrom(r);
    let to = typeof r.toCh === 'number' ? r.toCh : null;
    // ★ 不提前告诉读者"这段关系到第几章结束"：结束章在进度/时间旅行之后时，只写"第 X 章起"
    const cands = [state.progress, asOf()].filter((x) => typeof x === 'number');
    const limit = cands.length ? Math.min(...cands) : null;
    if (to !== null && limit !== null && to - 1 > limit) to = null;
    return to !== null ? `第 ${from}–${to - 1} 章` : `第 ${from} 章起`;
  };

  const visibleRelEvents = (r) => (r.events || []).filter((ev) =>
    (state.progress === null || eventChOf(ev) <= state.progress) && !beforeAsOf(eventChOf(ev)));
  const relHiddenEventCount = (r) => (r.events || []).length - visibleRelEvents(r).length;
  // 人物的「最后出场章」＝本人出场章、相关事件章、相关关系事件章的最大值（用来决定结局能不能显示）
  const charLastCh = (c) => {
    if (!c || !state.book) return 0;
    let last = charCh(c);
    for (const e of state.book.events) if ((e.chars || []).includes(c.id)) last = Math.max(last, e.ch || 0);
    for (const r of state.book.relations) {
      if (r.from !== c.id && r.to !== c.id) continue;
      for (const ev of r.events || []) last = Math.max(last, eventChOf(ev));
    }
    return last;
  };
  const fateLocked = (c) => state.progress !== null && charLastCh(c) > state.progress;
  const maxChapter = () => state.book?.meta?.chapters || Math.max(
    0,
    ...state.book.characters.map(charCh),
    ...state.book.events.map((e) => e.ch || 0)
  );
  const orderPair = (a, b) => {
    const pa = state.pos.get(a), pb = state.pos.get(b);
    if (pa && pb) {
      const horizontal = Math.abs(pb.x - pa.x) >= Math.abs(pb.y - pa.y);
      const first = horizontal ? (pa.x <= pb.x ? a : b) : (pa.y <= pb.y ? a : b);
      return [first, first === a ? b : a];
    }
    return [a, b];
  };

  /* ---------------- 数据加载 ---------------- */
  async function boot() {
    const inline = window.__BA_STANDALONE_BOOK;
    if (inline) {
      // 单文件版（导出给别人看的）：数据内联在 HTML 里，不读 data/、不联网
      state.books = [{ slug: (inline.meta && inline.meta.slug) || 'inline', title: (inline.meta && inline.meta.title) || '书脉', inline: true }];
    } else {
      try {
        const res = await fetch('data/books.json', { cache: 'no-cache' });
        state.books = (await res.json()).books || [];
      } catch (e) {
        $('#book-meta').textContent = '数据加载失败：请用本地服务器打开（见 README）';
        return;
      }
      if (!state.books.length) { $('#book-meta').textContent = '还没有书目数据'; return; }
    }

    const params = new URLSearchParams(location.search);
    const wanted0 = params.get('book');
    const wantLocal = params.get('local') === '1';

    // 浏览器本地草稿（编辑器保存的）也放进书目列表
    if (!inline) for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('ba-draft-')) continue;
      try {
        const draft = JSON.parse(localStorage.getItem(key));
        const slug = draft?.meta?.slug || key.replace('ba-draft-', '');
        const entry = { slug, title: `${draft?.meta?.title || slug}（本地草稿）`, local: true };
        const idx = state.books.findIndex((b) => b.slug === slug);
        if (idx >= 0) {
          if (wantLocal && slug === wanted0) state.books[idx] = entry;   // 预览本地草稿时覆盖正式版
          continue;
        }
        state.books.push(entry);
      } catch (e) { /* 忽略坏草稿 */ }
    }

    const sel = $('#book-select');
    sel.innerHTML = state.books.map((b) => `<option value="${esc(b.slug)}">${esc(b.title)}</option>`).join('');
    sel.addEventListener('change', () => loadBook(sel.value));

    const wanted = params.get('book');
    const slug = state.books.some((b) => b.slug === wanted) ? wanted : state.books[0].slug;
    sel.value = slug;
    await loadBook(slug);
  }

  async function loadBook(slug) {
    const perf = (window.__baPerf = window.__baPerf || {});
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const meta = state.books.find((b) => b.slug === slug);
    let book;
    if (meta && meta.inline) {
      book = window.__BA_STANDALONE_BOOK;
    } else if (meta && meta.local) {
      book = JSON.parse(localStorage.getItem('ba-draft-' + slug));
    } else {
      const res = await fetch(meta.file, { cache: 'no-cache' });
      book = await res.json();
    }
    perf.fetchParse = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));
    state.book = book;
    state.byId = new Map(book.characters.map((c) => [c.id, c]));
    state.adj = new Map(book.characters.map((c) => [c.id, []]));
    for (const r of book.relations) {
      if (!state.byId.has(r.from) || !state.byId.has(r.to)) continue;
      state.adj.get(r.from).push({ to: r.to, rel: r });
      state.adj.get(r.to).push({ to: r.from, rel: r });
    }
    const savedView = localStorage.getItem('ba-view');
    state.view = ['force', 'gen-h', 'gen-v'].includes(savedView) ? savedView : 'gen-v';
    state.bands = new Map();
    const gens = new Set(book.characters.map((c) => c.generation));
    state.groupMode = (book.meta && book.meta.groupMode) || (gens.size > 1 ? 'generation' : 'faction');
    state.bandLabels = new Map();
    state.places = new Map((book.places || []).map((p) => [p.id, p]));
    state.placeFilter = null;
    state.rank = null;
    state.focus = null;
    state.fold = {};                    // 换书后清空长列表展开状态
    state.focusCache = null;
    state.zoom = 1;
    state.viewCenter = [0, 0];
    state.hubId = null;
    state.kbCursor = null;                 // 换书后键盘光标重置
    state.symCache = null;                 // 换书后要重算节点尺寸缓存
    state.maxDeg = Math.max(1, ...book.characters.map((c) => nodeDegree(c.id)));
    try { state.sizeFilter = localStorage.getItem('ba-size-filter') || 'all'; } catch (e) { state.sizeFilter = 'all'; }
    const sizeSel0 = document.getElementById('size-filter');
    if (sizeSel0) sizeSel0.value = state.sizeFilter;
    renderFocusBar();
    try { state.showMentioned = localStorage.getItem('ba-mentioned') === '1'; } catch (e) { state.showMentioned = false; }
    try { state.showMinor = localStorage.getItem('ba-minor') === '1'; } catch (e) { state.showMinor = false; }
    try { state.showDerived = localStorage.getItem('ba-derived') !== '0'; } catch (e) { state.showDerived = true; }
    // 无障碍：配色与字号
    try {
      state.a11yPalette = localStorage.getItem('ba-a11y-palette') === '1';
      const fs = localStorage.getItem('ba-fontsize');
      state.fontSize = ['s', 'm', 'l'].includes(fs) ? fs : 'm';
    } catch (e) { state.a11yPalette = false; state.fontSize = 'm'; }
    syncDisplayUI();
    // 关系过滤（边的类型）也跟着记住
    state.edgeStyles = new Set();
    state.edgeKins = new Set();
    try {
      const f = JSON.parse(localStorage.getItem('ba-edge-filter') || '{}');
      if (Array.isArray(f.styles)) state.edgeStyles = new Set(f.styles);
      if (Array.isArray(f.kins)) state.edgeKins = new Set(f.kins);
    } catch (e) { /* 坏数据忽略 */ }
    syncEdgeFilterUI();
    const savedSpoiler = localStorage.getItem('ba-spoiler-' + book.meta.slug);
    state.progress = null;
    if (savedSpoiler) {
      try { const s = JSON.parse(savedSpoiler); state.progress = s.on ? s.ch : null; } catch (e) { state.progress = null; }
    }
    // 章节视图：默认停在你读到的进度（没开保护就回到上次翻到的那一章）
    let savedCh = 0;
    try { savedCh = Number(localStorage.getItem('ba-chapter-' + book.meta.slug)) || 0; } catch (e) { savedCh = 0; }
    state.chapter = Math.max(1, Math.min(maxChapter() || 1, savedCh || state.progress || 1));
    try { state.timeTravel = localStorage.getItem('ba-timetravel') === '1'; } catch (e) { state.timeTravel = false; }
    if (state.timeTravel) state.chapter = Math.min(state.chapter, timeCeiling());
    clearHighlight(false);
    try { history.replaceState(null, '', `?book=${encodeURIComponent(slug)}`); } catch (e) { /* file:// 或沙箱里可能不允许改地址 */ }
    renderHeader();
    renderLegend();
    renderDatalist();
    renderPathSelects();
    renderTimeline();
    renderChapter();
    syncTimeTravelUI();
    renderPlaceSelect();
    renderPanelWelcome();
    initChart();
    syncSpoilerButton();
    perf.chart = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) - perf.fetchParse);
    perf.total = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    perf.slug = slug;
    perf.nodes = book.characters.length;
    perf.relations = book.relations.length;
    if (!savedSpoiler) setTimeout(() => openSpoilerModal(), 400);
  }

  /* ---------------- 头部 / 图例 / 表单 ---------------- */
  function renderHeader() {
    const b = state.book, m = b.meta || {};
    const catalog = state.books.find((x) => x.slug === m.slug) || {};
    const links = (catalog.links || []).map((l) =>
      `<a class="meta-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('');
    $('#book-meta').innerHTML =
      esc(`《${m.title || m.slug || '未命名'}》${m.author ? ' · ' + m.author : ''} · ${b.characters.length} 人 / ${b.relations.length} 段关系 / ${b.events.length} 个事件`) +
      (links ? ` <span class="meta-links">${links}</span>` : '');
    document.title = `《${m.title || '书脉'}》· 书脉 BookAtlas`;
    $('#footer-note').textContent = `${m.note || ''} ${m.prophecy ? '「' + m.prophecy + '」' : ''}`.trim();
  }

  function renderLegend() {
    const el = $('#legend');
    el.innerHTML = state.book.factions.map((f) =>
      `<button type="button" class="legend-item" data-faction="${esc(f.key)}"><span class="dot" style="background:${esc(factionColorByKey(f.key))}"></span>${esc(f.name)}</button>`
    ).join('');
    el.querySelectorAll('.legend-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.faction;
        if (state.activeFaction === key) { clearHighlight(); return; }
        state.activeFaction = key;
        const nodes = new Set(state.book.characters.filter((c) => effectiveFactionKey(c) === key).map((c) => c.id));
        const edges = new Set();
        for (const r of state.book.relations) if (nodes.has(r.from) || nodes.has(r.to)) edges.add(edgeKey(r.from, r.to));
        setHighlight(nodes, edges, null, null);
      });
    });
  }

  function renderDatalist() {
    $('#char-list').innerHTML = state.book.characters
      .filter((c) => !charLocked(c) && charVisibleAt(c) && !isCharHidden(c))
      .map((c) => `<option value="${esc(c.name)}">${esc(c.title)}</option>`).join('');
  }

  function renderPathSelects() {
    const opts = state.book.characters.filter((c) => !charLocked(c) && charVisibleAt(c) && !isCharHidden(c))
      .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const a = $('#path-a'), b = $('#path-b');
    a.innerHTML = `<option value="">人物 A</option>${opts}`;
    b.innerHTML = `<option value="">人物 B</option>${opts}`;
    // 默认给一个与主线有关的提示（第一对主要人物由数据决定，这里保持空）
  }

  /* ---------------- 图表 ---------------- */
  function nodeDegree(id) { return state.adj.get(id)?.length || 0; }
  // 大小＝关系条数（开方压缩：曹操和只有 4 条关系的人也能看出差别，又不至于顶到天花板）
  // 缓存起来：这个函数在松弛/标签里会被调用几十万次
  function symbolSize(id) {
    if (!state.symCache) state.symCache = new Map();
    const hit = state.symCache.get(id);
    if (hit !== undefined) return hit;
    const deg = nodeDegree(id);
    const max = Math.max(1, state.maxDeg || 1);
    const v = Math.max(13, Math.min(40, 13 + 27 * Math.sqrt(deg / max)));
    state.symCache.set(id, v);
    return v;
  }
  function categoryOf(c) {
    const idx = state.book.factions.findIndex((f) => f.key === c.faction);
    return idx >= 0 ? idx : 0;
  }

  /* —— 人数过滤（书太大时先只看主要人物） —— */
  function degreeRanking() {
    if (!state.rank) {
      state.rank = new Map();
      const sorted = [...state.byId.keys()].sort((a, b) => nodeDegree(b) - nodeDegree(a));
      sorted.forEach((id, i) => state.rank.set(id, i + 1));
    }
    return state.rank;
  }
  function sizeLimit() {
    return state.sizeFilter === 'main' ? 60 : state.sizeFilter === 'mid' ? 200 : Infinity;
  }
  function passSizeFilter(id) {
    const lim = sizeLimit();
    if (lim === Infinity) return true;
    if (state.focus && state.focus.id === id) return true;              // 聚焦的人永远显示
    return (degreeRanking().get(id) || 9999) <= lim;
  }

  /* —— 聚焦：只看某人 N 跳以内 —— */
  function focusSet() {
    if (!state.focus) return null;
    const key = `${state.focus.id}|${state.focus.depth}`;
    if (state.focusCache && state.focusCache.key === key) return state.focusCache.set;
    const set = new Set([state.focus.id]);
    let frontier = [state.focus.id];
    for (let d = 0; d < state.focus.depth; d++) {
      const next = [];
      for (const id of frontier) {
        for (const { to, rel } of state.adj.get(id) || []) {
          if (relLocked(rel) || !relVisibleAt(rel)) continue;
          if (set.has(to)) continue;
          set.add(to);
          next.push(to);
        }
      }
      frontier = next;
    }
    state.focusCache = { key, set };
    return set;
  }
  const passFocus = (id) => {
    const set = focusSet();
    return !set || set.has(id);
  };

  function buildOption(opts = {}) {
    const b = state.book;
    const ink = cssVar('--ink') || '#232a35';
    const muted = cssVar('--muted') || '#6c7482';
    const panel = cssVar('--panel') || '#fff';
    const line = cssVar('--line') || '#e5dfd3';
    const anyDim = state.hlNodes.size > 0 || state.hlEdges.size > 0;
    const pairSeen = new Map();     // 同一对之间已画了几条边（决定曲率，见下面的 links）
    // 放大补偿：ECharts 的漫游缩放会把符号/字号/线宽一起放大（36× 时一个节点上千像素，屏幕上只剩一块碎片）
    // ⇒ 放大时按 1/zoom 缩回选项值，保证屏幕上的尺寸始终是"节点原始大小"
    const zc = (state.zoom || 1) > 1 ? 1 / state.zoom : 1;
    // 符号在**屏幕上**的目标直径：跟当前节点间距挂钩——
    // 适配视图里间距只有一两像素时，符号缩成小点（否则几百个 15–40px 的圆会糊成一团）
    const spacingScreen = (state.stepWorld || 40) * (state.fitLast || 1) * (state.zoom || 1);
    const symScale = state.view === 'force' ? 1 : Math.max(0.12, Math.min(1, spacingScreen / 40));
    const fxSym = (v) => Math.max(0.04, v * zc * symScale);   // 节点符号（跟着间距缩）
    const fxOk = (v) => Math.max(0.06, v * zc);                // 标签字号 / 线宽 / 图注圆点（只补偿缩放，屏幕尺寸恒定）

    const data = b.characters.filter((c) => !isCharHidden(c) && charVisibleAt(c) && passSizeFilter(c.id) && passFocus(c.id)).map((c) => {
      const dim = anyDim && !state.hlNodes.has(c.id);
      const locked = charLocked(c);
      const mentioned = isMentioned(c);
      const pos = state.pos.get(c.id);
      return {
        id: c.id, name: locked ? '🔒' : c.name, value: c.title,
        category: categoryOf(c),
        symbol: c.gender === 'f' ? 'roundRect' : 'circle',
        symbolSize: fxSym((mentioned ? 12 : symbolSize(c.id)) * (state.hlNodes.has(c.id) && anyDim ? 1.15 : 1)),
        x: pos ? pos.x : undefined, y: pos ? pos.y : undefined,
        itemStyle: mentioned
          ? { color: 'transparent', borderColor: '#8b94a7', borderWidth: 1.5, borderType: 'dashed', opacity: dim ? 0.2 : 0.85 }
          : {
              opacity: dim ? 0.16 : (locked ? 0.4 : 1),
              color: locked ? '#9aa3b0' : factionColorOf(c),
              borderColor: panel,
              borderWidth: 1,
            },
        label: {
          color: mentioned ? muted : (dim ? muted : ink),
          opacity: dim ? 0.35 : 1,
          textBorderColor: panel,
          textBorderWidth: 3,
          show: mentioned ? !anyDim || state.hlNodes.has(c.id) : (locked ? false : (state.allLabels || (state.labels ? state.labels.has(c.id) : nodeDegree(c.id) >= 4))),
        },
      };
    });

    // 代际视图：把「前史 / 第1代 …」做成图里的虚拟节点，跟随缩放与平移；
    // 位置固定在节点包围盒之外（横向在顶部 gutter、纵向在左侧 gutter）——聚焦模式下不画
    if (state.view !== 'force' && state.bands.size && !state.focus) {
      const isH = state.view === 'gen-h';
      let bb = state.bbox;
      if (!bb && state.pos.size) {   // 兜底：没有包围盒时，就用当前节点坐标现算一个
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of state.pos.values()) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        bb = { minX, maxX, minY, maxY };
      }
      if (!bb) {
        const r = document.getElementById('graph').getBoundingClientRect();
        bb = { minX: -((r.width || 900) / 2), minY: -((r.height || 600) / 2) };
      }
      for (const [g, band] of state.bands) {
        data.push({
          id: `__gen_${g}`,
          name: state.bandLabels.get(g) || String(g),
          symbol: 'circle',
          symbolSize: 3,
          x: isH ? band : bb.minX - 30,
          y: isH ? bb.minY - 26 : band,
          label: {
            show: true, color: muted, fontSize: fxOk(11.5), fontWeight: 'bold',
            position: isH ? 'top' : 'left', distance: 4,
          },
          itemStyle: { color: 'transparent' },
          labelLayout: { hideOverlap: false },
          emphasis: { disabled: true },
          tooltip: { show: false },
          silent: true,
        });
      }
    }

    const links = b.relations
      .filter((r) => state.byId.has(r.from) && state.byId.has(r.to) && !relLocked(r))
      .filter((r) => !isCharHidden(state.byId.get(r.from)) && !isCharHidden(state.byId.get(r.to)))
      .filter((r) => passSizeFilter(r.from) && passSizeFilter(r.to) && passFocus(r.from) && passFocus(r.to))
      .filter(relVisible)
      .filter(passEdgeFilter)
      .filter(relVisibleAt)
      .map((r) => {
        const hiddenTier = isMentioned(state.byId.get(r.from)) || isMentioned(state.byId.get(r.to));
        const derived = isDerived(r);
        const key = edgeKey(r.from, r.to);
      const dim = anyDim && !state.hlEdges.has(key);
      // 同一对之间的多条边（阶段关系：同盟→反目…）用不同曲率扇开，否则会叠成一条线
      const n = pairSeen.get(key) || 0;
      pairSeen.set(key, n + 1);
      const curve = (n === 0 ? 0.08 : (n % 2 === 1 ? -1 : 1) * (0.08 + 0.12 * Math.floor(n / 2)));
      return {
        source: r.from, target: r.to, value: r.type,
        lineStyle: {
          width: fxOk(state.hlEdges.has(key) && anyDim ? 3 : 1.2),
          opacity: dim ? 0.07 : (derived ? 0.32 : (hiddenTier ? 0.3 : 0.5)),
          type: hiddenTier || derived ? 'dashed' : (r.style === 'dashed' ? 'dashed' : r.style === 'dotted' ? 'dotted' : 'solid'),
          curveness: Math.min(0.5, curve),
        },
      };
    });

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item', confine: true,
        backgroundColor: panel, borderColor: line, borderWidth: 1,
        textStyle: { color: ink, fontSize: 12.5 },
        extraCssText: 'max-width:340px;white-space:normal;line-height:1.55;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12)',
        formatter: (p) => {
          if (p.dataType === 'edge') {
            const rel = findRel(p.data.source, p.data.target, p.data.value);
            if (!rel) return '';
            const [first, second] = orderPair(rel.from, rel.to);
            const vis = visibleRelEvents(rel);
            const hidden = (rel.events || []).length - vis.length;
            const evs = vis.map((e) => `· ${esc(e.text)}${e.chapter ? `<span style="color:${muted}">（${esc(e.chapter)}）</span>` : ''}`).join('<br>');
            return `<b>${esc(charName(first))} — ${esc(rel.type)} — ${esc(charName(second))}</b>${kinBadge(rel)}${isDerived(rel) ? ' <span class="badge">推导</span>' : ''}${periodText(rel) ? ` <span style="color:${muted}">（${periodText(rel)}）</span>` : ''}<br>${evs}` +
              (hidden ? `<br><span style="color:${muted}">🔒 还有 ${hidden} 条事件在你读到的进度之后</span>` : '');
          }
          const c = state.byId.get(p.data.id);
          if (!c) return '';
          if (charLocked(c)) {
            return `🔒 <b>剧透保护中</b><br><span style="color:${muted}">这个人物在第 ${charCh(c)} 章才出场；你现在读到第 ${state.progress} 章。读完再来看。</span>`;
          }
          return `<b>${esc(c.name)}</b>${c.aliases && c.aliases.length ? `（${esc(c.aliases.join('，'))}）` : ''}<br>` +
            `<span style="color:${muted}">${genPrefix(c)}${esc(c.title)}</span><br>${esc(c.desc)}<br>` +
            `<span style="color:${muted}">结局：${fateLocked(c) ? '🔒 在你读到的进度之后' : esc(c.fate)}</span>` +
            (isMentioned(c) ? `<br><span style="color:${muted}">（仅被提及 · 未出场；第 ${charCh(c)} 章）</span>` : '');
        },
      },
      series: [{
        type: 'graph',
        layout: (state.frozen && !state.focus) ? 'none' : 'force',
        roam: true, draggable: state.nodeDrag,
        // 视图（缩放/中心）只在"重建"时写进 option；标签刷新用 keepView 合并，避免把用户平移的视角弹回去
        ...(opts.keepView ? {} : { zoom: state.zoom || 1, center: state.viewCenter || undefined }),
        categories: b.factions.map((f) => ({ name: f.name, itemStyle: { color: f.color } })),
        force: { repulsion: 900, gravity: 0.04, edgeLength: [80, 190], layoutAnimation: true, friction: 0.6, initLayout: 'circular' },
        data, links,
        label: {
          show: true,
          position: state.view === 'force' ? 'right' : 'bottom',
          distance: 4, fontSize: fxOk(10.5 * fontScale()), color: ink, formatter: '{b}',
        },
        labelLayout: { hideOverlap: false },
        lineStyle: { color: 'source' },
        scaleLimit: { min: 0.02, max: 40 },   // 无限画布：从"看全貌"一路放大到"看清单个人"
        emphasis: {
          focus: 'adjacency',
          label: { show: true, fontWeight: 'bold' },
          lineStyle: { width: fxOk(3), opacity: 0.9 },
        },
        blur: {
          itemStyle: { opacity: 0.15 },
          label: { opacity: 0.25 },
          lineStyle: { opacity: 0.08 },
        },
        selectedMode: 'single',
      }],
    };
  }

  /** 防重叠松弛：网格邻域 + 数组局部运算（不再每对都查 Map / 重算节点尺寸） */
  function relaxPositions(iterations = 140) {
    if (state.pos.size < 2) return;
    const nodes = [];
    for (const [id, p] of state.pos) nodes.push({ id, x: p.x, y: p.y, size: symbolSize(id) });
    const pad = 12;
    const cell = 60;                       // 网格边长（> 最大节点直径 + pad，保证 3×3 邻域够用）
    for (let it = 0; it < iterations; it++) {
      const grid = new Map();
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const key = `${Math.floor(n.x / cell)}:${Math.floor(n.y / cell)}`;
        let arr = grid.get(key);
        if (!arr) { arr = []; grid.set(key, arr); }
        arr.push(i);
      }
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const arr = grid.get(`${gx + ox}:${gy + oy}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue;                     // 每对只处理一次
            const b = nodes[j];
            let dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const min = (a.size + b.size) / 2 + pad;
            if (d < min) {
              const k = (min - d) / d / 2;
              dx *= k; dy *= k;
              a.x -= dx; a.y -= dy;
              b.x += dx; b.y += dy;
            }
          }
        }
      }
    }
    for (const n of nodes) state.pos.set(n.id, { x: n.x, y: n.y });
  }

  function fitPositions() {
    if (!state.pos.size || !state.chart) return;
    const rect = document.getElementById('graph').getBoundingClientRect();
    const W = rect.width || 800, H = rect.height || 500;
    // 边距＝图注专用通道（gutter）：横向留顶部、纵向留左侧
    const padX = state.view === 'gen-v' ? 150 : 90;
    const padY = state.view === 'gen-h' ? 110 : 70;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of state.pos.values()) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    // 无限画布：允许缩到很小（先看全貌），也允许放得很大（看清单个人）
    const s = Math.max(0.02, Math.min((W - 2 * padX) / w, (H - 2 * padY) / h, 1.4));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    state.fitLast = s;                       // 最近一次的缩放（"看清 1:1" 按钮要用它换算）
    const prev = state.fit || { s: 1, cx: 0, cy: 0 };
    state.fit = {
      s: prev.s * s,
      cx: prev.cx + cx / (prev.s || 1),
      cy: prev.cy + cy / (prev.s || 1),
    };
    for (const [id, p] of state.pos) state.pos.set(id, { x: (p.x - cx) * s, y: (p.y - cy) * s });
    // 节点包围盒（已缩放、居中于 0）——图注按它定位，保证在节点区之外
    state.bbox = { minX: -(w * s) / 2, maxX: (w * s) / 2, minY: -(h * s) / 2, maxY: (h * s) / 2 };
    // 代际参考线同步缩放，保证「前史 / 第 N 代」始终对着对应那一列/行
    if (state.view === 'gen-h') {
      for (const [g, v] of state.bands) state.bands.set(g, (v - cx) * s);
    } else if (state.view === 'gen-v') {
      for (const [g, v] of state.bands) state.bands.set(g, (v - cy) * s);
    }
  }

  function computeLabels(zoom = state.zoom || 1) {
    if (state.allLabels || !state.pos.size) { state.labels = null; return; }
    // 屏幕上的实际符号直径（含放大补偿 + 间距缩放，和 buildOption 里一致）
    const zc = zoom > 1 ? 1 / zoom : 1;
    const spacingScreen = (state.stepWorld || 40) * (state.fitLast || 1) * zoom;
    const symScale = state.view === 'force' ? 1 : Math.max(0.12, Math.min(1, spacingScreen / 40));
    const eff = (id) => symbolSize(id) * zoom * zc * symScale;
    // 间距还不够大时，只给关系最多的前 40 人标名字（免得一屏几百个名字糊在一起）
    const zoomedIn = spacingScreen >= 18;
    const rank = degreeRanking();
    const MAX_LABELS = 400;
    const cands = state.book.characters
      .filter((c) => state.pos.has(c.id) && passSizeFilter(c.id) && passFocus(c.id))
      .filter((c) => (isMentioned(c)
        ? state.hlNodes.has(c.id)
        : (zoomedIn ? eff(c.id) >= 6 : (rank.get(c.id) || 9999) <= 40)))
      .map((c) => {
        const chip = Math.min(Math.max(eff(c.id), 6), 64);
        const w = c.name.length * 11.5 * fontScale() + chip + 6, h = Math.max(chip, 18);
        const p = state.pos.get(c.id);
        const sx = p.x * zoom + chip / 2;
        return { id: c.id, deg: nodeDegree(c.id), bx: sx - w / 2, by: p.y * zoom - h / 2, w, h };
      })
      .sort((a, b) => b.deg - a.deg);
    const placed = [];
    const keep = new Set();
    for (const n of cands) {
      if (keep.size >= MAX_LABELS) break;
      const hit = placed.some((o) => !(n.bx > o.bx + o.w || n.bx + n.w < o.bx || n.by > o.by + o.h || n.by + n.h < o.by));
      if (!hit) { placed.push(n); keep.add(n.id); }
    }
    state.labels = keep;
  }

  /** 时间旅行会让"当时还没出现"的节点重新出现；力导向视图里它们没有坐标 ⇒ 用邻居重心补一个 */
  function fillMissingPositions() {
    if (!state.pos.size || !state.book) return;
    const missing = [...state.byId.keys()].filter((id) => !state.pos.has(id));
    if (!missing.length) return;
    let cx = 0, cy = 0, n = 0;
    for (const p of state.pos.values()) { cx += p.x; cy += p.y; n++; }
    cx /= (n || 1); cy /= (n || 1);
    for (const id of missing) {
      const nb = (state.adj.get(id) || []).map((e) => state.pos.get(e.to)).filter(Boolean);
      state.pos.set(id, nb.length
        ? { x: nb.reduce((s, p) => s + p.x, 0) / nb.length, y: nb.reduce((s, p) => s + p.y, 0) / nb.length }
        : { x: cx, y: cy });
    }
  }

  function freezeNow() {
    if (state.frozen || !state.chart) return;
    const d = state.chart.getModel().getSeriesByIndex(0).getData();
    for (let i = 0; i < d.count(); i++) {
      const id = d.getId(i);
      const layout = d.getItemLayout(i);
      if (id && layout) state.pos.set(id, { x: layout[0] ?? layout.x, y: layout[1] ?? layout.y });
    }
    state.frozen = true;
    fillMissingPositions();
    relaxPositions();
    fitPositions();
    computeLabels();
    state.chart.setOption(buildOption({ keepView: true }));
  }

  function applyViewHeight() {
    const el = document.getElementById('graph');
    if (!el || !state.book) return;
    // 现在布局是世界坐标 + 自动适配缩放，容器只要给一个舒服的高度就够了：
    // 千万不能再按人数把容器撑到上万像素（那样画布中心会被推到屏幕外，看起来就是"点了没反应"）
    // 手机上再矮一点：一屏里能同时看到工具栏和图
    if (window.innerWidth <= 700) {
      el.style.height = Math.max(300, Math.round(window.innerHeight * 0.46)) + 'px';
      return;
    }
    const counts = new Map();
    for (const c of state.book.characters) counts.set(groupKeyOf(c), (counts.get(groupKeyOf(c)) || 0) + 1);
    const groupCount = counts.size || 1;
    const base = state.view === 'gen-v' ? (groupCount <= 6 ? 640 : 720) : 700;
    el.style.height = base + 'px';
  }

  function buildGenerationPositions(view) {
    const rect = document.getElementById('graph').getBoundingClientRect();
    const W = rect.width || 900, H = rect.height || 600;
    const factionOrder = new Map(state.book.factions.map((f, i) => [f.key, i]));
    const groups = [...new Set(state.book.characters.map(groupKeyOf))];
    groups.sort((a, b) => {
      if (state.groupMode === 'generation') return Number(a.slice(1)) - Number(b.slice(1));
      return (factionOrder.get(a.slice(1)) ?? 99) - (factionOrder.get(b.slice(1)) ?? 99);
    });
    const byGen = new Map(groups.map((g) => [g, []]));
    for (const c of state.book.characters) byGen.get(groupKeyOf(c)).push(c);
    for (const list of byGen.values()) {
      list.sort((a, b) => (
        (state.groupMode === 'generation'
          ? (factionOrder.get(a.faction) ?? 99) - (factionOrder.get(b.faction) ?? 99)
          : a.generation - b.generation)
        || (nodeDegree(b.id) - nodeDegree(a.id))
        || a.name.localeCompare(b.name)));
    }
    state.pos = new Map();
    state.bands = new Map();
    state.bandLabels = new Map();
    const mainPad = 110, crossPad = 78;
    // 世界坐标不跟着视口走：一行（组）里有多少人，就铺多长——放大后自然不重叠（无限画布）
    const maxCount = Math.max(1, ...groups.map((g) => byGen.get(g).length));
    const maxSymbol = Math.min(40, 15 + Math.max(...[...state.byId.keys()].map(nodeDegree)) * 2.2);
    const stepCross = Math.max(34, maxSymbol + 10);
    const stepMain = Math.max(200, 240);
    const viewMain = (view === 'gen-h' ? W : H) - mainPad * 2;
    const viewCross = (view === 'gen-h' ? H : W) - crossPad * 2;
    const mainLen = Math.max(viewMain, (groups.length - 1) * stepMain);
    const crossLen = Math.max(viewCross, (maxCount - 1) * stepCross);
    state.stepWorld = stepCross;      // 相邻节点的世界间距（buildOption 用它决定符号该画多大）
    groups.forEach((g, gi) => {
      const center = groups.length === 1 ? 0 : -mainLen / 2 + (mainLen * gi) / (groups.length - 1);
      state.bands.set(g, center);
      const sample = byGen.get(g)[0];
      state.bandLabels.set(g, sample ? groupLabelOf(sample) : String(g));
      const list = byGen.get(g);
      const step = list.length > 1 ? crossLen / (list.length - 1) : 0;
      list.forEach((c, ci) => {
        const off = list.length === 1 ? 0 : -crossLen / 2 + ci * step;
        state.pos.set(c.id, view === 'gen-h' ? { x: center, y: off } : { x: off, y: center });
      });
    });
  }

  function syncViewButtons() {
    const isGen = state.groupMode === 'generation';
    const bh = document.querySelector('.seg[data-view="gen-h"]');
    const bv = document.querySelector('.seg[data-view="gen-v"]');
    if (bh) { bh.textContent = isGen ? '代际·横' : '分组·横'; bh.title = isGen ? '按代际分列，从左到右' : '按阵营分组分列，从左到右'; }
    if (bv) { bv.textContent = isGen ? '代际·纵' : '分组·纵'; bv.title = isGen ? '按代际分行，从上到下' : '按阵营分组分行，从上到下'; }
    document.querySelectorAll('.seg').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === state.view));
  }

  function setView(view) {
    state.view = view;
    state.zoom = 1;
    try { localStorage.setItem('ba-view', view); } catch (e) { /* 隐私模式忽略 */ }
    syncViewButtons();
    applyViewHeight();
    updateCountHint();
    if (!state.chart) return;
    clearTimeout(state.freezeTimer);
    if (view === 'force') {
      state.frozen = false;
      // 人特别多时，保留当前布局坐标当力导向的起点（否则从圆形随机起步，几百个节点要算很久）
      const many = state.byId.size > 400;
      if (!many) state.pos = new Map();
      state.bands = new Map();
      state.fit = { s: 1, cx: 0, cy: 0 };
      state.labels = null;
      state.zoom = 1;
      state.chart.clear();
      state.chart.setOption(buildOption(), { notMerge: true });
      state.freezeTimer = setTimeout(() => freezeNow(), many ? 12000 : 6000);
    } else {
      state.frozen = true;
      buildGenerationPositions(view);
      relaxPositions(60);
      fitPositions();
      computeLabels();
      state.chart.clear();
      state.chart.setOption(buildOption(), { notMerge: true });
    }
  }

  function resetRoam() {
    if (!state.chart) return;
    // clear + setOption 会把缩放/平移复位，但保留当前布局坐标
    state.zoom = 1;
    state.viewCenter = [0, 0];
    computeLabels(1);
    state.chart.clear();
    state.chart.setOption(buildOption(), { notMerge: true });
  }

  /** 缩放到指定倍率（1:1 = 节点原始大小），可指定视角中心 */
  function applyZoom(zoom, center) {
    if (!state.chart) return;
    state.zoom = Math.max(0.02, Math.min(40, zoom || 1));
    state.viewCenter = center || [0, 0];
    computeLabels(state.zoom);
    state.chart.clear();
    state.chart.setOption(buildOption(), { notMerge: true });   // 全量重建：zoom/center 与标签一起生效
  }

  /* ---------------- 聚焦 / 人数过滤（无限画布的两个"放大镜"） ---------------- */
  function updateCountHint() {
    const el = document.getElementById('count-hint');
    if (!el || !state.book) return;
    const total = state.book.characters.length;
    const shown = state.book.characters.filter((c) => !isCharHidden(c) && charVisibleAt(c) && passSizeFilter(c.id) && passFocus(c.id)).length;
    let text = shown >= total ? `${total} 人` : `显示 ${shown} / ${total} 人`;
    // 关系数也报一下：过滤/剧透/折叠挡住多少条，一眼能看出来
    const rels = state.book.relations;
    const shownRels = rels.filter((r) =>
      state.byId.has(r.from) && state.byId.has(r.to) && !relLocked(r) && relVisible(r) && passEdgeFilter(r) && relVisibleAt(r)
      && !isCharHidden(state.byId.get(r.from)) && !isCharHidden(state.byId.get(r.to))
      && passSizeFilter(r.from) && passSizeFilter(r.to) && passFocus(r.from) && passFocus(r.to)).length;
    if (shownRels < rels.length) text += ` · 关系 ${shownRels} / ${rels.length}`;
    const n = asOf();
    el.textContent = (n !== null ? `🕰 第 ${n} 章 · ` : '') + text;
    updateAria();
  }
  function renderFocusBar() {
    const bar = document.getElementById('focus-bar');
    if (!bar) return;
    if (!state.focus) { bar.hidden = true; return; }    const c = state.byId.get(state.focus.id) || { name: state.focus.id };
    const n = (focusSet() || new Set()).size;
    bar.hidden = false;
    bar.innerHTML = `🎯 聚焦「${esc(c.name)}」· ${state.focus.depth} 跳以内 · ${n} 人
      <button class="ghost tiny" type="button" data-focus-nav="dec">− 跳</button>
      <button class="ghost tiny" type="button" data-focus-nav="inc">＋ 跳</button>
      <button class="ghost tiny" type="button" data-focus-exit="1">看全部</button>`;
  }

  /** 供"使用说明"演示：把某个人挪开一点（等价于你拖动他） */
  function nudgeNode(id, dx = 70, dy = -46) {
    const p = state.pos.get(id);
    if (!p) return false;
    state.frozen = true;
    state.pos.set(id, { x: p.x + dx, y: p.y + dy });
    computeLabels(state.zoom);
    if (state.chart) state.chart.setOption(buildOption({ keepView: true }));
    return true;
  }

  function applyFocus(id, depth) {
    state.focus = id ? { id, depth: Math.max(1, Math.min(3, depth || 1)) } : null;
    state.focusCache = null;
    clearHighlight(false);
    // 手动摆过位置的：聚焦也只换数据、不动坐标（否则一聚焦就把摆好的布局冲掉）
    state.frozen = false;
    state.fit = { s: 1, cx: 0, cy: 0 };
    if (state.chart) {
      clearTimeout(state.freezeTimer);
      state.chart.clear();
      state.chart.setOption(buildOption(), { notMerge: true });
      state.zoom = 1;
      if (state.focus) state.freezeTimer = setTimeout(() => freezeNow(), 2500);
    }
    renderFocusBar();
    updateCountHint();
    if (state.focus) {
      const c = state.byId.get(state.focus.id);
      if (c) renderCharacterPanel(c);
    }
  }

  function applySizeFilter(v) {
    state.sizeFilter = v || 'all';
    try { localStorage.setItem('ba-size-filter', state.sizeFilter); } catch (e) { /* 忽略 */ }
    const sel = document.getElementById('size-filter');
    if (sel && sel.value !== state.sizeFilter) sel.value = state.sizeFilter;
    if (state.chart) {
      if (state.frozen && !state.focus) {
        buildGenerationPositions(state.view);
        relaxPositions(80);
        fitPositions();
        computeLabels(state.zoom);
      }
      state.chart.clear();
      state.chart.setOption(buildOption(), { notMerge: true });
    }
    updateCountHint();
  }

  function initChart() {
    const el = $('#graph');
    if (state.chart) { state.chart.dispose(); }
    clearTimeout(state.freezeTimer);
    state.chart = echarts.init(el, null, { renderer: 'canvas' });
    state.frozen = false;
    state.pos = new Map();
    state.bands = new Map();
    state.fit = { s: 1, cx: 0, cy: 0 };
    // ⚠️ 事件绑定必须在任何 return 之前（之前手动模式提前 return，导致拖动/点击处理器根本没注册）
    state.chart.on('click', (p) => {
      if (p.dataType === 'node' && String(p.data.id || '').startsWith('__gen_')) return;
      if (p.dataType === 'edge') {
        const rel = findRel(p.data.source, p.data.target, p.data.value);
        if (rel) selectRelation(rel);
      } else if (p.dataType === 'node') {
        selectCharacter(p.data.id);
      }
    });
    state.chart.getZr().on('click', (e) => { if (!e.target) clearHighlight(); });
    // 双击空白处＝复位视图（缩放/平移乱掉时最快恢复）
    state.chart.getZr().on('dblclick', (e) => { if (!e.target) resetRoam(); });
    // 缩放联动标签：放大后露出更多名字（节流 200ms）
    state.chart.on('graphroam', (p) => {
      if (typeof p.zoom === 'number' && p.zoom > 0) state.zoom = p.zoom;
      clearTimeout(state.labelTimer);
      state.labelTimer = setTimeout(() => {
        if (state.allLabels || !state.chart) return;
        const before = state.labels ? state.labels.size : -1;
        computeLabels(state.zoom);
        if (state.labels && state.labels.size !== before) state.chart.setOption(buildOption({ keepView: true }));
      }, 200);
    });

    const onResize = () => {
      if (!state.chart) return;
      applyViewHeight();
      state.chart.resize();
      if (state.frozen) {
        if (state.view === 'force') {
          fitPositions();
        } else {
          buildGenerationPositions(state.view);
          fitPositions();          // 关键：重建位置后必须重算包围盒，图注才不会压到节点
        }
        computeLabels();
        resetRoam();
      }
    };
    new ResizeObserver(onResize).observe(el);
    window.addEventListener('resize', onResize);

    setView(state.view);   // 按当前视图初始化（默认＝代际·纵，可在布局里切换，选择会被记住）
  }

  /** 找关系：同一对人可能有多条（阶段关系）——优先按"边上写的类型 + 当前时间可见"匹配 */
  function findRel(a, b, type) {
    const cands = state.book.relations.filter((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
    if (!cands.length) return null;
    if (type !== undefined && type !== null) {
      const hit = cands.find((r) => r.type === type && !relLocked(r) && relVisibleAt(r));
      if (hit) return hit;
    }
    return cands.find((r) => !relLocked(r) && relVisibleAt(r)) || cands[0];
  }

  /* ---------------- 键盘与读屏（canvas 图对键盘/读屏天生不友好，这里补语义层） ---------------- */
  function announce(msg) {
    const el = document.getElementById('sr-live');
    if (!el) return;
    el.textContent = '';
    setTimeout(() => { el.textContent = msg; }, 40);   // 先清空，重复内容也会被念
  }
  function graphAriaLabel() {
    if (!state.book) return '人物关系网络图（加载中）';
    const shown = state.book.characters.filter((c) => !isCharHidden(c) && charVisibleAt(c) && passSizeFilter(c.id) && passFocus(c.id)).length;
    const cur = state.kbCursor ? state.byId.get(state.kbCursor) : null;
    const n = asOf();
    return `《${titleOf()}》人物关系图：显示 ${shown} / ${state.book.characters.length} 人`
      + (n !== null ? `，时间旅行在第 ${n} 章` : '')
      + (state.progress !== null ? `，剧透保护读到第 ${state.progress} 章` : '')
      + (cur ? `；当前选中 ${cur.name}（关系 ${(state.adj.get(cur.id) || []).length} 条，第 ${charCh(cur)} 章出场）` : '')
      + '。Tab 聚焦后可用方向键在人物间移动，回车查看档案。';
  }
  function updateAria() {
    const el = document.getElementById('graph');
    if (el) el.setAttribute('aria-label', graphAriaLabel());
  }
  function focusNode(id) {
    state.kbCursor = id;
    const p = state.pos.get(id);
    if (p && state.chart) {
      state.viewCenter = [p.x, p.y];               // 键盘走到哪儿，视图跟到哪儿
      computeLabels(state.zoom);
      state.chart.clear();
      state.chart.setOption(buildOption(), { notMerge: true });
    }
    selectCharacter(id);                           // 面板 + 高亮（读屏读的是面板里的文字）
    updateAria();
    const c = state.byId.get(id);
    if (c) announce(`${c.name}，关系 ${(state.adj.get(id) || []).length} 条，第 ${charCh(c)} 章出场${c.title ? `，${c.title}` : ''}`);
  }
  /** 方向键在人物之间移动：选"最正对该方向、最近"的那个 */
  function moveCursor(key) {
    const pos = state.pos;
    if (!pos.size || !state.book) return;
    const ok = (id) => {
      const c = state.byId.get(id);
      return !!c && pos.has(id) && !charLocked(c) && charVisibleAt(c) && !isCharHidden(c) && passSizeFilter(id) && passFocus(id);
    };
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
    if (!dir) return;
    const cands = [...state.byId.keys()].filter(ok);
    if (!cands.length) return;
    const curId = state.kbCursor && ok(state.kbCursor) ? state.kbCursor : null;
    if (!curId) {
      const first = (state.hubId && ok(state.hubId)) ? state.hubId : cands.slice().sort((a, b) => nodeDegree(b) - nodeDegree(a))[0];
      focusNode(first);
      return;
    }
    const cur = pos.get(curId);
    let best = null;
    for (const id of cands) {
      if (id === curId) continue;
      const p = pos.get(id);
      const dx = p.x - cur.x, dy = p.y - cur.y;
      const proj = dx * dir[0] + dy * dir[1];
      if (proj <= 1) continue;
      const perp = Math.abs(dx * dir[1] - dy * dir[0]);
      const score = proj + perp * 2.5;
      if (!best || score < best.score) best = { id, score };
    }
    if (best) focusNode(best.id);
  }

  /* ---------------- 高亮 ---------------- */
  function setHighlight(nodes, edges, activeCharId, eventId) {
    state.hlNodes = nodes || new Set();
    state.hlEdges = edges || new Set();
    state.activeChar = activeCharId || null;
    state.activeEvent = eventId || null;
    if (state.activeChar) state.activeFaction = null;
    document.querySelectorAll('.legend-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.faction === state.activeFaction);
      el.classList.toggle('dim', !!state.activeFaction && el.dataset.faction !== state.activeFaction);
    });
    document.querySelectorAll('.event-chip').forEach((el) => el.classList.toggle('active', el.dataset.event === state.activeEvent));
    freezeNow();
    if (state.chart) state.chart.setOption(buildOption({ keepView: true }));
  }

  function clearHighlight(updateVisual = true) {
    state.hlNodes = new Set();
    state.hlEdges = new Set();
    state.activeChar = null;
    state.activeEvent = null;
    state.activeFaction = null;
    document.querySelectorAll('.legend-item').forEach((el) => el.classList.remove('active', 'dim'));
    document.querySelectorAll('.event-chip').forEach((el) => el.classList.remove('active'));
    if (updateVisual && state.chart) state.chart.setOption(buildOption({ keepView: true }));
  }

  function renderLockedPanel(kind, item) {
    const ch = kind === 'character' ? charCh(item) : (item.ch || 0);
    panel().innerHTML = `
      <div class="card-title">🔒 剧透保护中</div>
      <p class="card-desc">这一部分对应第 ${ch} 章；你现在读到第 ${state.progress} 章，所以先锁起来。</p>
      <p class="hint">读完再回来，或者到右上角「剧透保护」里改进度。</p>
      <p style="margin-top:10px"><button class="primary" type="button" id="panel-open-spoiler">调整进度</button></p>`;
    const btn = document.getElementById('panel-open-spoiler');
    if (btn) btn.addEventListener('click', () => openSpoilerModal());
  }

  function selectCharacter(id) {
    const c = state.byId.get(id);
    if (!c) return;
    if (charLocked(c)) { renderLockedPanel('character', c); return; }
    // 地点筛选开启时：只在该地点范围内展开关系；点到范围外的人则自动取消筛选
    if (state.placeFilter) {
      const scope = placeNodeScope() || new Set();
      if (!scope.has(id)) {
        applyPlaceFilter(null);
      } else {
        const nodes = new Set([id]);
        const edges = new Set();
        for (const r of state.book.relations) {
          if (!placeRelSet(r)) continue;
          const other = r.from === id ? r.to : (r.to === id ? r.from : null);
          if (!other || !scope.has(other)) continue;
          nodes.add(other);
          edges.add(edgeKey(id, other));
        }
        setHighlight(nodes, edges, id, null);
        renderCharacterPanel(c);
        return;
      }
    }
    const nodes = new Set([id]);
    const edges = new Set();
    for (const e of state.adj.get(id)) {
      if (!relVisible(e.rel) || !passEdgeFilter(e.rel) || !relVisibleAt(e.rel)) continue;
      nodes.add(e.to); edges.add(edgeKey(id, e.to));
    }
    state.panelKind = 'char';
    state.panelId = id;
    state.activeRel = null;
    setHighlight(nodes, edges, id, null);
    renderCharacterPanel(c);
  }

  function selectRelation(rel) {
    const nodes = new Set([rel.from, rel.to]);
    const edges = new Set([edgeKey(rel.from, rel.to)]);
    state.panelKind = 'rel';
    state.activeRel = rel;
    setHighlight(nodes, edges, null, null);
    renderRelationPanel(rel);
  }

  // 折叠/过滤开关变了以后，右侧面板要跟着重画（否则内容还是旧的）
  function refreshPanel() {
    if (state.panelKind === 'rel' && state.activeRel) { renderRelationPanel(state.activeRel); return; }
    if (state.panelKind === 'char' && state.panelId) { const c = state.byId.get(state.panelId); if (c) renderCharacterPanel(c); }
  }

  function selectEvent(id) {
    const ev = state.book.events.find((e) => e.id === id);
    if (!ev) return;
    if (eventLocked(ev)) { renderLockedPanel('event', ev); return; }
    const nodes = new Set(ev.chars || []);
    const edges = new Set();
    for (const r of state.book.relations) if (nodes.has(r.from) && nodes.has(r.to)) edges.add(edgeKey(r.from, r.to));
    setHighlight(nodes, edges, null, id);
    renderEventPanel(ev);
  }

  /* ---------------- 面板 ---------------- */
  const panel = () => $('#panel');

  function renderPanelWelcome() {
    panel().innerHTML = `
      <p class="hint">点节点看人物档案 · 点连线看关系与「定义关系的小事件」<br>
      空白处拖动＝平移画布，滚轮＝缩放，<b>双击空白＝复位视图</b>；要拖单个节点请打开上方「拖动节点」。<br>
      <b>键盘</b>：Tab 聚焦到图上后，<b>方向键</b>在人物之间移动、<b>回车</b>看档案、<b>Esc</b> 取消选中（读屏会念出当前位置）。<br>
      底部「两人关系」会算出最短关系链，并列出每一跳的依据事件。</p>`;
  }

  function charLink(id) { return `<button class="linkbtn" data-goto="${esc(id)}">${esc(charName(id))}</button>`; }
  function bindGoto(root) {
    root.querySelectorAll('[data-goto]').forEach((el) => el.addEventListener('click', () => selectCharacter(el.dataset.goto)));
    root.querySelectorAll('[data-event]').forEach((el) => el.addEventListener('click', () => selectEvent(el.dataset.event)));
    root.querySelectorAll('[data-place-filter]').forEach((el) => el.addEventListener('click', () => applyPlaceFilter(el.dataset.placeFilter || null)));
    root.querySelectorAll('[data-focus-rel]').forEach((el) => el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const [a, b] = String(el.dataset.focusRel).split('|');
      const rel = findRel(a, b);
      if (rel) selectRelation(rel);
    }));
  }

  /* ---------------- 地点筛选 ---------------- */
  function renderPlaceSelect() {
    const sel = document.getElementById('place-filter');
    if (!sel) return;
    const places = [...(state.book.places || [])].sort((a, b) => (a.firstCh ?? 0) - (b.firstCh ?? 0));
    sel.innerHTML = '<option value="">📍 全部地点</option>' + places
      .filter((p) => (state.progress === null || (p.firstCh ?? 0) <= state.progress) && !beforeAsOf(p.firstCh ?? 0))
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    if (state.placeFilter && ![...sel.options].some((o) => o.value === state.placeFilter)) state.placeFilter = null;
    sel.value = state.placeFilter || '';
  }

  function renderPlacePanel(id, evs) {
    const p = placeOf(id);
    if (!p) return;
    panel().innerHTML = `
      <div class="card-title">📍 ${esc(p.name)}</div>
      <div class="card-sub">${esc(p.type || '地点')} · 首次出现：第 ${p.firstCh ?? '?'} 章</div>
      <p class="card-desc">${esc(p.desc || '')}</p>
      <h3 style="margin-top:12px;font-size:14px">在这里发生的事（${evs.length}）</h3>
      ${evs.length ? foldSection({ key: `place:${id}`, n: 10, unit: '条', cls: 'rel-list', items: evs.map((e) => `<li class="rel">
        <div class="rel-head">${esc(e.name)} <span class="type">第 ${e.ch ?? '?'} 章</span></div>
        <div class="rel-event">· ${esc(e.summary)}</div>
      </li>`) }) : '<ul class="rel-list"><li class="hint">暂无（或都在你读到的进度之后）</li></ul>'}
      <p style="margin-top:10px"><button class="ghost tiny" type="button" data-place-filter="">显示全部地点</button></p>`;
    bindGoto(panel());
  }

  function applyPlaceFilter(id) {
    state.placeFilter = id || null;
    const sel = document.getElementById('place-filter');
    if (sel) sel.value = state.placeFilter || '';
    renderTimeline();
    if (!state.placeFilter) { clearHighlight(); return; }
    const nodes = placeNodeScope() || new Set();
    const edges = new Set();
    for (const r of state.book.relations) {
      if (!placeRelSet(r)) continue;
      if (nodes.has(r.from) && nodes.has(r.to)) edges.add(edgeKey(r.from, r.to));
    }
    setHighlight(nodes, edges, null, null);
    renderPlacePanel(state.placeFilter, state.book.events.filter((e) => e.place === state.placeFilter && !eventLocked(e)));
  }

  function renderCharacterPanel(c) {
    const faction = state.book.factions.find((f) => f.key === effectiveFactionKey(c));
    const factionHist = Array.isArray(c.factionHistory) ? c.factionHistory : [];
    const lordHist = Array.isArray(c.lordHistory) ? c.lordHistory : [];
    const allRels = state.book.relations.filter((r) => (r.from === c.id || r.to === c.id) && relVisible(r));
    const unlocked = allRels.filter((r) => !relLocked(r) && relVisibleAt(r));
    const rels = unlocked.filter(passEdgeFilter).sort((a, b) => (a.type > b.type ? 1 : -1));
    const lockedCount = allRels.length - unlocked.length;
    const filteredCount = unlocked.length - rels.length;
    // 「他的一生」：按章排的事件（含地点与引文），吃剧透保护
    const lifeEvs = state.book.events.filter((e) => (e.chars || []).includes(c.id)).sort((a, b) => (a.ch || 0) - (b.ch || 0));
    const lifeShown = lifeEvs.filter((e) => !eventLocked(e));
    const lifeItems = lifeShown.map((e) => `
        <li><button class="linkbtn" type="button" data-event="${esc(e.id)}"><span class="ch">第 ${e.ch ?? '?'} 章</span>${esc(e.name)}</button>
          <div class="rel-event">· ${esc(e.summary)}${e.place ? ` <button class="linkbtn" type="button" data-place-filter="${esc(e.place)}">📍${esc(placeName(e.place))}</button>` : ''}</div>
          ${e.quote ? `<div class="quote">「${esc(e.quote)}」</div>` : ''}
        </li>`);
    const lifeHtml = lifeEvs.length ? `
      <h3 style="margin-top:12px;font-size:14px">他的一生（按章，${lifeShown.length}/${lifeEvs.length}）</h3>
      ${foldSection({ key: `life:${c.id}`, n: 8, unit: '个', cls: 'life-list', items: lifeItems })}
      ${lifeEvs.length > lifeShown.length ? `<p class="hint">🔒 还有 ${lifeEvs.length - lifeShown.length} 个事件在你读到的进度之后</p>` : ''}` : '';
    const relItems = rels.map((r) => {
      const other = r.from === c.id ? r.to : r.from;
      const vis = visibleRelEvents(r);
      const hidden = (r.events || []).length - vis.length;
      const evs = vis.map((e) =>
        `<div class="rel-event">· ${e.place ? `<span class="chapter">📍${esc(placeName(e.place))}</span> ` : ''}${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
      return `<li class="rel">
        <div class="rel-head">${charLink(other)} <span class="type">— ${esc(r.type)} —</span>${kinBadge(r)}${isDerived(r) ? ' <span class="badge">推导</span>' : ''}${periodText(r) ? ` <span class="badge">${esc(periodText(r))}</span>` : ''}
          <button class="ghost tiny" type="button" data-focus-rel="${esc(r.from)}|${esc(r.to)}" title="在图上只高亮这一条关系">定位这条线</button>
        </div>
        ${evs}${hidden ? `<div class="rel-event">🔒 还有 ${hidden} 条事件在你读到的进度之后</div>` : ''}
      </li>`;
    });

    panel().innerHTML = `
      <div class="card-title">${esc(c.name)}</div>
      <div class="card-sub">${genPrefix(c)}${esc(c.title)}</div>
      ${c.note ? `<div class="note">⚠️ ${esc(c.note)}</div>` : ''}
      <div class="badges">
        ${faction ? `<span class="badge faction" style="background:${esc(faction.color)}">${esc(faction.name)}</span>` : ''}
        <span class="badge">${c.gender === 'f' ? '♀ 女' : '♂ 男'}</span>
        ${isMentioned(c) ? '<span class="badge">仅被提及</span>' : ''}
        ${(c.aliases || []).map((a) => `<span class="badge">别名：${esc(a)}</span>`).join('')}
        <span class="badge">关系 ${allRels.length} 条</span>
      </div>
      <p class="card-desc">${esc(c.desc)}</p>
      ${factionHist.length > 1 ? `<p class="card-sub">阵营变化：${factionHist.map((s) => `${esc((state.book.factions.find((f) => f.key === s.faction) || {}).name || s.faction)}（第 ${s.fromCh} 回起${s.label ? '，' + esc(s.label) : ''}）`).join(' → ')}${state.progress === null ? '' : `　<span class="hint">（按你读到的第 ${state.progress} 回显示：现在是「${esc(factionTextOf(c))}」）</span>`}</p>` : ''}
      <p class="card-fate"><b>结局：</b>${fateLocked(c) ? '🔒 在你读到的进度之后（读完再来看）' : esc(c.fate)}</p>
      <p class="hint" style="margin-top:8px">人太多看不清？只看这个人的关系网：
        <button class="ghost tiny" type="button" data-focus-node="${esc(c.id)}" data-focus-depth="1">🎯 1 跳</button>
        <button class="ghost tiny" type="button" data-focus-node="${esc(c.id)}" data-focus-depth="2">🎯 2 跳</button>
        <button class="ghost tiny" type="button" data-char-card="${esc(c.id)}" title="导出这个人的 PNG 卡片：身份、结局、关键关系与依据事件">🖼 人物卡</button>
        ${state.focus ? '<button class="ghost tiny" type="button" data-focus-exit="1">退出聚焦</button>' : ''}
      </p>
      ${lifeHtml}
      <h3 style="margin-top:12px;font-size:14px">与谁有关 · 凭什么事件</h3>
      ${state.placeFilter ? `<p class="hint">📍 正在按地点「${esc(placeName(state.placeFilter))}」筛选：图上只高亮该范围内的人与关系。
        <button class="ghost tiny" type="button" data-place-filter="">看全部</button></p>` : ''}
      ${lordHist.length ? `<p class="card-sub">效力变化（旧主 → 新主）：${lordHist.map((s) => {
        const lordName = s.lord && state.byId.has(s.lord) ? esc((state.byId.get(s.lord) || {}).name) : '自立';
        const link = s.lord && state.byId.has(s.lord) ? charLink(s.lord) : `<b>自立</b>`;
        return `${link}<span class="hint">（第 ${s.fromCh} 回）</span>`;
      }).join(' → ')}${state.progress === null ? '' : `　<span class="hint">（按你读到的第 ${state.progress} 回）</span>`}
        <span class="hint">${lordHist.map((s) => `${s.fromCh}：${esc(s.label || '')}`).join('；')}</span></p>` : ''}
      ${lockedCount ? `<p class="hint">🔒 还有 ${lockedCount} 条关系在你读到的进度之后</p>` : ''}
      ${filteredCount ? `<p class="hint">🫥 ${filteredCount} 条关系被「关系过滤」挡住
        <button class="ghost tiny" type="button" data-edge-reset="1">显示全部</button></p>` : ''}
      ${relItems.length ? foldSection({ key: `rel:${c.id}`, n: 6, unit: '条', cls: 'rel-list', items: relItems }) : '<ul class="rel-list"><li class="hint">暂无记录</li></ul>'}
      <p style="margin-top:10px">
        <button class="ghost tiny" type="button" data-ai="char" data-id="${esc(c.id)}">🤖 讲讲这个人（不剧透）</button>
        <button class="ghost tiny" type="button" data-ai-settings="1">⚙️ AI 设置</button>
      </p>
      <div id="ai-answer" class="ai-answer" hidden></div>`;
    bindGoto(panel());
  }

  function renderRelationPanel(r) {
    const [first, second] = orderPair(r.from, r.to);
    const evItems = (r.events || []).map((e) =>
      `<div class="rel-event">· ${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`);
    panel().innerHTML = `
      <div class="card-title">${charLink(first)} <span style="color:var(--muted);font-weight:400">— ${esc(r.type)} —</span>${kinBadge(r)}${isDerived(r) ? ' <span class="badge">推导</span>' : ''} ${charLink(second)}</div>
      <p class="card-sub">${isDerived(r) ? '这是<b>推导出来的亲属关系</b>（原文没有直接互动，由亲子关系推出来）' : '定义这段关系的事件'}${r.kin ? `（${KIN_LABEL[r.kin]}：${KIN_HINT[r.kin] || ''}）` : ''}</p>
      ${periodText(r) ? `<p class="card-sub">关系时段：<b>${esc(periodText(r))}</b>${state.timeTravel ? `　<span class="hint">（图谱现在拨在第 ${state.chapter} 章）</span>` : ''}</p>` : ''}
      ${evItems.length ? foldSection({ key: `relev:${first}|${second}`, n: 10, unit: '条', cls: 'rel-events', wrap: 'div', bare: true, items: evItems }) : '<p class="hint">暂无记录</p>'}
      <p class="hint" style="margin-top:10px">提示：在图上点另一个节点可以顺着关系链继续走。</p>`;
    bindGoto(panel());
  }

  function renderEventPanel(ev) {
    const chain = (ev.chars || []).map(charLink).join('、');
    panel().innerHTML = `
      <div class="card-title">${esc(ev.name)}</div>
      <p class="card-sub">阶段：${esc((state.book.phases.find((p) => p.id === ev.phase) || {}).name || '')}</p>
      <p class="card-desc">${esc(ev.summary)}</p>
      <p class="card-fate"><b>影响：</b>${esc(ev.impact)}</p>
      ${ev.quote ? `<div class="quote">「${esc(ev.quote)}」</div>` : ''}
      <p style="margin-top:10px">${ev.place ? `<button class="ghost tiny" type="button" data-place-filter="${esc(ev.place)}">📍 ${esc(placeName(ev.place))}</button>` : ''}
      <b>涉及：</b>${chain}</p>`;
    bindGoto(panel());
  }

  /* ---------------- 两人关系（BFS） ---------------- */
  function bfs(fromId, toId) {
    if (fromId === toId) return [];
    const prev = new Map([[fromId, null]]);
    const queue = [fromId];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === toId) break;
      for (const e of state.adj.get(cur) || []) {
        if (!relVisible(e.rel)) continue;
        if (!passEdgeFilter(e.rel)) continue;
        if (!relVisibleAt(e.rel)) continue;
        if (!prev.has(e.to)) { prev.set(e.to, { from: cur, rel: e.rel }); queue.push(e.to); }
      }
    }
    if (!prev.has(toId)) return null;
    const steps = [];
    let cur = toId;
    while (prev.get(cur)) { const p = prev.get(cur); steps.unshift({ from: p.from, to: cur, rel: p.rel }); cur = p.from; }
    return steps;
  }

  function runPath() {
    const a = $('#path-a').value, b = $('#path-b').value;
    const hint = $('#path-hint');
    if (!a || !b) { hint.textContent = '请选择两个人'; return; }
    const steps = bfs(a, b);
    if (!steps) { hint.textContent = '在图里找不到通路'; return; }
    hint.textContent = `最短 ${steps.length} 跳`;
    const nodes = new Set([a, ...steps.map((s) => s.to)]);
    const edges = new Set(steps.map((s) => edgeKey(s.from, s.to)));
    setHighlight(nodes, edges, null, null);

    const stepItems = steps.map((s, i) => {
      const vis = visibleRelEvents(s.rel);
      const hidden = (s.rel.events || []).length - vis.length;
      const evs = vis.map((e) =>
        `<div class="rel-event">· ${e.place ? `<span class="chapter">📍${esc(placeName(e.place))}</span> ` : ''}${esc(e.text)}${e.chapter ? `<span class="chapter">${esc(e.chapter)}</span>` : ''}</div>`).join('');
      return `<li class="rel">
        <div class="rel-head"><span class="idx">${i + 1}</span> ${charLink(s.from)} <span class="type">— ${esc(s.rel.type)} —</span>${kinBadge(s.rel)} ${charLink(s.to)}</div>
        ${evs}${hidden ? `<div class="rel-event">🔒 还有 ${hidden} 条事件在你读到的进度之后</div>` : ''}
      </li>`;
    });
    panel().innerHTML = `
      <div class="card-title">关系链：${esc(charName(a))} → ${esc(charName(b))}</div>
      <p class="card-sub">共 ${steps.length} 跳 · 每一跳的「关系」与依据事件</p>
      ${stepItems.length ? foldSection({ key: `path:${a}|${b}`, n: 10, unit: '跳', cls: 'path-steps', items: stepItems }) : '<ul class="path-steps"><li class="hint">同一个人</li></ul>'}
      <p style="margin-top:10px">
        <button class="ghost tiny" type="button" data-ai="chain">🤖 讲一遍（不剧透）</button>
        <button class="ghost tiny" type="button" data-ai-settings="1">⚙️ AI 设置</button>
      </p>
      <div id="ai-answer" class="ai-answer" hidden></div>`;
    bindGoto(panel());
  }

  /* ---------------- 事件轴 ---------------- */
  function renderTimeline() {
    const el = $('#timeline');
    const phases = [...state.book.phases].sort((a, b) => a.order - b.order);
    el.innerHTML = phases.map((p) => {
      const evs = state.book.events
        .filter((e) => e.phase === p.id)
        .filter((e) => !state.placeFilter || e.place === state.placeFilter)
        .filter((e) => eventVisibleAt(e))
        .sort((a, b) => a.order - b.order);
      if (!evs.length) return '';
      return `<div class="phase">
        <div class="phase-title">${esc(p.name)}</div>
        ${evs.map((e) => eventLocked(e)
          ? `<button type="button" class="event-chip locked" disabled title="剧透保护：第 ${e.ch} 章的事件">
               <span class="ev-name">🔒 第 ${e.ch} 章的事件</span>
               <span class="ev-sum">剧透保护中 · 读到再解锁</span>
             </button>`
          : `<button type="button" class="event-chip" data-event="${esc(e.id)}">
               <span class="ev-name">${esc(e.name)}${e.place ? ` <span class="chapter">📍${esc(placeName(e.place))}</span>` : ''}</span>
               <span class="ev-sum">${esc(e.summary)}</span>
             </button>`).join('')}
      </div>`;
    }).join('');
    el.querySelectorAll('.event-chip').forEach((btn) => btn.addEventListener('click', () => selectEvent(btn.dataset.event)));
  }

  /* ---------------- 章节视图：第 N 章的世界 ---------------- */
  /** 把"这一章发生了什么"从数据里切出来（零新数据：firstCh / relations[].events[].chapter / events[].ch / places[].firstCh） */
  function chapterDigest(n) {
    const b = state.book;
    const charsNew = [], charsHere = new Set(), relsNew = [], relsHere = [], places = new Set();
    for (const c of b.characters) if (charCh(c) === n) { charsNew.push(c); charsHere.add(c.id); }
    for (const r of b.relations) {
      if (isDerived(r)) continue;
      const evs = (r.events || []).filter((e) => eventChOf(e) === n);
      if (!evs.length) continue;
      relsHere.push(r);
      if (relCh(r) === n) relsNew.push(r);
      charsHere.add(r.from); charsHere.add(r.to);
    }
    const events = b.events.filter((e) => e.ch === n);
    for (const e of events) {
      for (const id of e.chars || []) charsHere.add(id);
      if (e.place) places.add(e.place);
    }
    for (const r of relsHere) for (const ev of r.events || []) if (eventChOf(ev) === n && ev.place) places.add(ev.place);
    const knownPlaces = [...places].filter((id) => state.places.has(id));
    return {
      n, charsNew, relsNew, events,
      charsHere: [...charsHere].filter((id) => state.byId.has(id)),
      places: knownPlaces,
      placesNew: knownPlaces.filter((id) => (placeOf(id).firstCh ?? 0) === n),
    };
  }

  /* ---------------- 时间旅行：UI 与重绘 ---------------- */
  function timeCeiling() {
    const total = maxChapter() || 1;
    return state.progress === null ? total : Math.min(total, state.progress);
  }
  function syncTimeTravelUI() {
    const btn = document.getElementById('time-btn');
    const slider = document.getElementById('time-slider');
    const hint = document.getElementById('time-hint');
    const ceil = timeCeiling();
    if (btn) {
      const n = asOf();
      btn.textContent = state.timeTravel ? `🕰 时间旅行：第 ${n} 章` : '🕰 时间旅行：关';
      btn.classList.toggle('on', !!state.timeTravel);
    }
    if (slider) {
      slider.hidden = !state.timeTravel;
      slider.min = '1';
      slider.max = String(ceil);
      slider.value = String(Math.min(state.chapter, ceil));
    }
    if (hint) {
      if (!state.timeTravel) hint.textContent = '';
      else if (state.progress !== null && state.chapter > state.progress) hint.textContent = `（剧透保护：图谱最多拨到第 ${state.progress} 章）`;
      else hint.textContent = '只画当时已发生的关系';
    }
  }
  function applyTimeTravelGraph() {
    if (!state.chart) return;
    fillMissingPositions();
    computeLabels(state.zoom);
    state.chart.setOption(buildOption({ keepView: true }));
  }
  function applyTimeTravel() {
    try { localStorage.setItem('ba-timetravel', state.timeTravel ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ }
    state.chapter = Math.max(1, Math.min(maxChapter() || 1, state.chapter || 1));
    syncTimeTravelUI();
    clearHighlight(false);
    renderDatalist();
    renderPathSelects();
    renderTimeline();
    renderPlaceSelect();
    renderChapter();
    applyTimeTravelGraph();
    updateCountHint();
    refreshPanel();
  }

  function goChapter(n) {
    state.chapter = Math.max(1, Math.min(maxChapter() || 1, Number(n) || 1));
    try { localStorage.setItem('ba-chapter-' + (state.book?.meta?.slug || 'book'), String(state.chapter)); } catch (e) { /* 忽略 */ }
    renderChapter();
    if (state.timeTravel) applyTimeTravel();
    else syncTimeTravelUI();
    const el = document.getElementById('chapter-panel');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function renderChapter() {
    if (!state.book) return;
    const total = maxChapter() || 1;
    const n = Math.max(1, Math.min(total, state.chapter || 1));
    state.chapter = n;
    const title = document.getElementById('ch-title');
    if (title) title.textContent = `📖 第 ${n} 章`;
    const sel = document.getElementById('ch-select');
    if (sel) {
      if (sel.options.length !== total) sel.innerHTML = Array.from({ length: total }, (_, i) => `<option value="${i + 1}">第 ${i + 1} 章</option>`).join('');
      if (sel.value !== String(n)) sel.value = String(n);
    }
    const body = document.getElementById('chapter-body');
    if (!body) return;
    if (lockedCh(n)) {
      body.innerHTML = `
        <div class="ch-locked">🔒 <b>第 ${n} 章还没解锁</b>
          <p class="hint">你现在读到第 ${state.progress} 章——这一章的出场人物、关系与事件先锁起来，读完再来。</p>
          <button class="primary tiny" type="button" data-ch-mark="${n}">我已读到第 ${n} 章 →</button>
        </div>`;
    } else {
      const d = chapterDigest(n);
      const nd = chapterDigest(n + 1);
      const parts = [];
      if (nd.charsNew.length) parts.push(`${nd.charsNew.length} 个新人物`);
      if (nd.relsNew.length) parts.push(`${nd.relsNew.length} 条新关系`);
      if (nd.events.length) parts.push(`${nd.events.length} 个事件`);
      const teaser = n < total
        ? `<span><b>下一章</b>（第 ${n + 1} 章）：${parts.length ? '将解锁 ' + parts.join(' · ') : '没有新的整理内容'}</span>`
        : '<span><b>已是最后一章</b></span>';
      const mark = state.progress === n
        ? `<span class="hint">✓ 剧透保护：正读到第 ${n} 章</span>`
        : `<button class="primary tiny" type="button" data-ch-mark="${n}">${state.progress === null ? '🔒 从这一章开始防剧透' : `✓ 我读到第 ${n} 章了`}</button>`;
      body.innerHTML = `
        <p class="card-sub">本章 <b>${d.charsHere.length}</b> 人出场 · 新增关系 <b>${d.relsNew.length}</b> 条 · 事件 <b>${d.events.length}</b> 个 · 地点 <b>${d.places.length}</b> 处</p>
        ${d.charsNew.length ? `<div class="ch-sec"><h4>✨ 初次登场</h4>${foldSection({ key: `newchars:${n}`, n: 16, unit: '个', cls: 'ch-chips', wrap: 'div', items: d.charsNew.map((c) => `<button class="ch-chip" type="button" data-goto="${esc(c.id)}">${esc(c.name)}</button>`) })}</div>` : ''}
        ${d.relsNew.length ? `<div class="ch-sec"><h4>🤝 本章新关系（${d.relsNew.length}）</h4>${foldSection({ key: `chrels:${n}`, n: 10, unit: '条', cls: 'ch-list', items: d.relsNew.map((r) => `<li><button class="linkbtn" type="button" data-focus-rel="${esc(r.from)}|${esc(r.to)}">${esc(charName(r.from))} — ${esc(r.type)} — ${esc(charName(r.to))}</button></li>`) })}</div>` : ''}
        ${d.events.length ? `<div class="ch-sec"><h4>⚡ 本章事件（${d.events.length}）</h4><ul class="ch-list">${d.events.map((e) => `<li><button class="linkbtn" type="button" data-event="${esc(e.id)}">${esc(e.name)}</button></li>`).join('')}</ul></div>` : ''}
        ${d.places.length ? `<div class="ch-sec"><h4>📍 出现的地点</h4><div class="ch-chips">${d.places.map((id) => `<button class="ch-chip" type="button" data-place-filter="${esc(id)}">${esc(placeName(id))}${d.placesNew.includes(id) ? ' ✨' : ''}</button>`).join('')}</div></div>` : ''}
        <div class="ch-teaser">${teaser}</div>
        <div class="ch-foot">${mark}
          ${d.events.length ? '<button class="ghost tiny" type="button" data-ch-timeline="1">在时间轴里看本章事件</button>' : ''}
        </div>`;
    }
    body.querySelectorAll('[data-ch-mark]').forEach((btn) => btn.addEventListener('click', () => applySpoiler(true, Number(btn.dataset.chMark))));
    body.querySelectorAll('[data-ch-timeline]').forEach((btn) => btn.addEventListener('click', () => {
      const id = (state.book.events.find((e) => e.ch === state.chapter && (!state.placeFilter || e.place === state.placeFilter)) || {}).id;
      const chip = id ? document.querySelector(`.event-chip[data-event="${id}"]`) : null;
      const target = chip || document.getElementById('timeline');
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }));
    bindGoto(body);
  }

  /* ---------------- 导出 / 分享（单文件 HTML / 分享图 PNG / 打印版 SVG / 数据 JSON） ---------------- */
  const SITE_URL = 'wakennorman.github.io/book-atlas';
  const jsSafe = (s) => String(s).replace(/<\/script/gi, '<\\/script');
  const xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
  const slugOf = () => state.book?.meta?.slug || 'book';
  const titleOf = () => state.book?.meta?.title || '未命名';

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function downloadText(filename, text, mime = 'text/plain') {
    downloadBlob(filename, new Blob([text], { type: mime + ';charset=utf-8' }));
  }

  /** 当前筛选下真正画在图上的节点与连线（导出的输入；与 buildOption 的过滤条件一致） */
  function exportSelection() {
    const nodes = state.book.characters.filter((c) => !isCharHidden(c) && charVisibleAt(c) && passSizeFilter(c.id) && passFocus(c.id));
    const idset = new Set(nodes.map((c) => c.id));
    const links = state.book.relations.filter((r) =>
      idset.has(r.from) && idset.has(r.to) && !relLocked(r) && relVisible(r) && passEdgeFilter(r) && relVisibleAt(r));
    return { nodes, links };
  }

  /** 单文件 HTML：外壳取自 index.html，把 CSS/JS/数据全部内联 ⇒ 双击即看 */
  async function buildStandaloneHtml() {
    const grab = (url) => fetch(url, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`读取 ${url} 失败（${r.status}）`);
      return r.text();
    });
    const [shell, css, echarts, app, logo] = await Promise.all([
      grab('index.html'), grab('css/style.css'), grab('vendor/echarts.min.js'), grab('js/app.js'), grab('assets/logo-mark.svg'),
    ]);
    const data = jsSafe(JSON.stringify(state.book));
    let html = shell;
    html = html.replace(/<link rel="stylesheet" href="css\/style\.css\?v=\d+">/, () => `<style>\n${css}\n</style>`);
    html = html.replace(/\s*<link rel="manifest"[^>]*>/, '');
    html = html.replace(/\s*<link rel="icon"[^>]*>/g, '');
    html = html.replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '');
    html = html.replace(/<img class="logo"[^>]*>/, () => `<img class="logo" alt="书脉" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(logo)}">`);
    html = html.replace(/\s*<a class="icon-btn" href="editor\.html"[\s\S]*?<\/a>/, '');
    html = html.replace(/<a class="ghost tiny" href="editor\.html">打开编辑器<\/a>/, '<span class="hint">（单文件版不含编辑器；在线版可以自己整理一本书）</span>');
    html = html.replace(/<script src="vendor\/echarts\.min\.js"><\/script>/, () => `<script>${jsSafe(echarts)}<\/script>`);
    html = html.replace(/<script src="js\/app\.js\?v=\d+"><\/script>/,
      () => `<script>window.__BA_STANDALONE = true;\nwindow.__BA_STANDALONE_BOOK = ${data};<\/script>\n<script>${jsSafe(app)}<\/script>`);
    html = html.replace(/<span id="footer-note">[^<]*<\/span>/,
      (m) => `${m}\n      <span>· 本文件由《书脉 BookAtlas》导出（${esc(SITE_URL)}）</span>`);
    return html;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 分享图 PNG（返回 dataURL）：矢量渲染的关系图 + 书名/统计/图例/链接 */
  async function buildSharePng() {
    if (!state.book) return '';
    const W = 1600, H = 1000;
    const bg = cssVar('--bg') || '#f4f1ea';
    const panel = cssVar('--panel') || '#ffffff';
    const ink = cssVar('--ink') || '#232a35';
    const muted = cssVar('--muted') || '#6c7482';
    const line = cssVar('--line') || '#e5dfd3';
    // 用矢量渲染器出图（而不是截图）：不受当前缩放/高亮影响，放大也清晰
    const svg = buildGraphSvg({ page: false });
    if (!svg) return '';
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { resolve(im); setTimeout(() => URL.revokeObjectURL(svgUrl), 1000); };
      im.onerror = () => { URL.revokeObjectURL(svgUrl); reject(new Error('矢量图渲染失败')); };
      im.src = svgUrl;
    });
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const font = (size, weight) => `${weight ? weight + ' ' : ''}${size}px -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = ink; ctx.font = font(44, 700);
    ctx.fillText(`《${titleOf()}》`, 52, 80);
    ctx.fillStyle = muted; ctx.font = font(23);
    const prog = state.progress === null ? '剧透保护：关（全部解锁）' : `剧透保护：读到第 ${state.progress} 章`;
    const m = state.book.meta || {};
    ctx.fillText(`${m.author || ''} · ${state.book.characters.length} 人 / ${state.book.relations.length} 段关系 / ${state.book.events.length} 个事件 · ${prog}`, 52, 120);
    ctx.textAlign = 'right';
    ctx.fillText('● 圆＝男　▢ 圆角方＝女　大小＝关系条数', W - 52, 120);
    ctx.textAlign = 'left';
    const gx = 40, gy = 146, gw = W - 80, gh = H - 146 - 112;
    ctx.save();
    roundRectPath(ctx, gx, gy, gw, gh, 20);
    ctx.fillStyle = panel; ctx.fill();
    ctx.clip();
    const k = Math.min(gw / img.width, gh / img.height);
    const dw = img.width * k, dh = img.height * k;
    ctx.drawImage(img, gx + (gw - dw) / 2, gy + (gh - dh) / 2, dw, dh);
    ctx.restore();
    ctx.strokeStyle = line; ctx.lineWidth = 2;
    roundRectPath(ctx, gx, gy, gw, gh, 20);
    ctx.stroke();
    let lx = 52;
    ctx.font = font(21);
    for (const f of state.book.factions.slice(0, 9)) {
      ctx.fillStyle = factionColorByKey(f.key);
      ctx.beginPath(); ctx.arc(lx + 7, H - 78, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = muted; ctx.fillText(f.name, lx + 20, H - 71);
      lx += 20 + ctx.measureText(f.name).width + 26;
      if (lx > W - 80) break;
    }
    ctx.fillStyle = muted; ctx.font = font(20);
    ctx.fillText(`书脉 BookAtlas · ${SITE_URL}`, 52, H - 30);
    return cv.toDataURL('image/png');
  }

  /** 导出用的坐标：state.pos 是"已适配屏幕"的（乘过 fitLast），导出要还原回世界尺度，
   *  否则大书（fit 只有 0.09）会出现"节点尺寸是世界单位、间距被压扁"⇒ 糊成一团；
   *  布局还没跑完时（刚切书等）再用当前视图的确定性布局补齐 */
  function exportPositions(nodes) {
    const inv = 1 / (Math.abs(state.fitLast) || 1);
    let base = state.pos;
    if (!nodes.every((c) => base.has(c.id)) && state.view !== 'force') {
      const backupPos = state.pos, backupBands = state.bands;
      buildGenerationPositions(state.view);
      const computed = state.pos;
      state.pos = backupPos;
      state.bands = backupBands;
      base = new Map(backupPos);
      for (const c of nodes) if (!base.has(c.id) && computed.has(c.id)) base.set(c.id, computed.get(c.id));
    }
    const scaled = new Map();
    for (const [id, p] of base) scaled.set(id, { x: p.x * inv, y: p.y * inv });
    return scaled;
  }

  /** 关系图的矢量渲染（打印页 / 分享图共用）
   *  page=true：A3 横向打印页（标题 + 图例 + 页脚）
   *  page=false：只出图，画布贴着图形包围盒（分享图内嵌用，不受用户当前缩放影响） */
  function buildGraphSvg({ page = true } = {}) {
    if (!state.book) return '';
    if (!state.pos.size && state.chart) freezeNow();
    const { nodes, links } = exportSelection();
    const pos = exportPositions(nodes);
    const placed = nodes.map((c) => ({ c, p: pos.get(c.id) })).filter((x) => x.p);
    if (!placed.length) return '';
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const { p } of placed) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    // 缩放要把节点半径算进去，否则最外圈的圆会顶出纸面
    const maxRWorld = Math.max(...placed.map(({ c }) => symbolSize(c.id) / 2), 1);
    const pad = 12;
    const PW = page ? 420 : Math.round(maxX - minX + 2 * maxRWorld + pad * 2);
    const PH = page ? 297 : Math.round(maxY - minY + 2 * maxRWorld + pad * 2);
    const M = page ? 14 : pad, HEAD = page ? 32 : pad, FOOT = page ? 16 : pad;
    const areaW = PW - M * 2, areaH = PH - HEAD - FOOT;
    const k = Math.min(areaW / Math.max(maxX - minX + 2 * maxRWorld, 1), areaH / Math.max(maxY - minY + 2 * maxRWorld, 1));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const X = (p) => (p.x - cx) * k + PW / 2;
    const Y = (p) => (p.y - cy) * k + HEAD + areaH / 2;
    const byId = new Map(nodes.map((c) => [c.id, c]));
    const rad = (c) => Math.max(page ? 0.9 : 3, Math.min(20, symbolSize(c.id) / 2 * k));
    const edges = [];
    for (const r of links) {
      const a = pos.get(r.from), b = pos.get(r.to);
      if (!a || !b) continue;
      const c = byId.get(r.from);
      const col = charLocked(c) ? '#9aa3b0' : factionColorOf(c);
      const dashed = isDerived(r) || r.style === 'dashed';
      const dotted = r.style === 'dotted';
      edges.push(`<line x1="${X(a).toFixed(1)}" y1="${Y(a).toFixed(1)}" x2="${X(b).toFixed(1)}" y2="${Y(b).toFixed(1)}" stroke="${col}" stroke-width="${Math.max(page ? 0.12 : 0.6, 1.2 * k).toFixed(2)}" stroke-opacity="0.34"${dashed ? ' stroke-dasharray="1.6 1.2"' : dotted ? ' stroke-dasharray="0.5 1.1"' : ''}/>`);
    }
    const dots = [];
    for (const { c, p } of placed) {
      const x = X(p), y = Y(p), r = rad(c);
      const locked = charLocked(c);
      const fill = locked ? '#9aa3b0' : factionColorOf(c);
      const op = (locked ? 0.45 : 0.92).toFixed(2);
      dots.push(c.gender === 'f'
        ? `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(2 * r).toFixed(1)}" rx="${(r * 0.3).toFixed(1)}" fill="${fill}" fill-opacity="${op}" stroke="#ffffff" stroke-width="0.25"/>`
        : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" fill-opacity="${op}" stroke="#ffffff" stroke-width="0.25"/>`);
    }
    const fs = page ? Math.max(1.1, Math.min(4.6, 10.5 * k)) : Math.max(6, Math.min(11, 10.5 * k));
    const boxes = [], dotBoxes = [], labels = [];
    for (const { c, p } of placed) {
      const r = rad(c);
      dotBoxes.push({ bx: X(p) - r, by: Y(p) - r, w: 2 * r, h: 2 * r });
    }
    const cands = [...placed].sort((a, b) => nodeDegree(b.c.id) - nodeDegree(a.c.id));
    for (const { c, p } of cands) {
      if (charLocked(c)) continue;
      const x = X(p), y = Y(p), r = rad(c);
      const w = c.name.length * fs + fs * 0.5, h = fs * 1.25;
      // 四个候选位：右 → 左 → 上 → 下（取第一个不压节点、不压别的标签的位置）
      const slots = [
        { bx: x + r + 0.8, by: y - h / 2 },
        { bx: x - r - 0.8 - w, by: y - h / 2 },
        { bx: x - w / 2, by: y - r - 0.8 - h },
        { bx: x - w / 2, by: y + r + 0.8 },
      ];
      const free = (s, withDots) => s.bx >= M && s.bx + w <= PW - M && s.by >= HEAD && s.by + h <= PH - FOOT
        && !boxes.some((o) => !(s.bx > o.bx + o.w || s.bx + w < o.bx || s.by > o.by + o.h || s.by + h < o.by))
        && (!withDots || !dotBoxes.some((o) => !(s.bx > o.bx + o.w || s.bx + w < o.bx || s.by > o.by + o.h || s.by + h < o.by)));
      // 两轮：先找"不压节点"的干净位；找不到就退一步，只要不压别的标签（保证小字不至于太稀）
      const slot = slots.find((s) => free(s, true)) || slots.find((s) => free(s, false));
      if (!slot) continue;
      boxes.push({ bx: slot.bx, by: slot.by, w, h });
      labels.push(`<text x="${slot.bx.toFixed(1)}" y="${(slot.by + fs).toFixed(1)}" font-size="${fs.toFixed(2)}" fill="#3a4150">${xmlEsc(c.name)}</text>`);
    }
    const legend = !page ? '' : state.book.factions.map((f, i) => {
      const x = M + (i % 6) * 66, y = 27 - Math.floor(i / 6) * 5;
      return `<circle cx="${x}" cy="${(y - 1.3).toFixed(1)}" r="1.5" fill="${factionColorByKey(f.key)}"/><text x="${(x + 3).toFixed(1)}" y="${y}" font-size="3" fill="#6c7482">${xmlEsc(f.name)}</text>`;
    }).join('');
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const progText = state.progress === null ? '全部解锁' : `剧透保护：读到第 ${state.progress} 章（灰色＝未解锁）`;
    const unit = page ? 'mm' : '';
    const head = !page ? '' : `
  <text x="${M}" y="13" font-size="7" font-weight="700" fill="#232a35">《${xmlEsc(titleOf())}》人物关系图</text>
  <text x="${M}" y="20" font-size="3.3" fill="#6c7482">${xmlEsc(state.book.meta.author || '')} · 显示 ${nodes.length} / ${state.book.characters.length} 人 · 关系 ${links.length} 段 · 事件 ${state.book.events.length} 个 · ${progText}</text>
  ${legend}`;
    const foot = !page ? '' : `
  <text x="${M}" y="${PH - 6}" font-size="3.2" fill="#6c7482">书脉 BookAtlas · ${SITE_URL} · ${date}</text>
  <text x="${PW - M}" y="${PH - 6}" font-size="3.2" fill="#6c7482" text-anchor="end">圆＝男 / 圆角方＝女 · 大小＝关系条数 · 虚线＝推导或对立</text>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PW}${unit}" height="${PH}${unit}" viewBox="0 0 ${PW} ${PH}" font-family="-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif">
  <rect x="0" y="0" width="${PW}" height="${PH}" fill="#ffffff"/>${head}
  <g>${edges.join('')}</g>
  <g>${dots.join('')}</g>
  <g>${labels.join('')}</g>${foot}
</svg>`;
  }

  function buildPrintSvg() { return buildGraphSvg({ page: true }); }

  /** 轻提示（导出成功/失败等短消息） */
  function toast(msg, ms = 2800) {
    let el = document.getElementById('ba-toast');
    if (!el) { el = document.createElement('div'); el.id = 'ba-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  /** canvas 文本换行（按像素量宽；最多 maxLines 行，超出加省略号） */
  function wrapText(ctx, text, maxWidth, maxLines) {
    const chars = [...String(text || '')];
    const lines = [];
    let cur = '';
    for (const ch of chars) {
      if (ch === '\n') { lines.push(cur); cur = ''; if (lines.length >= maxLines) break; continue; }
      if (cur && ctx.measureText(cur + ch).width > maxWidth) {
        lines.push(cur); cur = ch;
        if (lines.length >= maxLines) break;
      } else cur += ch;
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    if (lines.length >= maxLines) {
      let last = lines[maxLines - 1] || '';
      while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '…';
    }
    return lines;
  }

  /** 人物卡 PNG（返回 dataURL）：身份 / 结局 / 关键关系（带依据事件）；吃剧透保护与关系过滤 */
  async function buildCharacterPng(id) {
    const c = state.byId.get(id);
    if (!c) return '';
    const W = 1200;
    const bg = cssVar('--bg') || '#f4f1ea';
    const panel = cssVar('--panel') || '#ffffff';
    const ink = cssVar('--ink') || '#232a35';
    const muted = cssVar('--muted') || '#6c7482';
    const line = cssVar('--line') || '#e5dfd3';
    const font = (size, weight) => `${weight ? weight + ' ' : ''}${size}px -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`;
    // 先算内容（关系行数决定卡片高度）
    const allOf = state.book.relations.filter((r) => r.from === c.id || r.to === c.id);
    const rels = allOf.filter((r) => !relLocked(r) && relVisible(r) && passEdgeFilter(r))
      .sort((a, b) => nodeDegree(b.from === c.id ? b.to : b.from) - nodeDegree(a.from === c.id ? a.to : a.from))
      .slice(0, 8);
    const lockedRels = allOf.filter((r) => relLocked(r)).length;
    const H = Math.max(560, Math.min(1080, 500 + rels.length * 56 + (lockedRels ? 26 : 0)));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const L = 64, R = W - 64;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = panel;
    roundRectPath(ctx, 28, 28, W - 56, H - 56, 22); ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.stroke();
    let y = 100;
    ctx.fillStyle = ink; ctx.font = font(40, 700);
    ctx.fillText(c.name, L, y);
    const nameW = ctx.measureText(c.name).width;
    const aliases = (c.aliases || []).filter((a) => a && a !== c.name && a.length <= Math.max(2, Math.floor(c.name.length * 0.6))).slice(0, 4);
    if (aliases.length) {
      ctx.fillStyle = muted; ctx.font = font(20);
      ctx.fillText(`（${aliases.join('，')}）`, L + nameW + 8, y - 2);
    }
    y += 24;
    const f = state.book.factions.find((x) => x.key === effectiveFactionKey(c)) || {};
    ctx.fillStyle = f.color || '#8b94a7';
    roundRectPath(ctx, L, y, 120, 8, 4); ctx.fill();
    ctx.fillStyle = muted; ctx.font = font(19);
    const badges = [f.name || '其他', c.gender === 'f' ? '♀ 女' : '♂ 男',
      state.groupMode === 'generation' ? genText(c.generation) : '', c.title || '',
      `关系 ${(state.adj.get(c.id) || []).length} 条`].filter(Boolean).join(' · ');
    ctx.fillText(badges, L, y + 30);
    y += 66;
    ctx.fillStyle = ink; ctx.font = font(21);
    for (const ln of wrapText(ctx, c.desc, R - L, 3)) { ctx.fillText(ln, L, y); y += 32; }
    y += 4;
    ctx.fillStyle = muted; ctx.font = font(19, 700); ctx.fillText('结局', L, y);
    ctx.font = font(19);
    const fateText = fateLocked(c) ? '🔒 在你读到的进度之后（读完再来看）' : (c.fate || '—');
    for (const ln of wrapText(ctx, fateText, R - L - 60, 2)) { ctx.fillText(ln, L + 56, y); y += 28; }
    y += 12;
    ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
    y += 32;
    ctx.fillStyle = ink; ctx.font = font(21, 700); ctx.fillText('关键关系', L, y); y += 32;
    if (!rels.length) {
      ctx.fillStyle = muted; ctx.font = font(19); ctx.fillText('（暂无可显示的关系）', L, y); y += 34;
    }
    for (const r of rels) {
      const other = r.from === c.id ? r.to : r.from;
      const otherName = charLocked(state.byId.get(other)) ? '🔒' : charName(other);
      // 第一行：对方 — 关系类型
      ctx.fillStyle = ink; ctx.font = font(20, 700);
      ctx.fillText(otherName, L, y);
      const w = ctx.measureText(otherName).width;
      ctx.fillStyle = muted; ctx.font = font(19);
      ctx.fillText(`— ${r.type} —`, L + w + 8, y);
      // 第二行：一条依据事件（小字、单行省略）
      const ev = (visibleRelEvents(r)[0] || {});
      ctx.font = font(17);
      const evText = ev.text ? wrapText(ctx, `· ${ev.text}${ev.chapter ? `（${ev.chapter}）` : ''}`, R - L - 16, 1)[0] || '' : '';
      if (evText) { ctx.fillStyle = muted; ctx.fillText(evText, L + 16, y + 24); }
      y += 56;
    }
    if (lockedRels) {
      ctx.fillStyle = muted; ctx.font = font(17);
      ctx.fillText(`🔒 还有 ${lockedRels} 条关系在你读到的进度之后`, L, y - 8);
    }
    ctx.fillStyle = muted; ctx.font = font(19);
    ctx.fillText(`书脉 BookAtlas · ${SITE_URL}`, L, H - 60);
    ctx.textAlign = 'right';
    ctx.fillText(state.progress === null ? '全部解锁' : `剧透保护：读到第 ${state.progress} 章`, R, H - 60);
    ctx.textAlign = 'left';
    return cv.toDataURL('image/png');
  }

  /* ---------------- AI 讲解（不剧透）：资料先在本地按进度过滤，再交给模型 ---------------- */
  const AI_DEFAULT_BASE = 'https://api.deepseek.com/v1';
  const aiConfig = () => ({
    base: (localStorage.getItem('ba-ai-base') || AI_DEFAULT_BASE).replace(/\/+$/, ''),
    key: localStorage.getItem('ba-ai-key') || '',
    model: localStorage.getItem('ba-ai-model') || 'deepseek-chat',
  });

  function openAiModal(msg) {
    const modal = document.getElementById('ai-modal');
    if (!modal) return;
    const cfg = aiConfig();
    const base = document.getElementById('ai-base');
    const model = document.getElementById('ai-model');
    const key = document.getElementById('ai-key');
    if (base) base.value = cfg.base;
    if (model) model.value = cfg.model;
    if (key) key.value = cfg.key;
    const hint = document.getElementById('ai-hint');
    if (hint) hint.textContent = msg || 'DeepSeek 官方端点允许浏览器直连；换成别的端点若报 CORS，就用编辑器里的命令行方式。';
    modal.hidden = false;
  }
  function saveAiConfig() {
    const base = ((document.getElementById('ai-base') || {}).value || '').trim() || AI_DEFAULT_BASE;
    const model = ((document.getElementById('ai-model') || {}).value || '').trim() || 'deepseek-chat';
    const key = ((document.getElementById('ai-key') || {}).value || '').trim();
    try {
      localStorage.setItem('ba-ai-base', base.replace(/\/+$/, ''));
      localStorage.setItem('ba-ai-model', model);
      localStorage.setItem('ba-ai-key', key);
    } catch (e) { /* 隐私模式忽略 */ }
    const modal = document.getElementById('ai-modal');
    if (modal) modal.hidden = true;
    toast(key ? '已保存 AI 配置（只在本机，与编辑器共用）' : '已清空 API Key');
  }

  /** 讲解的"进度上限"：剧透保护与时间旅行取更小的那个；都没有＝全书 */
  const aiCeiling = () => {
    const cands = [state.progress, asOf()].filter((x) => typeof x === 'number');
    return cands.length ? Math.min(...cands) : (maxChapter() || 1);
  };

  /** 关系链资料：每一跳的关系 + 只保留已解锁的依据事件 */
  function aiChainContext(steps) {
    return steps.map((s, i) => {
      const evs = visibleRelEvents(s.rel).map((e) => `${e.text}${e.chapter ? `（${e.chapter}）` : ''}`).join('；');
      const period = periodText(s.rel) ? `（关系时段：${periodText(s.rel)}）` : '';
      return `${i + 1}. ${charName(s.from)} — ${s.rel.type} — ${charName(s.to)}${period}${evs ? `　依据：${evs}` : ''}`;
    }).join('\n');
  }

  /** 人物资料：档案 + 关系 + 事件；结局按剧透保护决定给不给 */
  function aiCharContext(c) {
    const head = [
      `姓名：${c.name}${(c.aliases || []).length ? `（别名：${c.aliases.join('，')}）` : ''}`,
      c.title ? `身份：${c.title}` : '',
      state.groupMode === 'generation' ? `代际：${genText(c.generation)}` : `阵营：${factionTextOf(c)}`,
      `首次出场：第 ${charCh(c)} 章`,
      c.desc ? `简介：${c.desc}` : '',
      fateLocked(c) ? '' : (c.fate ? `结局：${c.fate}` : ''),
    ].filter(Boolean).join('\n');
    const rels = state.book.relations
      .filter((r) => (r.from === c.id || r.to === c.id) && !relLocked(r) && relVisibleAt(r) && passEdgeFilter(r))
      .slice(0, 20)
      .map((r) => {
        const other = r.from === c.id ? r.to : r.from;
        const evs = visibleRelEvents(r).map((e) => e.text).slice(0, 2).join('；');
        return `- ${charName(other)}：${r.type}${periodText(r) ? `（${periodText(r)}）` : ''}${evs ? `　依据：${evs}` : ''}`;
      }).join('\n');
    const evs = state.book.events
      .filter((e) => (e.chars || []).includes(c.id) && !eventLocked(e) && eventVisibleAt(e))
      .slice(0, 16)
      .map((e) => `- 第 ${e.ch} 章《${e.name}》：${e.summary}`)
      .join('\n');
    return `${head}\n\n与他/她有关的人（只列你读到的部分）：\n${rels || '（暂无）'}\n\n相关事件（只列你读到的部分）：\n${evs || '（暂无）'}`;
  }

  /** 组装提示词（测试也用它，便于断言"资料里没有未来信息"） */
  function aiPrompt(kind, payload) {
    const ceiling = aiCeiling();
    const total = maxChapter() || 1;
    const prog = state.progress === null
      ? `读者没有开启剧透保护（可以看到全书信息，上限第 ${total} 章）`
      : `读者读到第 ${state.progress} 章（共 ${total} 章）`;
    const system = [
      `你是《${titleOf()}》的阅读助手。`,
      prog,
      `硬性要求：① 只能使用下面提供的资料，不要使用你自己的记忆；② 只描述发生在第 ${ceiling} 章及之前的事；`,
      `③ 不要提任何更后面的情节，也不要用"后来 / 最终 / 结局 / 最后 / 真相是"这类预示；`,
      `④ 资料里没有的不要编；⑤ 语气平实、口语化，不要小标题、不要列表，不超过 220 字。`,
    ].join('');
    const user = kind === 'chain'
      ? `【任务】用几句话说清这段关系链是怎么一环扣一环的。\n\n【关系链（按跳数）】\n${aiChainContext(payload)}\n\n【读者进度】第 ${ceiling} 章`
      : `【任务】用几句话说清这个人是谁、和他人的关系是怎么来的。\n\n【人物资料】\n${aiCharContext(payload)}\n\n【读者进度】第 ${ceiling} 章`;
    return { system, user, ceiling };
  }

  async function aiExplain(kind, payload) {
    const cfg = aiConfig();
    if (!cfg.key) { openAiModal('还没有配置 API Key —— 填好之后再点一次「🤖 讲一遍」就行。'); return; }
    const box = document.getElementById('ai-answer');
    if (box) {
      box.hidden = false;
      box.innerHTML = `<div class="ai-head">🤖 正在生成…</div><div class="hint">只用你读到的部分（第 ${aiCeiling()} 章之前）</div>`;
    }
    const { system, user } = aiPrompt(kind, payload);
    try {
      const res = await fetch(`${cfg.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, temperature: 0.4, max_tokens: 700, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (!res.ok) throw new Error(`接口返回 ${res.status}：${(await res.text()).slice(0, 140)}`);
      const data = await res.json();
      const text = (((data || {}).choices || [{}])[0].message || {}).content || '';
      if (!String(text).trim()) throw new Error('模型没有返回内容');
      if (box) box.innerHTML = `<div class="ai-head">🤖 AI 讲解</div>${esc(text)}<div class="ai-foot">基于你读到的第 ${aiCeiling()} 章 · 资料已在本地按进度过滤 · 模型 ${esc(cfg.model)} · <button class="linkbtn" type="button" data-ai-settings="1">⚙️ 设置</button></div>`;
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (box) box.innerHTML = `<div class="ai-head">🤖 讲解失败</div><div class="ai-err">${esc(msg)}</div><div class="ai-foot">${/Failed to fetch|CORS|NetworkError/i.test(msg) ? '浏览器直连被拦：换一个允许跨域的端点，或用编辑器里的命令行方式。' : '可以再点一次「🤖 讲一遍」重试。'} · <button class="linkbtn" type="button" data-ai-settings="1">⚙️ 设置</button></div>`;
    }
  }

  /* ---------------- 阅读伴侣 EPUB（可传进微信读书：只含整理数据，不含原著正文） ---------------- */
  /** SVG 光栅化成图片（EPUB 里放；顺带把宽度限制住，别让文件太大）
   *  type: 'png' | 'jpeg' —— 线稿+文字用 JPEG 体积小得多（EPUB 里够清楚） */
  function rasterizeSvg(svg, scale = 2, maxW = 2000, type = 'image/jpeg', quality = 0.9) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        const w = Math.min(maxW, Math.max(200, Math.round(img.width * scale)));
        const h = Math.max(1, Math.round((img.height / img.width) * w));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve({ dataUrl: cv.toDataURL(type, quality), width: w, height: h, type });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('矢量图渲染失败')); };
      img.src = url;
    });
  }

  /** dataURL → Uint8Array（★ 不能走 strToU8：那会按 UTF-8 编码，把 ≥0x80 的字节改掉，图片直接坏） */
  function dataUrlToBytes(dataUrl) {
    const bin = atob(String(dataUrl).split(',')[1] || '');
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function epubPage(title, body) {
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body></html>`;
  }

  /** 组装 EPUB（跟随当前进度：锁着的人/事件不写进去，读到后面再导出一次即可） */
  async function buildCompanionEpub() {
    if (!window.fflate || !window.fflate.zipSync) throw new Error('缺少打包库 vendor/fflate.min.js');
    const f = window.fflate;
    const b = state.book, m = b.meta || {};
    const title = `《${titleOf()}》阅读伴侣`;
    const date = new Date();
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const progNote = state.progress === null
      ? '（导出时：全部解锁）'
      : `（导出时：剧透保护读到第 ${state.progress} 章 —— 之后的内容没有写进来，读到后面再导出一次即可）`;

    // 1) 关系总图（JPEG：线稿+文字的体积比 PNG 小一个数量级）
    const img = await rasterizeSvg(buildGraphSvg({ page: false }), 2, 2000, 'image/jpeg', 0.9);
    const imgName = img.type === 'image/png' ? 'graph.png' : 'graph.jpg';
    const imgMime = img.type;

    // 2) 人物志（按首次出场章排序；锁着的人不写）
    const chars = b.characters
      .filter((c) => !charLocked(c) && charVisibleAt(c))
      .sort((x, y) => charCh(x) - charCh(y) || (nodeDegree(y.id) - nodeDegree(x.id)));
    const charHtml = chars.map((c) => {
      const rels = b.relations
        .filter((r) => (r.from === c.id || r.to === c.id) && !relLocked(r) && relVisibleAt(r) && relVisible(r))
        .sort((x, y) => nodeDegree(y.from === c.id ? y.to : y.from) - nodeDegree(x.from === c.id ? x.to : x.from));
      const relHtml = rels.map((r) => {
        const other = r.from === c.id ? r.to : r.from;
        const evs = visibleRelEvents(r).map((e) => `${e.text}${e.chapter ? `（${e.chapter}）` : ''}`).join('；');
        const period = periodText(r) ? `〔${periodText(r)}〕` : '';
        return `<li><b>${esc(charName(other))}</b> — ${esc(r.type)}${period}${evs ? `　依据：${evs}` : ''}</li>`;
      }).join('');
      const life = b.events
        .filter((e) => (e.chars || []).includes(c.id) && !eventLocked(e) && eventVisibleAt(e))
        .sort((x, y) => (x.ch || 0) - (y.ch || 0))
        .map((e) => `<li>第 ${e.ch ?? '?'} 章《${esc(e.name)}》：${esc(e.summary)}</li>`)
        .join('');
      return `<section class="char">
  <h2>${esc(c.name)}</h2>
  <p class="meta">${esc([factionTextOf(c), c.gender === 'f' ? '女' : '男', c.title, `第 ${charCh(c)} 章出场`].filter(Boolean).join(' · '))}</p>
  ${(c.aliases || []).length ? `<p class="meta">别名：${esc(c.aliases.join('，'))}</p>` : ''}
  ${c.desc ? `<p>${esc(c.desc)}</p>` : ''}
  <p class="meta">结局：${fateLocked(c) ? '（在你读到的进度之后）' : esc(c.fate || '—')}</p>
  ${life ? `<h3>他/她的一生（按章）</h3><ul>${life}</ul>` : ''}
  ${relHtml ? `<h3>与谁有关 · 凭什么事件</h3><ul>${relHtml}</ul>` : ''}
</section>`;
    }).join('\n');

    // 3) 事件轴（按阶段；锁着的跳过）
    const phases = [...(b.phases || [])].sort((x, y) => x.order - y.order);
    const evHtml = phases.map((p) => {
      const evs = b.events.filter((e) => e.phase === p.id && !eventLocked(e) && eventVisibleAt(e)).sort((x, y) => x.order - y.order);
      if (!evs.length) return '';
      return `<h2>${esc(p.name)}</h2>` + evs.map((e) => `<section class="ev">
  <h3>第 ${e.ch ?? '?'} 章 · ${esc(e.name)}</h3>
  <p>${esc(e.summary)}</p>
  ${e.impact ? `<p class="meta">影响：${esc(e.impact)}</p>` : ''}
  ${e.place ? `<p class="meta">地点：${esc(placeName(e.place))}</p>` : ''}
  <p class="meta">涉及：${esc((e.chars || []).map(charName).join('、'))}</p>
  ${e.quote ? `<blockquote>「${esc(e.quote)}」</blockquote>` : ''}
</section>`).join('\n');
    }).join('\n');

    const stats = `显示 ${chars.length} / ${b.characters.length} 人 · ${b.relations.length} 段关系 · ${b.events.length} 个事件`;
    const pages = {
      'cover.xhtml': epubPage('封面', `<div class="cover">
  <h1>${esc(title)}</h1>
  <p class="meta">${esc(m.author || '')} · ${esc(stats)}</p>
  <p>把这本书的人物关系、定义关系的小事件与标志性事件，整理成一份<b>可以放在手边</b>的小册子。</p>
  <p class="meta">不含原著正文 · 阅读辅助用途 · 数据 CC BY-SA 4.0 · 由「书脉 BookAtlas」生成于 ${dateStr} ${esc(progNote)}</p>
</div>`),
      'howto.xhtml': epubPage('怎么用', `<h1>怎么用这份伴侣</h1>
<ol>
  <li><b>配合原著读</b>：在微信读书里把这份文件当作一本"配套小册子"（传书导入后与原著并排读）。</li>
  <li><b>剧透保护</b>：这份文件<b>跟随导出时的阅读进度</b>——之后的剧情没写进来。读到后面想更新，回网页版/小程序再导出一次即可。</li>
  <li><b>关系总图</b>：下一节的图是全书关系网络（放大看）；每段关系的<b>依据事件</b>写在人物志里。</li>
  <li><b>想按进度解锁、查两人关系、看时间旅行</b>：用在线版 <b>${esc(SITE_URL)}</b> 或微信小程序（同一个数据，可按章解锁）。</li>
</ol>`),
      'graph.xhtml': epubPage('关系总图', `<h1>关系总图</h1>
<p class="meta">${esc(stats)}${state.progress === null ? '' : ` · 剧透保护读到第 ${state.progress} 章`}</p>
<div class="fig"><img src="${imgName}" alt="人物关系图"/></div>
<p class="meta">${esc((b.factions || []).map((x) => x.name).join(' / '))}</p>`),
      'characters.xhtml': epubPage('人物志', `<h1>人物志（按出场章排序）</h1>${charHtml || '<p>（暂无可写的人物）</p>'}`),
      'events.xhtml': epubPage('事件轴', `<h1>重大事件轴</h1>${evHtml || '<p>（暂无可写的事件）</p>'}`),
    };

    // 4) 打包（mimetype 必须第一个、且不压缩）
    const css = `body{font-family:serif;line-height:1.7;margin:1em}h1{font-size:1.5em}h2{font-size:1.2em;margin-top:1.4em;border-bottom:1px solid #ddd}h3{font-size:1.05em;margin-top:1em}.meta{color:#666;font-size:.9em}ul{padding-left:1.2em}li{margin:.3em 0}.fig{text-align:center}.fig img{max-width:100%}blockquote{margin:.6em 0;padding-left:.8em;border-left:3px solid #ccc;color:#555}.cover{margin-top:3em;text-align:center}.char,.ev{margin-bottom:1.2em}`;
    const files = {
      'mimetype': [f.strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': f.strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
      'OEBPS/content.opf': f.strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${esc(title)}</dc:title>
    <dc:creator>书脉 BookAtlas</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="bookid">bookatlas-${esc(slugOf())}-${dateStr}</dc:identifier>
    <dc:rights>整理数据 CC BY-SA 4.0 · 不含原著正文</dc:rights>
    <dc:description>${esc(m.author || '')} · ${esc(stats)}</dc:description>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="graph" href="${imgName}" media-type="${imgMime}"/>
${Object.keys(pages).map((p, i) => `    <item id="p${i}" href="${p}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
${Object.keys(pages).map((p, i) => `    <itemref idref="p${i}"/>`).join('\n')}
  </spine>
</package>`),
      'OEBPS/toc.ncx': f.strToU8(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="bookatlas-${esc(slugOf())}"/></head>
  <docTitle><text>${esc(title)}</text></docTitle>
  <navMap>
${Object.keys(pages).map((p, i) => `    <navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${esc(['封面', '怎么用', '关系总图', '人物志', '事件轴'][i] || p)}</text></navLabel><content src="${p}"/></navPoint>`).join('\n')}
  </navMap>
</ncx>`),
      'OEBPS/style.css': f.strToU8(css),
      ['OEBPS/' + imgName]: dataUrlToBytes(img.dataUrl),
    };
    for (const [name, html] of Object.entries(pages)) files['OEBPS/' + name] = f.strToU8(html);
    const bytes = f.zipSync(files, { level: 6 });
    return { bytes, pages: Object.keys(pages).length, chars: chars.length, imgW: img.width, imgH: img.height };
  }

  async function runExport(kind) {
    if (!state.book) return;
    const hint = document.getElementById('export-hint');
    const say = (t) => { if (hint) hint.textContent = t; };
    const btn = document.querySelector(`[data-export="${kind}"]`);
    if (btn) btn.disabled = true;
    try {
      if (kind === 'json') {
        downloadText(`${slugOf()}.json`, JSON.stringify(state.book, null, 2), 'application/json');
        say('已导出数据 JSON。');
      } else if (kind === 'html') {
        say('正在打包单文件（含图表库，几个 MB，稍等）…');
        const html = await buildStandaloneHtml();
        downloadText(`${titleOf()}-书脉.html`, html, 'text/html');
        say(`已导出单文件 HTML（${(html.length / 1048576).toFixed(1)} MB）—— 发给别人，双击就能看。`);
      } else if (kind === 'png') {
        say('正在生成分享图…');
        const url = await buildSharePng();
        if (!url) { say('画布还没准备好，稍等一下再试。'); return; }
        const a = document.createElement('a');
        a.href = url; a.download = `${titleOf()}-关系图.png`;
        document.body.appendChild(a); a.click(); a.remove();
        say('已导出分享图 PNG。');
      } else if (kind === 'svg') {
        const svg = buildPrintSvg();
        if (!svg) { say('布局还没准备好：先在图上点一下（或等布局跑完）再试。'); return; }
        downloadText(`${titleOf()}-关系图-A3.svg`, svg, 'image/svg+xml');
        say('已导出打印版 SVG —— 用浏览器打开后可「打印 → 另存为 PDF」。');
      } else if (kind === 'epub') {
        say('正在打包阅读伴侣（含关系总图，稍等）…');
        const res = await buildCompanionEpub();
        downloadBlob(`${titleOf()}-阅读伴侣.epub`, new Blob([res.bytes], { type: 'application/epub+zip' }));
        say(`已导出 EPUB（${Math.round(res.bytes.length / 1024)} KB · ${res.pages} 节 · ${res.chars} 人 · 图 ${res.imgW}×${res.imgH}）—— 传进微信读书：用「传书到手机」或文件传输助手导入。`);
      }
    } catch (e) {
      say('导出失败：' + ((e && e.message) || e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ---------------- 剧透保护 UI ---------------- */
  function syncSpoilerButton() {
    const btn = document.getElementById('spoiler-btn');
    if (!btn) return;
    btn.textContent = state.progress === null ? '🔓 剧透保护：关' : `🔒 剧透保护：读到第 ${state.progress} 章`;
  }

  function openSpoilerModal() {
    const modal = document.getElementById('spoiler-modal');
    if (!modal || !state.book) return;
    const sel = document.getElementById('spoiler-ch');
    const total = maxChapter() || 20;
    sel.innerHTML = Array.from({ length: total }, (_, i) => `<option value="${i + 1}">第 ${i + 1} 章</option>`).join('');
    if (state.progress) sel.value = String(state.progress);
    modal.hidden = false;
  }

  function closeSpoilerModal() {
    const modal = document.getElementById('spoiler-modal');
    if (modal) modal.hidden = true;
  }

  function applySpoiler(on, ch) {
    closeSpoilerModal();
    state.progress = on ? ch : null;
    if (state.timeTravel) state.chapter = Math.min(state.chapter, timeCeiling());
    const slug = state.book?.meta?.slug || 'book';
    try {
      localStorage.setItem('ba-spoiler-' + slug, JSON.stringify(on ? { on: true, ch } : { on: false }));
    } catch (e) { /* 隐私模式忽略 */ }
    try {
      clearHighlight(false);
      renderDatalist();
      renderPathSelects();
      renderTimeline();
      renderChapter();
      syncTimeTravelUI();
      renderPlaceSelect();
      renderPanelWelcome();
      initChart();
    } catch (e) {
      console.warn('applySpoiler:', e);
    }
    syncSpoilerButton();
  }

  /* ---------------- 搜索 / 主题 / 事件绑定 ---------------- */
  /* ---------------- 使用说明的「试一下」：直接用当前这本书在图上演示 ---------------- */
  function runHelpAct(act) {
    if (!state.book || !state.chart) return;
    const ranked = (n) => (state.book.characters || []).slice().sort((a, b) => nodeDegree(b.id) - nodeDegree(a.id))[n] || null;
    const hub = ranked(0);
    const hubId = hub && hub.id;
    switch (act) {
      case 'open':
        if (hubId) selectCharacter(hubId);
        break;
      case 'search': {
        if (!hub) break;
        const q = (hub.aliases && hub.aliases.length) ? hub.aliases[0] : hub.name;
        const inp = document.getElementById('search-input');
        if (inp) { inp.value = q; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }
        break;
      }
      case 'size':
        applySizeFilter(state.sizeFilter === 'main' ? 'all' : 'main');
        break;
      case 'focus':
        if (hubId) applyFocus(hubId, 1);
        break;
      case 'zoom': {
        if (!hubId) break;
        const p = state.pos.get(hubId);
        applyZoom(Math.min(40, 1 / (Math.abs(state.fitLast) || 1)), p ? [p.x, p.y] : [0, 0]);
        break;
      }
      case 'place': {
        const used = new Map();
        for (const e of state.book.events) if (e.place && !eventLocked(e)) used.set(e.place, (used.get(e.place) || 0) + 1);
        for (const r of state.book.relations) for (const ev of r.events || []) if (ev.place) used.set(ev.place, (used.get(ev.place) || 0) + 1);
        const best = [...used.entries()].sort((a, b) => b[1] - a[1])[0];
        if (best) applyPlaceFilter(best[0]);
        break;
      }
      case 'spoiler': {
        const m = document.getElementById('spoiler-modal');
        if (m) m.hidden = false;
        break;
      }
      case 'path': {
        if (!hubId) break;
        const other = (state.adj.get(hubId) || []).map((e) => e.to).sort((x, y) => nodeDegree(y) - nodeDegree(x))[0];
        const pa = document.getElementById('path-a'), pb = document.getElementById('path-b');
        if (other && pa && pb) { pa.value = hubId; pb.value = other; runPath(); }
        break;
      }
      case 'layout': {
        const order = ['force', 'gen-h', 'gen-v'];
        setView(order[(order.indexOf(state.view) + 1) % order.length]);
        break;
      }
      case 'drag': {
        // 演示"拖出去 + 散线"：先把拖动开关打开（否则用户接着拖会发现拖不动）
        state.nodeDrag = true;
        const dragBtn = document.getElementById('drag-btn');
        if (dragBtn) dragBtn.textContent = '拖动节点：开';
        if (!state.frozen) freezeNow();
        if (hubId) nudgeNode(hubId, 80, -52);
        break;
      }
      case 'derived': {
        state.showDerived = !state.showDerived;
        try { localStorage.setItem('ba-derived', state.showDerived ? '1' : '0'); } catch (e) { /* 忽略 */ }
        const btn = document.getElementById('derived-btn');
        if (btn) btn.textContent = state.showDerived ? '族谱补全：显示' : '族谱补全：隐藏';
        if (state.chart) { freezeNow(); state.chart.setOption(buildOption({ keepView: true })); }
        refreshPanel();
        updateCountHint();
        break;
      }
      case 'chapter':
        goChapter(1);
        break;
      case 'export': {
        const m = document.getElementById('export-modal');
        if (m) { m.hidden = false; const h = document.getElementById('export-hint'); if (h) h.textContent = ''; }
        break;
      }
      case 'edge': {
        state.edgeKins = new Set(['blood', 'marriage', 'adopt', 'sworn']);
        state.edgeStyles = new Set();
        applyEdgeFilter();
        break;
      }
      case 'charcard': {
        const hub = (state.book.characters || []).slice().sort((a, b) => nodeDegree(b.id) - nodeDegree(a.id))[0];
        if (hub) selectCharacter(hub.id);
        break;
      }
      case 'ai':
        openAiModal();
        break;
    }
  }

  function bindUI() {
    const search = $('#search-input');
    const doSearch = () => {
      const q = search.value.trim();
      if (!q) return;
      const match = (x) => x.name === q || (x.aliases || []).includes(q) || x.name.includes(q) || (x.aliases || []).some((a) => a.includes(q));
      const c = state.book.characters.find((x) => !charLocked(x) && !isCharHidden(x) && match(x));
      if (c) { selectCharacter(c.id); return; }
      const hiddenHit = state.book.characters.find((x) => isCharHidden(x) && match(x));
      if (hiddenHit) {                                  // 被折叠的人：自动展开层级再定位（搜索永远找得到）
        if (isMinor(hiddenHit)) { state.showMinor = true; try { localStorage.setItem('ba-minor', '1'); } catch (e) { /* 忽略 */ } }
        if (isMentioned(hiddenHit)) { state.showMentioned = true; try { localStorage.setItem('ba-mentioned', '1'); } catch (e) { /* 忽略 */ } }
        const minorBtn2 = document.getElementById('minor-btn');
        if (minorBtn2) minorBtn2.textContent = state.showMinor ? '次要人物：显示' : '次要人物：隐藏';
        const mentionBtn2 = document.getElementById('mentioned-btn');
        if (mentionBtn2) mentionBtn2.textContent = state.showMentioned ? '提及人物：显示' : '提及人物：隐藏';
        renderDatalist();
        renderPathSelects();
        updateCountHint();
        if (state.chart) state.chart.setOption(buildOption({ keepView: true }));
        selectCharacter(hiddenHit.id);
        return;
      }
      const lockedHit = state.book.characters.find((x) => charLocked(x) && match(x));
      $('#path-hint').textContent = lockedHit ? `「${q}」还没到你读到的进度（剧透保护中）` : `没找到「${q}」`;
    };
    search.addEventListener('change', doSearch);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    $('#search-clear').addEventListener('click', () => { search.value = ''; clearHighlight(); });

    const labelBtn = $('#label-btn');
    labelBtn.addEventListener('click', () => {
      state.allLabels = !state.allLabels;
      labelBtn.textContent = state.allLabels ? '标签：全部' : '标签：主要';
      if (!state.allLabels) computeLabels();
      if (state.chart) state.chart.setOption(buildOption({ keepView: true }));
    });

    const placeSel = document.getElementById('place-filter');
    if (placeSel) placeSel.addEventListener('change', () => applyPlaceFilter(placeSel.value || null));

    // 人数过滤（大书：只看主要人物）
    const sizeSel = document.getElementById('size-filter');
    if (sizeSel) {
      sizeSel.value = state.sizeFilter;
      sizeSel.addEventListener('change', () => applySizeFilter(sizeSel.value));
    }

    // 聚焦条 / 聚焦按钮（事件委托，面板和聚焦条都能点）
    document.addEventListener('click', (ev) => {
      const go = ev.target.closest('[data-focus-node]');
      if (go) { applyFocus(go.dataset.focusNode, Number(go.dataset.focusDepth || 1)); return; }
      const nav = ev.target.closest('[data-focus-nav]');
      if (nav && state.focus) { applyFocus(state.focus.id, state.focus.depth + (nav.dataset.focusNav === 'inc' ? 1 : -1)); return; }
      if (ev.target.closest('[data-focus-exit]')) applyFocus(null, 1);
    });

    const mentionBtn = document.getElementById('mentioned-btn');
    const syncMentionBtn = () => { if (mentionBtn) mentionBtn.textContent = state.showMentioned ? '提及人物：显示' : '提及人物：隐藏'; };
    if (mentionBtn) mentionBtn.addEventListener('click', () => {
      state.showMentioned = !state.showMentioned;
      try { localStorage.setItem('ba-mentioned', state.showMentioned ? '1' : '0'); } catch (e) { /* 忽略 */ }
      syncMentionBtn();
      renderDatalist();
      renderPathSelects();
      if (state.chart) { freezeNow(); state.chart.setOption(buildOption({ keepView: true })); }
      updateCountHint();
    });
    syncMentionBtn();

    // 次要人物折叠（大书默认收起）
    const minorBtn = document.getElementById('minor-btn');
    const syncMinorBtn = () => { if (minorBtn) minorBtn.textContent = state.showMinor ? '次要人物：显示' : '次要人物：隐藏'; };
    if (minorBtn) minorBtn.addEventListener('click', () => {
      state.showMinor = !state.showMinor;
      try { localStorage.setItem('ba-minor', state.showMinor ? '1' : '0'); } catch (e) { /* 忽略 */ }
      syncMinorBtn();
      renderDatalist();
      renderPathSelects();
      if (state.chart) { freezeNow(); state.chart.setOption(buildOption({ keepView: true })); }
      refreshPanel();
      updateCountHint();
    });
    syncMinorBtn();

    // 族谱补全（推导出来的祖孙/叔侄连线）
    const derivedBtn = document.getElementById('derived-btn');
    const syncDerivedBtn = () => { if (derivedBtn) derivedBtn.textContent = state.showDerived ? '族谱补全：显示' : '族谱补全：隐藏'; };
    if (derivedBtn) derivedBtn.addEventListener('click', () => {
      state.showDerived = !state.showDerived;
      try { localStorage.setItem('ba-derived', state.showDerived ? '1' : '0'); } catch (e) { /* 忽略 */ }
      syncDerivedBtn();
      syncEdgeFilterUI();
      if (state.chart) { freezeNow(); state.chart.setOption(buildOption({ keepView: true })); }
      refreshPanel();
      updateCountHint();
    });
    syncDerivedBtn();

    // 显示设置（色盲友好配色 / 字号）
    const dispPanel = document.getElementById('display-panel');
    if (dispPanel) {
      document.addEventListener('click', (ev) => {
        if (ev.target.closest('#display-btn')) { dispPanel.hidden = !dispPanel.hidden; return; }
        if (!dispPanel.hidden && !ev.target.closest('#display-panel')) dispPanel.hidden = true;
        const pal = ev.target.closest('[data-palette]');
        if (pal) { state.a11yPalette = pal.dataset.palette === 'a11y'; applyDisplay(); return; }
        const fnt = ev.target.closest('[data-font]');
        if (fnt) { state.fontSize = fnt.dataset.font; applyDisplay(); }
      });
    }

    // 关系过滤（边的类型）：亲缘桶 + 线条样式 + 快捷预设
    const epPanel = document.getElementById('edge-filter-panel');
    if (epPanel) {
      document.addEventListener('click', (ev) => {
        if (ev.target.closest('#edge-filter-btn')) { epPanel.hidden = !epPanel.hidden; return; }
        if (!epPanel.hidden && !ev.target.closest('#edge-filter-panel')) epPanel.hidden = true;
        const kin = ev.target.closest('[data-edge-kin]');
        if (kin) {
          if (kin.checked) state.edgeKins.add(kin.dataset.edgeKin); else state.edgeKins.delete(kin.dataset.edgeKin);
          applyEdgeFilter();
          return;
        }
        const st = ev.target.closest('[data-edge-style]');
        if (st) {
          if (st.checked) state.edgeStyles.add(st.dataset.edgeStyle); else state.edgeStyles.delete(st.dataset.edgeStyle);
          applyEdgeFilter();
          return;
        }
        const pre = ev.target.closest('[data-edge-preset]');
        if (pre) {
          const k = pre.dataset.edgePreset;
          if (k === 'kin') { state.edgeKins = new Set(['blood', 'marriage', 'adopt', 'sworn']); state.edgeStyles = new Set(); }
          else if (k === 'enemy') { state.edgeStyles = new Set(['dashed']); state.edgeKins = new Set(); }
          else { state.edgeStyles = new Set(); state.edgeKins = new Set(); }
          applyEdgeFilter();
          return;
        }
        if (ev.target.closest('[data-edge-reset]')) {
          state.edgeStyles = new Set(); state.edgeKins = new Set();
          applyEdgeFilter();
        }
      });
    }
    const derivedBox = document.getElementById('edge-derived');
    if (derivedBox) derivedBox.addEventListener('change', () => {
      state.showDerived = derivedBox.checked;
      try { localStorage.setItem('ba-derived', state.showDerived ? '1' : '0'); } catch (e) { /* 忽略 */ }
      syncDerivedBtn();
      if (state.chart) { freezeNow(); state.chart.setOption(buildOption({ keepView: true })); }
      refreshPanel();
      updateCountHint();
    });

    // 人物卡 PNG（面板里「🖼 人物卡」）
    document.addEventListener('click', async (ev) => {
      const card = ev.target.closest('[data-char-card]');
      if (!card) return;
      const id = card.dataset.charCard;
      card.disabled = true;
      try {
        const url = await buildCharacterPng(id);
        if (!url) { toast('这张卡暂时生成不了'); return; }
        const a = document.createElement('a');
        a.href = url; a.download = `${charName(id)}-人物卡.png`;
        document.body.appendChild(a); a.click(); a.remove();
        toast(`已导出「${charName(id)}」人物卡`);
      } catch (e) {
        toast('导出失败：' + ((e && e.message) || e));
      } finally {
        card.disabled = false;
      }
    });

    document.querySelectorAll('.seg').forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    });
    $('#reset-btn').addEventListener('click', () => setView(state.view));
    $('#view-reset-btn').addEventListener('click', resetRoam);
    const zoomOne = document.getElementById('zoom-one-btn');
    if (zoomOne) zoomOne.addEventListener('click', () => {
      if (!state.chart) return;
      // 世界坐标是 1:1 的：最近一次 fit 的缩放是 state.fitLast，跳到 1/它 就是"节点原始大小"
      const target = Math.min(40, 1 / (Math.abs(state.fitLast) || 1));
      const sel = state.panelKind === 'char' && state.panelId ? state.pos.get(state.panelId) : null;
      // 没选人时对准"关系最多的那个人"（hub）——几何中心在大书上往往是空的
      if (!state.hubId) {
        const hub = (state.book.characters || []).slice().sort((a, b) => nodeDegree(b.id) - nodeDegree(a.id))[0];
        state.hubId = hub && hub.id;
      }
      const hub = state.hubId ? state.pos.get(state.hubId) : null;
      applyZoom(target, sel ? [sel.x, sel.y] : (hub ? [hub.x, hub.y] : [0, 0]));
    });
    const dragBtn = $('#drag-btn');
    dragBtn.addEventListener('click', () => {
      state.nodeDrag = !state.nodeDrag;
      dragBtn.textContent = state.nodeDrag ? '拖动节点：开' : '拖动节点：关';
      resetRoam();
    });

    // 使用说明面板（每条都能在图上真演示一遍）
    const helpModal = document.getElementById('help-modal');
    const closeHelp = () => { if (helpModal) helpModal.hidden = true; };
    const helpBtn = document.getElementById('help-btn');
    if (helpBtn && helpModal) helpBtn.addEventListener('click', () => { helpModal.hidden = false; helpModal.querySelector('.modal').scrollTop = 0; });
    if (helpModal) {
      helpModal.addEventListener('click', (ev) => {
        if (ev.target === helpModal || ev.target.closest('[data-help-close]')) closeHelp();
      });
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !helpModal.hidden) closeHelp(); });
      helpModal.querySelectorAll('[data-help-act]').forEach((btn) => btn.addEventListener('click', () => {
        runHelpAct(btn.dataset.helpAct);
        closeHelp();
      }));
    }

    document.addEventListener('click', (ev) => {
      if (ev.target.closest('#spoiler-off') || ev.target.closest('#spoiler-close')) { applySpoiler(false); return; }
      if (ev.target.closest('#spoiler-on')) {
        const ch = Number(document.getElementById('spoiler-ch')?.value) || 1;
        applySpoiler(true, ch);
        return;
      }
      if (ev.target.closest('#spoiler-btn')) openSpoilerModal();
    });
    document.addEventListener('keydown', (ev) => {
      const modal = document.getElementById('spoiler-modal');
      if (ev.key === 'Escape' && modal && !modal.hidden) applySpoiler(false);
    });

    // 长列表「展开/收起」（document 级委托：面板都是 innerHTML 重建的）
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-fold]');
      if (!btn) return;
      const sec = btn.closest('.fold');
      if (!sec) return;
      const key = sec.dataset.foldKey;
      const n = Number(sec.dataset.n) || 6;
      const foldBody = sec.querySelector('.fold-body');
      const total = foldBody ? foldBody.children.length : 0;
      const shown = Math.min(Math.max(state.fold[key] || n, n), total);
      const act = btn.dataset.foldAct;
      if (act === 'collapse') {
        delete state.fold[key];
        applyFolds(sec);
        sec.scrollIntoView({ block: 'nearest' });   // 收起后段首回到视野，人不丢
      } else if (act === 'all') {
        state.fold[key] = total;
        applyFolds(sec);
      } else {
        state.fold[key] = Math.min(shown + FOLD_BATCH, total);
        applyFolds(sec);
      }
    });

    $('#path-go').addEventListener('click', runPath);
    $('#path-clear').addEventListener('click', () => {
      $('#path-a').value = ''; $('#path-b').value = '';
      $('#path-hint').textContent = '';
      clearHighlight();
    });

    // 章节视图：翻章 / 跳章（左右方向键也能翻）
    const chPrev = document.getElementById('ch-prev');
    const chNext = document.getElementById('ch-next');
    const chSel = document.getElementById('ch-select');
    if (chPrev) chPrev.addEventListener('click', () => goChapter(state.chapter - 1));
    if (chNext) chNext.addEventListener('click', () => goChapter(state.chapter + 1));
    if (chSel) chSel.addEventListener('change', () => goChapter(Number(chSel.value)));

    // 时间旅行：把图谱拨回第 N 章（滑块拖动时节流重绘）
    const timeBtn = document.getElementById('time-btn');
    const timeSlider = document.getElementById('time-slider');
    if (timeBtn) timeBtn.addEventListener('click', () => {
      state.timeTravel = !state.timeTravel;
      if (state.timeTravel) state.chapter = Math.min(state.chapter, timeCeiling());
      applyTimeTravel();
    });
    if (timeSlider) {
      let sliderTimer = null;
      timeSlider.addEventListener('input', () => {
        state.chapter = Math.max(1, Math.min(maxChapter() || 1, Number(timeSlider.value) || 1));
        try { localStorage.setItem('ba-chapter-' + (state.book?.meta?.slug || 'book'), String(state.chapter)); } catch (e) { /* 忽略 */ }
        syncTimeTravelUI();
        renderChapter();
        clearTimeout(sliderTimer);
        sliderTimer = setTimeout(() => {
          applyTimeTravelGraph();
          renderDatalist();
          renderPathSelects();
          renderTimeline();
          renderPlaceSelect();
          updateCountHint();
          refreshPanel();
        }, 90);
      });
    }
    document.addEventListener('keydown', (ev) => {
      if (ev.target && /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) return;
      const modalOpen = ['#export-modal', '#spoiler-modal', '#help-modal', '#ai-modal'].some((s) => {
        const el = document.querySelector(s); return el && !el.hidden;
      });
      if (modalOpen) return;
      const graphEl = document.getElementById('graph');
      const onGraph = graphEl && document.activeElement === graphEl;
      if (onGraph) {
        // 图聚焦时：方向键在人物间移动、回车看档案、Esc 取消选中
        if (/^Arrow(Left|Right|Up|Down)$/.test(ev.key)) { ev.preventDefault(); moveCursor(ev.key); return; }
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          if (state.kbCursor) selectCharacter(state.kbCursor);
          return;
        }
        if (ev.key === 'Escape') { state.kbCursor = null; clearHighlight(); updateAria(); return; }
        return;
      }
      if (ev.key === 'ArrowLeft') goChapter(state.chapter - 1);
      if (ev.key === 'ArrowRight') goChapter(state.chapter + 1);
    });
    // 点一下图就聚焦它，之后方向键直接可用
    const graphEl = document.getElementById('graph');
    if (graphEl) graphEl.addEventListener('mousedown', () => { try { graphEl.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ } });

    // 导出 / 分享
    const exportModal = document.getElementById('export-modal');
    const closeExport = () => { if (exportModal) exportModal.hidden = true; };
    if (exportModal) {
      document.addEventListener('click', (ev) => {
        if (ev.target.closest('#export-btn')) {
          exportModal.hidden = false;
          const h = document.getElementById('export-hint'); if (h) h.textContent = '';
          return;
        }
        if (ev.target.closest('[data-export-close]') || ev.target === exportModal) { closeExport(); return; }
        const opt = ev.target.closest('[data-export]');
        if (opt && !opt.disabled) runExport(opt.dataset.export);
      });
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !exportModal.hidden) closeExport(); });
    }

    // AI 讲解（不剧透）
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-ai-settings]')) { openAiModal(); return; }
      if (ev.target.closest('[data-ai-close]')) { const m = document.getElementById('ai-modal'); if (m) m.hidden = true; return; }
      if (ev.target.closest('#ai-save')) { saveAiConfig(); return; }
      const btn = ev.target.closest('[data-ai]');
      if (!btn) return;
      if (btn.dataset.ai === 'chain') {
        const a = $('#path-a').value, b = $('#path-b').value;
        if (!a || !b) { toast('先在底部选两个人'); return; }
        const steps = bfs(a, b);
        if (!steps) { toast('在图里找不到通路'); return; }
        aiExplain('chain', steps);
      } else if (btn.dataset.ai === 'char') {
        const c = state.byId.get(btn.dataset.id || '');
        if (c) aiExplain('char', c);
      }
    });
    const aiModal = document.getElementById('ai-modal');
    if (aiModal) document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !aiModal.hidden) aiModal.hidden = true; });

    const themeBtn = $('#theme-btn');
    const setTheme = (dark) => {
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      themeBtn.textContent = dark ? '☀️ 日间' : '🌙 夜间';
      localStorage.setItem('ba-theme', dark ? 'dark' : 'light');
      if (state.chart) state.chart.setOption(buildOption({ keepView: true }));
    };
    themeBtn.addEventListener('click', () => setTheme(document.documentElement.dataset.theme !== 'dark'));
    setTheme(localStorage.getItem('ba-theme') === 'dark');
  }

  /* ---------------- 启动 ---------------- */
  if (window.__BA_STANDALONE) {
    const eb = document.getElementById('export-btn');
    if (eb) eb.hidden = true;      // 单文件版：再导出会依赖 index.html / 资源，直接藏掉
  }
  bindUI();
  boot();

  // 调试/自动化用的只读入口（控制台里可以查状态、也能脚本化聚焦与过滤）
  window.__ba = {
    state,
    chart: () => state.chart,
    applyFocus: (id, depth) => applyFocus(id, depth),
    applySizeFilter: (v) => applySizeFilter(v),
    computeLabels: (z) => computeLabels(z),
    selectCharacter: (id) => selectCharacter(id),
    selectRelation: (a, b) => { const r = findRel(a, b); if (r) selectRelation(r); return !!r; },
    nodeCount: () => (state.chart ? state.chart.getOption().series[0].data.filter((d) => !String(d.id).startsWith('__gen_')).length : 0),
    labelCount: () => (state.chart ? state.chart.getOption().series[0].data.filter((d) => d.label && d.label.show).length : 0),
    goChapter: (n) => goChapter(n),
    chapterDigest: (n) => chapterDigest(n),
    asOf: () => asOf(),
    setTimeTravel: (on, ch) => {
      state.timeTravel = !!on;
      if (typeof ch === 'number') state.chapter = ch;
      applyTimeTravel();
      return { on: state.timeTravel, chapter: state.chapter };
    },
    exportSelection: () => exportSelection(),
    buildStandaloneHtml: () => buildStandaloneHtml(),
    buildSharePng: () => buildSharePng(),
    buildPrintSvg: () => buildPrintSvg(),
    buildCharacterPng: (id) => buildCharacterPng(id),
    buildCompanionEpub: () => buildCompanionEpub(),
    aiConfig: () => aiConfig(),
    aiPrompt: (kind, payload) => aiPrompt(kind, payload),
    aiExplain: (kind, payload) => aiExplain(kind, payload),
    bfs: (a, b) => bfs(a, b),
    applyEdgeFilter: (styles, kins) => {
      state.edgeStyles = new Set(styles || []);
      state.edgeKins = new Set(kins || []);
      applyEdgeFilter();
    },
    edgeFilter: () => ({ styles: [...state.edgeStyles], kins: [...state.edgeKins] }),
    moveCursor: (key) => { moveCursor(key); return state.kbCursor; },
    kbCursor: () => state.kbCursor,
    ariaLabel: () => graphAriaLabel(),
    announce: (m) => announce(m),
    setPalette: (on) => { state.a11yPalette = !!on; applyDisplay(); return state.a11yPalette; },
    setFontSize: (s) => { state.fontSize = ['s', 'm', 'l'].includes(s) ? s : 'm'; applyDisplay(); return state.fontSize; },
    fontScale: () => fontScale(),
    runExport: (kind) => runExport(kind),
  };

  if (!window.__BA_STANDALONE && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
