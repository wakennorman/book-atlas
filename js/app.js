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
    clickLock: null,       // 点击锁定：搜单个人物 / 两人关系查询后 = { nodes, edges, label }；图上只能点高亮集合
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
    pxScale: 1,              // 真实尺度：1 个世界单位 = 多少像素（zoom=1）。fitPositions 算。
                             // ⚠ 不是 state.zoom、也不是 state.fitLast —— ECharts 会把数据包围盒
                             //   等比塞进画布再乘 zoom，只有这个是真实的（memory/echarts-graph-auto-fits-data-bbox.md）
    viewCenter: [0, 0],      // 视角中心（graph series 的 center；0,0 = 节点云中心）
    labelTimer: null,
    fold: {},                // 长列表折叠：key -> 当前显示条数（缺省＝默认收起）
    relChMap: null,          // 关系对象 -> 解锁章（loadBook 时一次算好；relCh() 查它）
    charLastChMap: null,     // 人物 id -> 最后出场章（同上；charLastCh() 查它）
    chartObserver: null,     // 当前 chart 的 ResizeObserver（v85：initChart 重跑时要解绑上一个）
    chartResizeHandler: null,// 对应的 window resize 回调（同上）
    legendEls: null,         // .legend-item 的缓存 NodeList（v85：见 legendItems()）
    chipEls: null,           // .event-chip 的缓存 NodeList（同上）
    loadSeq: 0,              // v85：loadBook 的请求序号，快速切书时用来丢弃过期响应
    textStatus: null,        // v85：文案包状态 { slug, status: 'idle'|'done'|'failed' }，**按书记**
    relIndexOf: null,      // v88：关系对象 → relations 下标，给图上每条线做身份标识（见 findRel）
    relIdxBook: null,      // v88：relIndexOf 是按哪本书建的缓存（换书要重建）
  };

  /* ---------------- 工具 ---------------- */
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ---------------- 文案包：图画完之后空闲时预取，回来再贴回 state.book ----------------
   * v85。刻意**不**在点开人物时才去拉 —— 那会让第一次点击的面板先空一下。
   * 空闲预取的话，多数情况下用户还没点，文案就已经在本地了。
   * 贴回之后只刷新当前可见的东西（面板 / 事件轴 / tooltip 文案），不重建图。 */
  function attachText(slug, text) {
    if (!state.book || state.book.meta?.slug !== slug) return;
    if (state.textStatus && state.textStatus.slug === slug && state.textStatus.status !== 'idle') return;
    state.textStatus = { slug, status: 'done' };
    const b = state.book;
    for (const c of b.characters) Object.assign(c, text.characters?.[c.id] || {});
    for (const e of b.events) Object.assign(e, text.events?.[e.id] || {});
    b.relations.forEach((r, i) => {
      const src = text.relEvents?.[i];
      if (!src || !r.events) return;
      for (const t of src) {
        const j = t.i;
        if (j < 0 || j >= r.events.length) continue;
        if (t.t) r.events[j].text = t.t;
        if (t.q) r.events[j].quote = t.q;
      }
    });
    // 文案影响的是面板里的文字与 tooltip，不影响节点/连线 ⇒ 不需要重画整张图
    try {
      refreshPanel();
      renderTimeline();
      updateCountHint();
      if (state.chart) state.chart.setOption(buildOption({ keepView: true }));
    } catch (e) { /* 文案刷新失败不影响图本身 */ }
  }

  /* v85：文案状态**按书记**，不能是全局一个标志。
   * 原来是 state.textLoaded（true / 'failed' 两个值），问题在于：
   *   ① 'failed' 是 truthy ⇒ 前一本书的文案拉取失败后，新一本书的文案会被 attachText
   *      的 `|| state.textLoaded` 直接挡掉，整本书的描述/结局/摘要**永远空白**，
   *      而且没有任何提示，用户只看到一个"描述都是空的"的应用。
   *   ② 失败时没有 slug 校验 ⇒ 书 A 的失败会写到当前已经是书 B 的状态上。
   * 现在是 { slug, status }：状态跟着书走，A 的失败碰不到 B。
   * 顺带把 seq 也带上，这样"切走之前那次请求的结果"也不会回头污染当前书。 */
  function prefetchText(slug, meta, seq) {
    if (!meta.textFile) return;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
    idle(async () => {
      if (typeof seq === 'number' && seq !== state.loadSeq) return;   // 已经切走了
      try {
        const r = await fetch(meta.textFile, { cache: 'no-cache' });
        if (!r.ok) throw new Error(String(r.status));
        attachText(slug, await r.json());
      } catch (e) {
        // 文案包拿不到就退化成"只有图、没有描述"：图和剧透判定都不受影响。
        // ⚠ 只在"还停在同一本书"时才记失败 —— 否则一次 A 的网络抖动会连累 B。
        if (typeof seq === 'number' && seq !== state.loadSeq) return;
        if (state.book && state.book.meta?.slug !== slug) return;
        state.textStatus = { slug, status: 'failed' };
        console.warn(`《${slug}》的文案包没拿到（${(e && e.message) || e}）—— 人物描述与结局会缺失，图与剧透判定不受影响。`);
      }
    });
  }

  /* ---------------- 长列表「展开/收起」（规范：docs/superpowers/specs/2026-09-28-panel-fold-design.md）---- */
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
  // 性别徽章：♂/♀（U+2642/U+2640）不在中文字体里，手机端字体回退的字形又大又靠下，
  // 药丸框里永远对不齐 → 改用内联 SVG（与平台字体无关，各端像素一致、可居中）
  const SEX_SVG = {
    f: '<svg class="sex" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.5" r="4"/><path d="M8 9.5V15M5.5 12.5h5"/></svg>女',
    m: '<svg class="sex" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.5" cy="9.5" r="4"/><path d="M9.5 6.5L14.5 1.5M10.5 1.5h4v4"/></svg>男'
  };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const genText = (g) => (g === 0 ? '前史' : `第 ${g} 代`);
  const charName = (id) => state.byId.get(id)?.name || id;

  /* ---------------- 分组（有代际按代，无代际按阵营） ---------------- */
  /** 按 key 取阵营名 */
  const factionNameByKey = (key) => (state.book?.factions.find((f) => f.key === key) || {}).name || '其他';
  /** ⚠ v85：这里的口径必须和 groupKeyOf 一致，都走 effectiveFactionKey。
   *  原来 groupLabelOf 用的是「原始 c.faction」，而分组键/节点颜色用的是「按进度的当前归属」，
   *  两者在有 factionHistory 的角色上会不一致 —— 实测三国读到第 5 回时，
   *  「蜀汉」分组的图注会写成「曹魏」、「群雄」写成「曹魏」（图注和颜色对不上）。 */
  const factionNameOf = (c) => factionNameByKey(effectiveFactionKey(c));
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

  const factionColorOf = (c) => factionColorByKey(effectiveFactionKey(c));
  /** v85：和 factionNameOf 现在是同一个东西了（都走 effectiveFactionKey），保留这个名字是因为调用点多、语义更清楚 */
  const factionTextOf = (c) => factionNameOf(c);
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
  /* 关系/人物的最后出场章：随书确定、整个会话内不变 ⇒ 在 loadBook 里一次算好存成 Map。
   * 原来是每次调用都全扫 events + relations（三国 ≈ 2900 次迭代），而它被 tooltip 的
   * formatter（鼠标划过节点）、buildOption 的过滤、EPUB 导出反复调用 ⇒ 悬停即卡。
   * 查不到就退回原算法，保证任何临时构造的对象也安全。 */
  const relChCalc = (r) => {
    const list = (r.events || []).map((e) => chOf(e.chapter)).filter((n) => n !== null);
    if (list.length) return Math.min(...list);
    return Math.min(charCh(state.byId.get(r.from)), charCh(state.byId.get(r.to)));
  };
  const charLastChCalc = (c) => {
    let last = charCh(c);
    for (const e of state.book.events) if ((e.chars || []).includes(c.id)) last = Math.max(last, e.ch || 0);
    for (const r of state.book.relations) {
      if (r.from !== c.id && r.to !== c.id) continue;
      for (const ev of r.events || []) last = Math.max(last, eventChOf(ev));
    }
    return last;
  };
  const relCh = (r) => {
    const hit = state.relChMap && state.relChMap.get(r);
    return hit === undefined ? relChCalc(r) : hit;
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
    const hit = state.charLastChMap && state.charLastChMap.get(c.id);
    return hit === undefined ? charLastChCalc(c) : hit;
  };
  const fateLocked = (c) => state.progress !== null && charLastCh(c) > state.progress;
  // 下限取 1 而不是 0：章号从 1 开始，取 0 会让"没有 meta.chapters 的书"（编辑器新建的草稿）
  // 打开剧透面板时得到 0 个可选项。与 shared/graph-core.js / miniprogram 保持一致。
  const maxChapter = () => state.book?.meta?.chapters || Math.max(
    1,
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
        console.error('Boot failed:', e);
        const metaEl = $('#book-meta');
        if (metaEl) metaEl.textContent = '数据加载失败：请用本地服务器打开（见 README）';
        return;
      }
      if (!state.books.length) { 
        const metaEl = $('#book-meta');
        if (metaEl) metaEl.textContent = '还没有书目数据';
        return; 
      }
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
    /* v85：竞态守卫。loadBook 有好几个 await，快速切书时后发先至很常见 ——
     * 选了三国（79 KB、被网络拖慢）再选罪与罚（3 KB、秒回），结果罪与罚先 commit，
     * 三国的响应后到又把它覆盖掉：下拉框显示罪与罚、state.book 却是三国，
     * 而且 initChart 会 dispose 掉刚建好的 chart，顺带把新 handler 的 observer 也解绑。
     * 每次 await 之后都检查"我还是最后一次请求吗"，不是就直接放弃。 */
    const seq = ++state.loadSeq;
    const stale = () => seq !== state.loadSeq;
    const meta = state.books.find((b) => b.slug === slug);
    let book;
    if (meta && meta.inline) {
      book = window.__BA_STANDALONE_BOOK;
    } else if (meta && meta.local) {
      book = JSON.parse(localStorage.getItem('ba-draft-' + slug));
    } else if (meta && meta.graphFile) {
      /* v85：分两步取数据。
       * 先只下「图包」（画图与剧透判定要的全在里面），图能画出来的快得多 ——
       * 三国 gzip 79.4 KB，而整份是 230.4 KB。文案包在图渲染完、浏览器空闲时后台预取，
       * 所以用户点开人物/事件时通常已经就绪。
       * 拿不到 graphFile（老缓存 / 生成文件没部署）就退回整份，功能不受影响。 */
      try {
        const g = await fetch(meta.graphFile, { cache: 'no-cache' });
        if (!g.ok) throw new Error(String(g.status));
        book = await g.json();
      } catch (e) {
        const res = await fetch(meta.file, { cache: 'no-cache' });
        book = await res.json();
      }
      // ★ 必须在所有 await 之后再发起预取：那时 state.book 才是这本书，
      //   否则 idle 回调可能在 state.book 提交前就跑，attachText 会拿旧书做校验而拒绝。
      prefetchText(slug, meta, seq);
    } else {
      const res = await fetch(meta.file, { cache: 'no-cache' });
      book = await res.json();
    }
    if (stale()) return;          // 等待期间用户又切了书 ⇒ 这次的响应已经过期，直接丢掉
    perf.fetchParse = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));
    state.book = book;
    state.byId = new Map(book.characters.map((c) => [c.id, c]));
    state.adj = new Map(book.characters.map((c) => [c.id, []]));
    for (const r of book.relations) {
      if (!state.byId.has(r.from) || !state.byId.has(r.to)) continue;
      state.adj.get(r.from).push({ to: r.to, rel: r });
      state.adj.get(r.to).push({ to: r.from, rel: r });
    }
    // 预计算章节索引：relCh / charLastCh 会被 tooltip、过滤、导出反复调用，
    // 每次重算要全扫 events+relations（v85，见这两处函数的注释）。
    state.relChMap = new Map();
    for (const r of book.relations) state.relChMap.set(r, relChCalc(r));
    state.charLastChMap = new Map();
    for (const c of book.characters) state.charLastChMap.set(c.id, charLastChCalc(c));
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
    state.textStatus = { slug, status: 'idle' };  // v85：文案状态按书记，换书即重置（见 attachText）
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
    // 换书清掉上一本书的选中残留：两人关系输入值/精确 id、搜索框精确 id（id 是旧书人物的）
    for (const id of ['path-a', 'path-b', 'search-input']) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (id !== 'search-input') el.value = '';
      delete el.dataset.id;
    }
    const ph0 = document.getElementById('path-hint');
    if (ph0) ph0.textContent = '';
    try { history.replaceState(null, '', `?book=${encodeURIComponent(slug)}`); } catch (e) { /* file:// 或沙箱里可能不允许改地址 */ }
    renderHeader();
    renderLegend();
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
    renderFooter();
    updateSearchPlaceholder();
  }

  /* ---------------- 页脚（三本书统一四行：一句话 / 结构 / 数据 / 来源） ---------------- */
  // 代际跨度文案：0 与负数并入「前史」，正代际压缩成「第 1–N 代」
  function genSpanText(gens) {
    const out = [];
    if (gens.some((g) => g <= 0)) out.push('前史');
    const pos = gens.filter((g) => g > 0);
    if (pos.length === 1) out.push(genText(pos[0]));
    else if (pos.length > 1) out.push(`第 ${pos[0]}–${pos[pos.length - 1]} 代`);
    return out.join('、') || '—';
  }
  function renderFooter() {
    const b = state.book, m = b.meta || {};
    const rows = [];
    // ① 一句话：最能概括这本书的一句 + 出处
    if (m.prophecy) rows.push(['一句话', `「${esc(m.prophecy)}」${m.prophecySrc ? `（${esc(m.prophecySrc)}）` : ''}`]);
    // ② 结构：当前分组视图怎么排 + 剧透/章节尺度 + 该书专属说明
    const gens = [...new Set(b.characters.map((c) => Number(c.generation)))].sort((a, z) => a - z);
    const facs = (b.factions || []).map((f) => f.name);
    const parts = [];
    if (state.groupMode === 'generation') {
      parts.push(`「分组视图」按代际排列（${genSpanText(gens)}）`);
    } else if (gens.length <= 1) {
      parts.push(`本书没有代际差异：所有人物同属一代（generation 一律为 1），「分组视图」按阵营（${facs.join('／')}）排列`);
    } else {
      parts.push(`「分组视图」按阵营（${facs.join('／')}）排列，数据另标代际（${genSpanText(gens)}）`);
    }
    if (m.chapters) parts.push(`剧透保护按章节顺序解锁（全书 ${m.chapters} 章）`);
    if (m.note) parts.push(esc(m.note));
    rows.push(['结构', parts.join('；').replace(/[。；;]?$/, '') + '。']);
    // ③ 数据：固定免责声明
    rows.push(['数据', '本数据是阅读辅助整理，不是原著全文；仅供阅读辅助用途，请支持正版原著。']);
    // ④ 来源：出处 · 授权 · 更新时间
    const src = (m.sources || []).map((s) => (s.url
      ? `<a class="foot-link" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`
      : esc(s.name))).join(' · ');
    const bits = [src, m.license && esc(m.license), m.updated && `更新 ${esc(m.updated)}`].filter(Boolean);
    if (bits.length) rows.push(['来源', bits.join(' · ')]);
    const el = $('#footer-note');
    if (el) el.innerHTML = rows.map(([k, v]) => `<span class="foot-row"><b>${k}</b>${v}</span>`).join('');
  }

  // 搜索框 placeholder：取当前书关系数最多的前 3 个人，拼成提示
  function updateSearchPlaceholder() {
    const input = document.getElementById('search-input');
    if (!input || !state.book) return;
    const deg = new Map(state.book.characters.map((c) => [c.id, 0]));
    for (const r of state.book.relations) {
      if (deg.has(r.from)) deg.set(r.from, (deg.get(r.from) || 0) + 1);
      if (deg.has(r.to)) deg.set(r.to, (deg.get(r.to) || 0) + 1);
    }
    const top = [...state.book.characters]
      .sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0))
      .slice(0, 3)
      .map((c) => c.name)
      .join(' / ');
    input.placeholder = top ? `搜单个人物：${top}…` : '搜单个人物…';
  }

  function renderLegend() {
    const el = $('#legend');
    el.innerHTML = state.book.factions.map((f) =>
      `<button type="button" class="legend-item" data-faction="${esc(f.key)}"><span class="dot" style="background:${esc(factionColorByKey(f.key))}"></span>${esc(f.name)}</button>`
    ).join('');
    refreshHighlightCaches();          // v85：图例重渲染 ⇒ 缓存的 NodeList 失效
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

  /* ---------------- 输入+下拉（combobox）：搜单个人物 / 两人关系 A、B 共用 ----------------
     选中结果写进 input.dataset.id（精确 id——百年孤独世代重名，按名字找会取错第几个） */
  function comboSub(c) {
    const parts = [];
    if (state.groupMode === 'generation') parts.push(genText(c.generation));
    if (c.title) parts.push(c.title);
    if (!parts.length) { const f = factionTextOf(c); if (f) parts.push(f); }
    if (isCharHidden(c)) parts.push('已折叠，点选展开');
    return parts.join(' · ');
  }
  function comboItems(kind) {
    // 关系数多的排前面（三国 871 人，下拉直接看到曹操/刘备比按数据顺序强）
    return state.book.characters
      .filter((c) => !charLocked(c) && charVisibleAt(c) && (kind === 'path' ? !isCharHidden(c) : true))
      .slice()
      .sort((a, b) => nodeDegree(b.id) - nodeDegree(a.id))
      .map((c) => ({ id: c.id, name: c.name, aliases: c.aliases || [], sub: comboSub(c) }));
  }
  /** 给 input 挂上下拉：输入即过滤，↑↓ 选择，回车选中（列表开着时）否则交给 onEnter */
  function attachCombo(input, opts) {
    // opts: { kind: 'search'|'path', onPick?: (item)=>void, onEnter?: ()=>void }
    const wrap = input.closest('.combo') || input.parentNode;
    const listId = `${input.id}-combo-list`;
    const list = document.createElement('div');
    list.id = listId;
    list.className = 'combo-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrap.appendChild(list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-autocomplete', 'list');

    let all = [], filtered = [], active = -1;

    function close() { list.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    function open() {
      const q = input.value.trim().toLowerCase();
      all = comboItems(opts.kind);
      filtered = (q ? all.filter((it) => it.name.toLowerCase().includes(q) || it.aliases.some((a) => a.toLowerCase().includes(q))) : all).slice(0, 60);
      active = filtered.length ? 0 : -1;
      render();
    }
    function render() {
      if (filtered.length) {
        list.innerHTML = filtered.map((it, i) =>
          `<div class="combo-item${i === active ? ' on' : ''}" role="option" id="${listId}-i${i}" data-i="${i}" aria-selected="${i === active}"><b>${esc(it.name)}</b>${it.sub ? `<span class="combo-sub">${esc(it.sub)}</span>` : ''}</div>`
        ).join('') + (all.length > filtered.length
          ? `<div class="combo-item combo-empty" role="presentation">还有 ${all.length - filtered.length} 个，继续输入缩小范围</div>` : '');
      } else {
        list.innerHTML = `<div class="combo-item combo-empty" role="presentation">没找到「${esc(input.value.trim())}」${opts.kind === 'search' ? '；回车按文字搜' : ''}</div>`;
      }
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (active >= 0) input.setAttribute('aria-activedescendant', `${listId}-i${active}`);
      // 翻转：下方放不下（含 .graph-pane overflow:hidden 会裁掉下拉）就向上翻
      const r = input.getBoundingClientRect();
      const pane = wrap.closest('.graph-pane');
      // 宽度：至少跟输入框齐平，最多 340px，但不越过面板右缘（overflow:hidden 会裁）
      const paneR = pane ? pane.getBoundingClientRect().right : window.innerWidth - 8;
      list.style.width = `${Math.round(Math.max(r.width, Math.min(340, paneR - r.left - 8)))}px`;
      list.style.right = 'auto';
      const limit = Math.min(window.innerHeight - 8, pane ? pane.getBoundingClientRect().bottom - 8 : Infinity);
      const up = r.bottom + (list.offsetHeight || 0) + 8 > limit && r.top - (list.offsetHeight || 0) - 8 > 8;
      list.classList.toggle('up', up);
      const on = list.querySelector('.combo-item.on');
      if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function pick(i) {
      const it = filtered[i];
      if (!it) return;
      input.value = it.name;
      input.dataset.id = it.id;
      close();
      if (opts.onPick) opts.onPick(it);
    }

    input.addEventListener('input', () => { delete input.dataset.id; open(); });
    input.addEventListener('focus', () => open());
    input.addEventListener('blur', () => setTimeout(close, 100));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.hidden) open(); else if (filtered.length) {
          active = e.key === 'ArrowDown' ? (active + 1) % filtered.length : (active - 1 + filtered.length) % filtered.length;
          render();
        }
        return;
      }
      if (e.key === 'Enter') {
        if (!list.hidden && active >= 0) { e.preventDefault(); pick(active); return; }
        if (opts.onEnter) { e.preventDefault(); opts.onEnter(); }
        return;
      }
      if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); close(); }
    });
    list.addEventListener('mousedown', (e) => e.preventDefault());   // 防止点选项前失焦把列表关了
    list.addEventListener('click', (e) => { const el = e.target.closest('.combo-item[data-i]'); if (el) pick(Number(el.dataset.i)); });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
    return { close };
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
    if (state.hlNodes && state.hlNodes.has(id)) return true;            // 高亮的人永远显示（否则选「主要 60 人」时点事件会静默丢人）
    return (degreeRanking().get(id) || 9999) <= lim;
  }

  /* —— 聚焦：只看某人 N 跳以内 —— */
  function focusSet() {
    if (!state.focus) return null;
    // v85：缓存键要带上 showDerived —— 它现在参与集合计算了（见下面的 relVisible 判断），
    // 但「族谱补全」开关和边过滤开关都不会清 focusCache，于是切换后聚焦集合是上一次算的旧值。
    const key = `${state.focus.id}|${state.focus.depth}|${state.showDerived ? 1 : 0}`;
    if (state.focusCache && state.focusCache.key === key) return state.focusCache.set;
    const set = new Set([state.focus.id]);
    let frontier = [state.focus.id];
    for (let d = 0; d < state.focus.depth; d++) {
      const next = [];
      for (const id of frontier) {
        for (const { to, rel } of state.adj.get(id) || []) {
          // ⚠ v85：必须一起查 relVisible（"族谱补全"开关）。原来只查了 relLocked/relVisibleAt，
          // 于是关掉族谱补全后聚焦某人时，只能通过推导边连到的人仍会被算进聚焦集合 ——
          // 但图上不会画那些边（buildOption 过滤掉了），结果是一大堆没有连线的悬空节点
          // （实测三国聚焦刘备 2 跳、全书共 50999 个悬空节点）。
          // 小程序那份 miniprogram/utils/graph.js:166 本来就有这个判断，这里是补齐。
          if (relLocked(rel) || !relVisibleAt(rel) || !relVisible(rel)) continue;
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

  /* ---------------- 锁定时的可见集合（口径见 shared/graph-core.js 同名函数） ----------------
   * v89。锁定时图上**只画**锁定集合内的点与线。
   *
   * 为什么不再"灰掉"：淡掉的线只是 opacity 调到 0.05，仍然留在系列里、也没有 silent，
   * 而 zrender 的命中测试不看 opacity —— 后画的淡线会把鼠标事件吃掉。刘备—诸葛亮那 9 条线
   * 在 links 数组里的下标是 472…1438，散落在 1545 条中间，于是瞄准一条亮线却点不动
   * （用户实测："大多数线点不动，偶尔能点"）。不画 = 不存在遮挡。
   *
   * 这两个函数与 shared/graph-core.js 的同名函数逐行对应，test/parity.mjs 会对拍。 */

  /** 某人 depth 跳以内的邻域。relLocked / relVisibleAt / relVisible 三个都要查（与 focusSet 同口径）。 */
  function neighborhoodNodes(startId, depth) {
    const set = new Set([startId]);
    let frontier = [startId];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const id of frontier) {
        for (const { to, rel } of state.adj.get(id) || []) {
          if (relLocked(rel) || !relVisibleAt(rel) || !relVisible(rel)) continue;
          if (set.has(to)) continue;
          set.add(to);
          next.push(to);
        }
      }
      frontier = next;
    }
    return set;
  }

  /** 两端都在 nodes 里、且关系本身可见的边 key 集合。
   *  刻意不查关系类型过滤 / 人数过滤 —— 那些由 buildOption 画图时自己过滤，
   *  在这里重复一遍只会让两处口径漂移。被过滤掉的边不会画，也就点不到。 */
  function edgesWithin(nodes) {
    const out = new Set();
    for (const r of state.book.relations) {
      if (!nodes.has(r.from) || !nodes.has(r.to)) continue;
      if (relLocked(r) || !relVisibleAt(r) || !relVisible(r)) continue;
      out.add(edgeKey(r.from, r.to));
    }
    return out;
  }

  const passFocus = (id) => {
    const set = focusSet();
    return !set || set.has(id) || (state.hlNodes && state.hlNodes.has(id));   // 聚焦模式下点事件，事件人物也要能显示
  };

  function buildOption(opts = {}) {
    const b = state.book;
    const ink = cssVar('--ink') || '#232a35';
    const muted = cssVar('--muted') || '#6c7482';
    const panel = cssVar('--panel') || '#fff';
    const line = cssVar('--line') || '#e5dfd3';
    // v85：accent 也提到循环外。cssVar() 走 getComputedStyle()，样式脏时每次调用都会触发一次
    // 强制样式重算 —— 原来它在下面那个逐节点 map 里，三国开「提及」时一次 buildOption
    // 要同步重算几百次样式。
    const accent = cssVar('--accent') || '#c99a3f';
    const anyDim = state.hlNodes.size > 0 || state.hlEdges.size > 0;
    // 高亮人少（点一个人 / 点一个事件）时：给高亮项"最小屏幕尺寸 + 描边 + 强制标签"，
    // 否则在三国这种 871 人的密集图里，高亮节点只有 2–5px，跟灰点没区别
    const smallHl = anyDim && state.hlNodes.size > 0 && state.hlNodes.size <= 40;
    const pairSeen = new Map();     // 同一对之间已画了几条边（决定曲率，见下面的 links）
    // 放大补偿：ECharts 的漫游缩放会把符号/字号/线宽一起放大（36× 时一个节点上千像素，屏幕上只剩一块碎片）
    // ⇒ 放大时按 1/zoom 缩回选项值，保证屏幕上的尺寸始终是"节点原始大小"
    const zc = (state.zoom || 1) > 1 ? 1 / state.zoom : 1;
    // 符号在**屏幕上**的目标直径：跟当前节点间距挂钩——
    // 适配视图里间距只有一两像素时，符号缩成小点（否则几百个 15–40px 的圆会糊成一团）
    // ⚠ 必须用 state.pxScale（真实的 世界单位→像素 尺度），不能用 state.fitLast：
    //   fitLast 只是本函数乘上去的缩放，ECharts 之后还会再乘一次等比适配系数。
    const px = state.pxScale || 1;                       // px / 世界单位（zoom=1）
    const fitK = px / (Math.abs(state.fitLast) || 1);    // px / 「适配后」单位（zoom=1）
    const spacingScreen = (state.stepWorld || 40) * px * (state.zoom || 1);
    const symScale = state.view === 'force' ? 1 : Math.max(0.12, Math.min(1, spacingScreen / 40));
    // symbolSize 走的是「适配后」的坐标，所以要把像素目标换算回数据单位
    const fxSym = (v) => Math.max(0.04, v / fitK * zc * symScale);   // 节点符号（世界坐标，跟着 zoom 放大 ⇒ 要缩回）
    // 线宽：边画在世界坐标，也会随 zoom 变粗 ⇒ 同样缩回。
    // ⚠ 标签字号**不要**用它：ECharts 把标签画在屏幕坐标，渲染高度＝fontSize 本身（实测 zoom=1/4 同字号同高），
    //   再除一次 zoom 会把放大后的名字压成 2px（v0.41 曾误把字号一起补偿，点事件聚焦后名字看不清）。
    const fxOk = (v) => Math.max(0.06, v * zc);

    /* v89：锁定态**只画**锁定集合内的点与线，其余一律不进系列。
     *
     * 原来这里对集合外的元素只是把 opacity 调低（0.12 / 0.05）继续画着。那样看着是"变暗"，
     * 但它们仍然**在系列里、也没有 silent**，而 zrender 的命中测试不看 opacity ——
     * 谁后画谁在上面就吃掉鼠标事件。刘备—诸葛亮那 9 条线在 links 数组里的下标是
     * 472…1438，散落在 1545 条中间，于是瞄准一条亮线却点不动（实测"大多数点不动、
     * 偶尔能点"）。不画就没有遮挡。
     *
     * 副作用也是想要的：锁定后图元数大降（两人关系直连时 336点+1545线 → 2点+9线），
     * 而 setOption 的成本是线性的（约 28µs/元素，见 CHANGELOG v0.87 ④）。
     *
     * ⚠ 这一层只是**显示**过滤，绝不碰 state.book —— 导出走 standaloneBook()（只按剧透裁）
     *   与各自的 exportPositions，不经过 buildOption。 */
    const lockSet = state.clickLock ? state.clickLock.nodes : null;
    const lockEdgeSet = state.clickLock ? state.clickLock.edges : null;
    const inLock = (id) => !lockSet || lockSet.has(id);

    const renderedGroups = new Set();     // v89：锁定后只有"真的有节点"的分组才画图注
    const data = b.characters.filter((c) => inLock(c.id) && !isCharHidden(c) && charVisibleAt(c) && passSizeFilter(c.id) && passFocus(c.id)).map((c) => {
      renderedGroups.add(groupKeyOf(c));
      const hl = anyDim && state.hlNodes.has(c.id);
      const dim = anyDim && !hl;
      const locked = charLocked(c);
      const mentioned = isMentioned(c);
      const pos = state.pos.get(c.id);
      let sz = fxSym((mentioned ? 12 : symbolSize(c.id)) * (hl ? 1.15 : 1));
      if (hl && smallHl) sz = Math.max(sz, 11);        // 高亮节点屏幕直径下限 11px（密集图里也能一眼找到）
      return {
        id: c.id, name: locked ? '🔒' : c.name, value: c.title,
        category: categoryOf(c),
        symbol: c.gender === 'f' ? 'roundRect' : 'circle',
        symbolSize: sz,
        x: pos ? pos.x : undefined, y: pos ? pos.y : undefined,
        itemStyle: mentioned
          ? { color: 'transparent', borderColor: hl ? accent : '#8b94a7', borderWidth: hl ? 2 : 1.5, borderType: 'dashed', opacity: dim ? 0.2 : 0.85 }
          : {
              opacity: dim ? 0.12 : (locked ? 0.4 : 1),
              color: locked ? '#9aa3b0' : factionColorOf(c),
              borderColor: hl ? accent : panel,
              borderWidth: hl ? 2.5 : 1,
              ...(hl && smallHl ? { shadowBlur: 8, shadowColor: 'rgba(0,0,0,.4)' } : {}),
            },
        label: {
          color: mentioned && !hl ? muted : (dim ? muted : ink),
          opacity: dim ? 0.18 : 1,
          textBorderColor: panel,
          textBorderWidth: 3,
          show: hl ? true : (mentioned ? !anyDim : (locked ? false : (state.allLabels || (state.labels ? state.labels.has(c.id) : nodeDegree(c.id) >= 4)))),
        },
        // v82 锁内动效：锁外节点 hover 完全无反应（聚光/加粗全关）；锁内节点恢复 hover 动效。
        // 每轮都显式写这个键：setOption 是合并语义，解锁时不写会把 disabled:true 残留下来
        emphasis: { disabled: !!(state.clickLock && !state.clickLock.nodes.has(c.id)) },
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
        // v89：锁定到只剩几个人时，全书的「第N代」图注会变成一堆指向空气的标签。
        // 只保留真的有节点落在这一组的图注。
        if (lockSet && !renderedGroups.has(g)) continue;
        data.push({
          id: `__gen_${g}`,
          name: state.bandLabels.get(g) || String(g),
          symbol: 'circle',
          symbolSize: 3,
          x: isH ? band : bb.minX - 30,
          y: isH ? bb.minY - 26 : band,
          label: {
            show: true, color: muted, fontSize: 11.5, fontWeight: 'bold',   // 标签画在屏幕坐标，不随 zoom 变 ⇒不能除以 zoom（否则一放大就剩 2px）
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

    /* relations 下标 → 关系对象 的映射，按书缓存一次。
     * 带上它，图上每条线才能知道自己到底是哪一条关系（见 findRel 的注释）。 */
    if (state.relIdxBook !== b) {
      state.relIndexOf = new Map();
      for (let i = 0; i < b.relations.length; i++) state.relIndexOf.set(b.relations[i], i);
      state.relIdxBook = b;
    }
    const links = b.relations
      .filter((r) => state.byId.has(r.from) && state.byId.has(r.to) && !relLocked(r))
      .filter((r) => !isCharHidden(state.byId.get(r.from)) && !isCharHidden(state.byId.get(r.to)))
      .filter((r) => passSizeFilter(r.from) && passSizeFilter(r.to) && passFocus(r.from) && passFocus(r.to))
      .filter(relVisible)
      .filter(passEdgeFilter)
      .filter(relVisibleAt)
      // v89：锁定态只保留锁定集合内的边（同一对人物的多条线会一起保留、一起高亮）
      .filter((r) => !lockEdgeSet || lockEdgeSet.has(edgeKey(r.from, r.to)))
      .map((r) => {
        const hiddenTier = isMentioned(state.byId.get(r.from)) || isMentioned(state.byId.get(r.to));
        const derived = isDerived(r);
        const key = edgeKey(r.from, r.to);
      const dim = anyDim && !state.hlEdges.has(key);
      // 同一对之间的多条边（阶段关系：同盟→反目…）用不同曲率扇开，否则会叠成一条线
      const n = pairSeen.get(key) || 0;
      pairSeen.set(key, n + 1);
      const curve = (n === 0 ? 0.08 : (n % 2 === 1 ? -1 : 1) * (0.08 + 0.12 * Math.floor(n / 2)));
      const hlEdge = anyDim && state.hlEdges.has(key);
      return {
        source: r.from, target: r.to, value: r.type,
        // v88：这条线对应 relations 里的第几条。同一对之间可能有类型相同的多条关系
        // （刘备—诸葛亮有两条「君臣军师」），只靠 (source, target, value) 分不开，
        // 悬停/点第二条会解析成第一条 ⇒ 看起来"点了没反应"。
        baRel: state.relIndexOf.get(r),
        // v82：锁外的线 hover 完全无反应；锁内恢复 hover 动效（线加粗）。每轮显式写，防合并残留
        emphasis: { disabled: !!(state.clickLock && !state.clickLock.edges.has(key)) },
        lineStyle: {
          width: fxOk(hlEdge ? 3 : 1.2),
          opacity: dim ? 0.05 : (derived ? 0.32 : (hiddenTier ? 0.3 : 0.5)),
          type: hiddenTier || derived ? 'dashed' : (r.style === 'dashed' ? 'dashed' : r.style === 'dotted' ? 'dotted' : 'solid'),
          curveness: Math.min(0.5, curve),
          // 点中的线：桌面端也给描边光晕（原先只有小屏有），点击反馈更明显
          ...(hlEdge ? { shadowBlur: 6, shadowColor: 'rgba(0,0,0,.45)' } : {}),
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
          // v81 悬停锁定：锁外的人/线悬停不显示任何内容（返回 '' → ECharts 不渲染容器，无幽灵框）
          const hoverLock = state.clickLock;
          if (hoverLock) {
            if (p.dataType === 'node' && !hoverLock.nodes.has(p.data.id)) return '';
            if (p.dataType === 'edge' && !hoverLock.edges.has(edgeKey(p.data.source, p.data.target))) return '';
          }
          if (p.dataType === 'edge') {
            const rel = findRel(p.data.source, p.data.target, p.data.value, p.data.baRel);
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
          distance: 4, fontSize: 10.5 * fontScale(), color: ink, formatter: '{b}',   // 同上：字号是屏幕像素，去掉 1/zoom 补偿
        },
        labelLayout: { hideOverlap: false },
        lineStyle: { color: 'source' },
        scaleLimit: { min: 0.02, max: 40 },   // 无限画布：从"看全貌"一路放大到"看清单个人"
        emphasis: {
          // v82 锁内动效恢复：锁定期间 focus 改 'none'——hover 只点亮自己（加粗/变粗），
          // 不点亮邻居（邻居可能在锁外）；锁外项由 data/link 上逐项 emphasis.disabled 关死。
          // 锁外 hover 既无聚光也无 tooltip（formatter 守卫），锁内 hover/click 动效齐全。
          // disabled / focus 两个键每轮都显式写：setOption 合并语义，缺键会残留旧值
          disabled: false,
          focus: state.clickLock ? 'none' : 'adjacency',
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
    // 网格键用整数而不是 `${gx}:${gy}`：每节点每轮要查 9 次，三国 ×140 轮 ≈ 110 万次
    // 模板字符串分配，是这个函数最大的开销。
    // 打包 (gx,gy) → (gx+OFF)*SPAN + (gy+OFF)：
    //   SPAN=2^24 限定 gy ∈ [-2^23, 2^23) ⇒ 坐标 |y| < 5×10^8（cell=60，即 5 亿像素，实际远小于此）
    //   乘积落在 Number 的安全整数范围内 ⇒ 键唯一，且比字符串 key 快得多
    const KEY_OFF = 0x800000, KEY_SPAN = 0x1000000;
    /* ⚠ 这里原本有个「本轮没分开任何一对就提前退出」的早退。它在数学上是逐位等价的
       * （坐标一个都没动 ⇒ 下一轮必然也找不到违反 d<min 的对），但实测**几乎不触发**：
       * 松弛是渐近逼近，每轮推一点点、永远差一点到 min，所以 三国 实测跑满 140 轮。
       * 留着就是一条没人验证过的分支压在布局的关键路径上，已删。
       * 「总位移小于 epsilon 就停」能再省三成时间，但那是**近似**、会改变输出 ——
       * 用几十毫秒换布局精确性不划算，也没做。 */
    for (let it = 0; it < iterations; it++) {
      const grid = new Map();
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const key = (Math.floor(n.x / cell) + KEY_OFF) * KEY_SPAN + Math.floor(n.y / cell) + KEY_OFF;
        let arr = grid.get(key);
        if (!arr) { arr = []; grid.set(key, arr); }
        arr.push(i);
      }
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const arr = grid.get((gx + ox + KEY_OFF) * KEY_SPAN + gy + oy + KEY_OFF);
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue;                     // 每对只处理一次
            const b = nodes[j];
            let dx = b.x - a.x, dy = b.y - a.y;
            const min = (a.size + b.size) / 2 + pad;
            /* 先比平方距离再开方：绝大多数对其实是"离得够远"，而开方是这一层最贵的
             * 算术（每轮 871×9 次，三国 ×140 轮）。min ≥ pad = 12 > 0，所以
             * d < min ⟺ d² < min²，两种写法结果逐位相同。 */
            if (dx === 0 && dy === 0) {
              /* 两个节点坐标**完全相同**。
               * 原写法 d 兜底成 0.01，但 dx/dy 本来就是 0，乘多大的系数位移都还是 0 ——
               * 于是这一对是个"解不开的固定点"，不管跑多少轮都叠在一起。
               * 真实数据会踩到：fillMissingPositions 会把「没有已定位邻居」的人物
               * 全部放到同一个重心（三国有 35 个零关系人物、罪与罚有 2 个）。
               * 这里给一个由下标决定的确定方向，把两者直接摆到恰好 min 的距离。 */
              const ang = ((i * 137) % 360) * Math.PI / 180;   // 黄金角：下标不同 ⇒ 方向不同
              const hx = Math.cos(ang) * min * 0.5, hy = Math.sin(ang) * min * 0.5;
              a.x -= hx; a.y -= hy;
              b.x += hx; b.y += hy;
              continue;
            }
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            const d = Math.sqrt(d2) || 0.01;
            const k = (min - d) / d / 2;
            dx *= k; dy *= k;
            a.x -= dx; a.y -= dy;
            b.x += dx; b.y += dy;
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
    // 注意：这个 s **不是**「世界单位→像素」的真实尺度 —— ECharts 之后还会再做一次等比适配，
    // 真实尺度是下面的 state.pxScale。
    const s = Math.max(0.02, Math.min((W - 2 * padX) / w, (H - 2 * padY) / h, 1.4));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    state.fitLast = s;                       // fitPositions 自己乘上去的缩放（导出还原坐标时要用）
    const prev = state.fit || { s: 1, cx: 0, cy: 0 };
    state.fit = {
      s: prev.s * s,
      cx: prev.cx + cx / (prev.s || 1),
      cy: prev.cy + cy / (prev.s || 1),
    };
    for (const [id, p] of state.pos) state.pos.set(id, { x: (p.x - cx) * s, y: (p.y - cy) * s });
    /* 「世界单位 → 像素」的真实尺度（zoom=1 时），存进 state.pxScale。
     *
     * ECharts 的 graph 系列**不会**把世界坐标 1:1 画到像素上：它先把数据包围盒**等比**
     * 塞进「容器居中 80%」的 viewRect，再把 zoom 乘在那个适配系数之上。
     * （实测与 min.js 里的源码位置见 memory/echarts-graph-auto-fits-data-bbox.md；
     *   test/render-scale.mjs 每次都会把这里的解析式和 ECharts 的 cs.scaleX 对拍。）
     *
     * 后果有两个，改之前都被踩到了：
     *   ① 改上面的 s 对渲染**毫无影响** —— 长宽比不变的话画面逐像素一样；
     *   ② 凡是拿 s（或 zoom）当「世界→像素」尺度的代码都是错的：
     *      符号大小、标签取舍、点击后把视野挪过去，全都算错了一个数量级。
     */
    const fitK = Math.min((W * 0.8) / (w * s), (H * 0.8) / (h * s));
    state.pxScale = s * fitK;
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
    const px = state.pxScale || 1;                       // 见 fitPositions 的 pxScale 说明
    const fitK = px / (Math.abs(state.fitLast) || 1);
    const spacingScreen = (state.stepWorld || 40) * px * zoom;
    const symScale = state.view === 'force' ? 1 : Math.max(0.12, Math.min(1, spacingScreen / 40));
    const eff = (id) => symbolSize(id) * zoom * zc * symScale;
    // 间距还不够大时，只给关系最多的前 40 人标名字（免得一屏几百个名字糊在一起）
    const zoomedIn = spacingScreen >= 18;
    const rank = degreeRanking();
    const MAX_LABELS = 400;
    const cands = state.book.characters
      .filter((c) => state.pos.has(c.id) && (state.hlNodes.has(c.id) || (passSizeFilter(c.id) && passFocus(c.id))))
      .filter((c) => state.hlNodes.has(c.id) || (isMentioned(c)
        ? false
        : (zoomedIn ? eff(c.id) >= 6 : (rank.get(c.id) || 9999) <= 40)))
      .map((c) => {
        const chip = Math.min(Math.max(eff(c.id), 6), 64);
        const w = c.name.length * 11.5 * fontScale() + chip + 6, h = Math.max(chip, 18);
        const p = state.pos.get(c.id);
        const sx = p.x * zoom + chip / 2;
        return { id: c.id, hl: state.hlNodes.has(c.id) ? 1 : 0, deg: nodeDegree(c.id), bx: sx - w / 2, by: p.y * zoom - h / 2, w, h };
      })
      .sort((a, b) => (b.hl - a.hl) || (b.deg - a.deg));   // 高亮的名字优先占位（否则会被 400 上限或碰撞挤掉）
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
    /* 孤立人物（一条关系都没有）没有邻居重心可依。原先一律放到全局重心 (cx, cy) ——
     * 但那会让**所有**孤立人物落在同一个点上，永远叠成一个。三国有 35 个零关系人物、
     * 罪与罚有 2 个，所以这不是假想输入。
     * 而且叠在一起之后 relaxPositions 也救不回来：坐标完全相同时 dx=dy=0，
     * 位移永远是 0（见 relaxPositions 里那段注释）。
     * 改成按黄金角在重心周围摊成一个螺旋，第 k 个离中心约 18·√k，铺开又不会太散。 */
    let orphan = 0;
    for (const id of missing) {
      const nb = (state.adj.get(id) || []).map((e) => state.pos.get(e.to)).filter(Boolean);
      if (nb.length) {
        state.pos.set(id, { x: nb.reduce((s, p) => s + p.x, 0) / nb.length, y: nb.reduce((s, p) => s + p.y, 0) / nb.length });
      } else {
        const ang = orphan * 2.399963;                    // 黄金角（rad）
        const rad = 18 * Math.sqrt(orphan + 1);
        orphan++;
        state.pos.set(id, { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad });
      }
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
    // 桌面：图高＝首屏可用高度（图心必在首屏内，见下面 avail 的算法）。
    // 不再按布局/人数设 700px 上限：图吃满首屏 → 左栏高≈视口高，配合 css 里
    // 「右栏一屏封顶内滚」，行高恒等于左栏，页脚紧跟图下方，双栏空白归零；
    // 同时大屏上图也更大（这正是"图与尾注之间空一大截"的修复）。
    const docTop = el.getBoundingClientRect().top + (window.scrollY || 0);
    const avail = Math.max(300, window.innerHeight - docTop - 24);
    el.style.height = avail + 'px';
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
    const maxCount = Math.max(1, ...groups.map((g) => byGen.get(g).length));
    const maxSymbol = Math.min(40, 15 + Math.max(...[...state.byId.keys()].map(nodeDegree)) * 2.2);
    const stepCross = Math.max(34, maxSymbol + 10);
    state.stepWorld = stepCross;      // 相邻节点的世界间距（buildOption 用它决定符号该画多大）
    const viewMain = (view === 'gen-h' ? W : H) - mainPad * 2;
    const viewCross = (view === 'gen-h' ? H : W) - crossPad * 2;

    /* v89 修「代际·横 / 分组·横」整张图不可用。
     *
     * 「竖」视图：一群人排成**一行**，行长＝人数，正好落在宽屏上 —— 一直是对的。
     * 「横」视图：一群人竖着排进矮边，于是曹魏 250 人就是一根 12500 长、间距 50 的线，
     * 而群组轴（10 个阵营 × 240）总长才 2160 ⇒ **长宽比 1 : 5.8**，而画布是 2 : 1。
     *
     * 为什么这会致命：ECharts 的 graph 系列**不会**把世界坐标 1:1 画到像素上，
     * 它先把数据包围盒**等比**塞进「容器居中 80%」的 viewRect，再把 zoom 乘在那个
     * 适配系数之上（实测与源码位置见 memory/echarts-graph-auto-fits-data-bbox.md）。
     * 于是被压到 0.088 的尺度：群组轴只剩 **83px 宽**，十个阵营的图注全叠在一起，
     * 整张图退化成中间一条竖线。
     *
     * 调 fitPositions 的缩放系数没有任何用 —— 等比适配之后只有**长宽比**有意义
     * （实测 64×344 与 949×5118 渲染出来同样宽 83px）。
     * 真正的解法是把每群人**折成网格**，再解一个 stepMain（群组间距），
     * 让 群组轴长 : 群内轴长 ≈ 可用宽 : 可用高，两根轴都用得上。
     */
    const GUT = 26;                   // 「横」视图里相邻群组块之间的间隙
    let stepMain = Math.max(200, 240);
    let cols = 1, rows = maxCount;
    if (view === 'gen-h') {
      const grid = (sm) => {
        const c = Math.max(1, Math.floor(Math.max(stepCross, sm - GUT) / stepCross));
        return { c, r: Math.max(1, Math.ceil(maxCount / c)) };
      };
      const want = viewMain / Math.max(1, viewCross);       // 目标长宽比＝画布可用长宽比
      for (let it = 0; it < 16 && groups.length > 1; it++) {
        const g = grid(stepMain);
        cols = g.c; rows = g.r;
        const crossL = (rows - 1) * stepCross;
        if (crossL <= 0) break;
        const ratio = (groups.length - 1) * stepMain / crossL;
        if (Math.abs(ratio - want) / want < 0.04) break;
        // 开根号：stepMain 同时决定格宽（cols↑⇒crossL↓）和群组总长，sqrt 收敛最快
        stepMain = Math.min(5000, Math.max(stepCross * 2, stepMain * Math.sqrt(want / ratio)));
      }
      const g = grid(stepMain);
      cols = g.c; rows = g.r;
    }
    const mainLen = view === 'gen-h'
      ? (groups.length < 2 ? cols * stepCross : (groups.length - 1) * stepMain)
      : Math.max(viewMain, (groups.length - 1) * stepMain);
    const crossLen = Math.max(viewCross, (rows - 1) * stepCross);

    groups.forEach((g, gi) => {
      const center = groups.length === 1 ? 0 : -mainLen / 2 + (mainLen * gi) / (groups.length - 1);
      state.bands.set(g, center);
      const sample = byGen.get(g)[0];
      state.bandLabels.set(g, sample ? groupLabelOf(sample) : String(g));
      const list = byGen.get(g);
      if (view === 'gen-h') {
        // 群组块：cols 列 × rows 行，块内居中，块与块之间留 GUT 间隙
        const myCols = Math.max(1, Math.min(cols, list.length));
        const myRows = Math.max(1, Math.ceil(list.length / myCols));
        const slot = Math.max(stepCross, stepMain - GUT);
        const x0 = center - (myCols * stepCross) / 2 + stepCross / 2;
        const y0 = -crossLen / 2 + ((rows - myRows) / 2) * stepCross;
        list.forEach((c, ci) => {
          state.pos.set(c.id, { x: x0 + (ci % myCols) * stepCross, y: y0 + Math.floor(ci / myCols) * stepCross });
        });
      } else {
        const step = list.length > 1 ? crossLen / (list.length - 1) : 0;
        list.forEach((c, ci) => {
          const off = list.length === 1 ? 0 : -crossLen / 2 + ci * step;
          state.pos.set(c.id, { x: off, y: center });
        });
      }
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
    // 切换布局时清除聚焦状态：聚焦是在旧布局下算的，新布局下位置会变，
    // 不清除会导致节点跑到视野外（图显示空白）
    state.focus = null;
    state.focusCache = null;
    unlockClick();                              // 「重置」＝锁定解除路径之一
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

  /**
   * 高亮集合较小时，把视野移过去并适当放大。
   * 为什么：三国 871 人铺满一屏时，点右侧事件高亮的 3–6 个人可能散在画布各处、
   * 节点只有 2–5px——"高亮生效了但根本看不见"。本函数只放大不缩小：
   * 收益明显（≥25%）或目标偏离视野中心时才动，避免小图上乱跳。
   * @returns {boolean} true = 已调用 applyZoom（option 已重建）
   */
  function focusViewOn(nodes, opts = {}) {
    // v89：锁定态的集合可能很大（搜曹操 1 跳就是 253 人），原来的 40 人上限会让它完全不生效，
    // 于是"只显示相关的人"之后画面还是全图的比例、相关的人挤在中间一小块。
    // 所以上限做成可传；gain 阈值也一起放宽一点，免得大集合因为"提升不足 25%"而不动。
    const maxNodes = opts.maxNodes || 40;
    const minGain = opts.minGain || 1.25;
    if (!state.chart || !nodes || !nodes.size || nodes.size > maxNodes) return false;
    const rect = document.getElementById('graph').getBoundingClientRect();
    const W = rect.width || 800, H = rect.height || 500;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
    for (const id of nodes) {
      const p = state.pos.get(id);
      if (!p) continue;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      n++;
    }
    if (!n) return false;
    const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const cur = state.zoom || 1;
    const vc = state.viewCenter || [0, 0];
    /* v89 修「代际·横 / 分组·横下点一个人就一片空白」。
     *
     * 这里以前把 state.zoom 直接当成「世界单位→像素」的尺度，于是 `target` 算出来的
     * 是**像素**，再被当成 zoom 用 —— 差了一个 ECharts 等比适配系数（代际·横实测 11 倍）。
     * 结果：点一个零关系人物 ⇒ w=h=1 ⇒ target 顶到 4 倍 ⇒ 视野被怼到那一小块上，
     * 而那一小块里只有他一个人（周围按群组轴隔开上百像素）⇒ 屏幕上一片空白，
     * 必须「重置」或双击才回得来。
     *
     * 换算：屏幕尺度 = pxScale/fitLast（px/适配后单位）× zoom，所以要的是
     *   target = 想要的像素尺度 ÷ (pxScale/fitLast)
     */
    const unitPx = (state.pxScale || 1) / (Math.abs(state.fitLast) || 1);   // px / 适配后单位（zoom=1）
    const wantPx = Math.min((W * 0.55) / w, (H * 0.55) / h);                // 高亮集合该有的像素跨度
    const target = Math.min(Math.max(wantPx / unitPx, cur), 4);             // 只放大、不缩小
    const improved = target >= cur * minGain;
    const moved = Math.hypot((cx - vc[0]) * unitPx * cur, (cy - vc[1]) * unitPx * cur) > Math.min(W, H) * 0.2;
    if (!improved && !moved) return false;
    /* 高亮已经占到画布短边的 1/3 以上时，放大带来的清晰度收益远不如"把整张图留在画面里"
     * 值钱，就不放大（只平移）。 */
    const onScreen = Math.max(w, h) * unitPx * cur;
    const plentyVisible = onScreen >= Math.min(W, H) / 3;
    if (plentyVisible && !moved) return false;
    applyZoom(plentyVisible ? Math.min(target, cur * 1.6) : target, [cx, cy]);
    return true;
  }

  /** v89：锁定后把视野适配到剩下的人/线。
   *  ⚠ 只调 applyZoom（改 state.zoom / viewCenter），**绝不走 fitPositions** ——
   *  fitPositions 会把缩放乘回 state.pos，锁定态下调它会让解除锁定后的整张图坐标被改坏。
   *  集合是"当前已绘制集合"的子集，所以只需放大、不需要缩小，focusViewOn 的语义正合适。 */
  function fitLockView() {
    const lock = state.clickLock;
    if (!lock || !lock.nodes || !lock.nodes.size) return false;
    return focusViewOn(lock.nodes, { maxNodes: 4000, minGain: 1.08 });
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
    if (!state.focus) { bar.hidden = true; stackBars(); return; }
    const c = state.byId.get(state.focus.id) || { name: state.focus.id };
    const n = (focusSet() || new Set()).size;
    bar.hidden = false;
    bar.innerHTML = `🎯 聚焦「${esc(c.name)}」· ${state.focus.depth} 跳以内 · ${n} 人
      <button class="ghost tiny" type="button" data-focus-nav="dec">− 跳</button>
      <button class="ghost tiny" type="button" data-focus-nav="inc">＋ 跳</button>
      <button class="ghost tiny" type="button" data-focus-exit="1">看全部</button>`;
    stackBars();
  }

  /* —— 点击锁定：搜单个人物 / 两人关系查询成功后进入；可点集合＝当前高亮集合（亮=能点、灰=点不动） ——
     解除路径：「重置」、搜索框旁的「清除」；
     * v89：「复位视图」和「双击空白」都**只**复位视图、不再解锁 —— 那两个动作的用户意图
     *   是"找回视野"而不是"放弃筛选"，捆在一起就会出现"双击一下锁就没了"这种怪事；
     * v82：锁定中点右栏人名＝把锁切换到该人（不解除），无锁点人名只看档案不建锁 */
  /* 悬停锁定 —— 重建前先收掉 tooltip：
     点击/搜索的瞬间鼠标正悬停在节点上（tooltip 显示中），随后的 setOption 重建会让
     ECharts 在已销毁的内容容器上 setContent 抛 null 引用（v80 起即可复现的既有竞争，本轮一并修） */
  function hideTipNow() { if (state.chart) state.chart.dispatchAction({ type: 'hideTip' }); }
  /* —— v84 导航提示：搜到人 / 点节点 / 点关系线 / 跑两人关系之后，把右栏面板滚进视野并闪 2 下，
        告诉用户"你要的信息在这儿"。关系类动作分两步走：先闪关系卡·关系链，隔一拍再滚到事件轴
        （两个平滑滚动同时打会互相盖掉，第一段闪烁根本看不见）。新动作进来会取消上一次没走到的
        第二步，所以连点不同的线不会串台。 */
  let navTimer = 0;
  /** block 默认 'start'（不是 'nearest'）：档案/关系链面板动辄 2000px 高，'nearest' 会把它的**底边**
   *  对齐视口、让人落在面板末尾；'start' 才是"导航到这个条目的开头"。事件卡小，另传 'center'。 */
  function flashTo(el, block = 'start') {
    if (!el) return;
    clearTimeout(navTimer);
    try { el.scrollIntoView({ behavior: 'smooth', block }); } catch (e) { el.scrollIntoView({ block }); }
    el.classList.remove('nav-flash'); void el.offsetWidth; el.classList.add('nav-flash');
    setTimeout(() => el.classList.remove('nav-flash'), 2400);
  }
  function navSecondStep(fn) { clearTimeout(navTimer); navTimer = setTimeout(fn, 550); }
  /** origin: 'search'（默认，单人搜索/下拉选人）| 'path'（两人关系链）—— 清空搜索框只解除前者的锁 */
  /** origin: 'search'（默认，单人搜索/下拉选人）| 'path'（两人关系链）—— 清空搜索框只解除前者的锁
   *  v89：'search' 额外记下 centerId 与 depth，好让锁定条上的「−跳 / ＋跳」重算可见集合。
   *  depth 记在 localStorage，跨会话保持。'path' 的集合就是那条最短链，**不给跳数** ——
   *  「只显示他们之间的」和「再往外扩几跳」是互相矛盾的。 */
  const LOCK_DEPTH_MIN = 1, LOCK_DEPTH_MAX = 3;
  /** v89：刚被丢掉的那把锁的来源（'search' | 'path'）。unlockClick 写，lockFromHighlight 读。 */
  let droppedLockOrigin = null;
  function savedLockDepth() {
    const n = Number(localStorage.getItem('ba-lock-depth'));
    return Number.isFinite(n) ? Math.max(LOCK_DEPTH_MIN, Math.min(LOCK_DEPTH_MAX, n)) : 1;
  }

  /* v89：两种锁（搜单个人 origin='search' ／ 两人关系 origin='path'）互斥时的清理。
   *
   * 用户的担心是"先查一个人、没点清除又去查两人关系，两者会撞车"。实测两条路径都是
   * selectCharacter() → setHighlight() → unlockClick() → lockFromHighlight()，
   * 上一把锁一定被完整换掉 —— **状态层面本来就不会撞车**。
   * 真正的问题是**查询框留着上一次的词**：搜完曹操去查两人关系，搜索框里还写着「曹操」，
   * 锁条上写的却是「刘备 → 诸葛亮」，界面自相矛盾；而且这时在搜索框里随手敲一下回车，
   * 就会静悄悄地把锁又锁回曹操 —— 看起来像"查询失灵了"。
   *
   * 用户提的方案是「查了其中一种，必须先点清除才能查另一种」。没有采用：
   * 那只是多一步、并不多给任何信息；而自动清掉对方那一半同样消除了歧义，
   * 还不必先去找「清除」按钮在哪。锁条上本来就写着当前是哪一把锁。
   */
  let searchComboRef = null;
  function clearSearchQuery() {
    const el = $('#search-input');
    if (!el) return;
    el.value = '';
    delete el.dataset.id;
    if (searchComboRef) searchComboRef.close();
  }
  function clearPathQuery() {
    for (const id of ['#path-a', '#path-b']) {
      const el = $(id);
      if (el) { el.value = ''; delete el.dataset.id; }
    }
    const h = $('#path-hint');
    if (h) h.textContent = '';
  }
  /** 换锁时，把另一种查询留下的输入清掉（只清输入，不动当前这把锁） */
  function clearOtherQuery(origin) {
    if (!droppedLockOrigin || droppedLockOrigin === origin) return;
    if (origin === 'path') clearSearchQuery(); else clearPathQuery();
    droppedLockOrigin = null;
  }

  function lockFromHighlight(label, origin, centerId) {
    const org = origin || 'search';
    clearOtherQuery(org);
    let nodes = state.hlNodes, edges = state.hlEdges, depth = 0;
    if (org === 'search' && centerId && state.adj.has(centerId)) {
      depth = savedLockDepth();
      nodes = neighborhoodNodes(centerId, depth);
      edges = edgesWithin(nodes);
      if (!nodes.size) return;
      state.hlNodes = new Set(nodes);
      state.hlEdges = new Set(edges);
    } else {
      if (!state.hlNodes.size) return;
      nodes = new Set(state.hlNodes); edges = new Set(state.hlEdges);
    }
    state.clickLock = {
      nodes, edges, label: label || '', origin: org,
      centerId: org === 'search' ? (centerId || null) : null,
      depth,
    };
    renderLockBar();
    // v82 悬停策略（锁外 emphasis.disabled / 锁内恢复动效）烤在 option 里：上锁后必须重建一次才生效
    hideTipNow();
    applyLockFilter();
    updateCountHint();
    if (state.chart) state.chart.setOption(buildOption({ keepView: true }));
    fitLockView();
  }
  /** 锁定态把图上收敛到锁定集合，并自动把视野适配到剩下的人/线。
   *  纯显示：不改 state.pos，只改 state.hlNodes/hlEdges 与视图参数。 */
  function applyLockFilter() {
    const lock = state.clickLock;
    if (!lock) return;
    state.hlNodes = new Set(lock.nodes);
    state.hlEdges = new Set(lock.edges);
    // 集合变大后可能带进还没有坐标的人（时间旅行/折叠让他们先前没画过）
    fillMissingPositions();
  }
  /** 锁定后改跳数：重算集合 → 重新过滤 → 重新适配视野。 */
  function setLockDepth(d) {
    const lock = state.clickLock;
    if (!lock || lock.origin !== 'search' || !lock.centerId) return;
    const next = Math.max(LOCK_DEPTH_MIN, Math.min(LOCK_DEPTH_MAX, Number(d) || 1));
    if (next === lock.depth) return;
    lock.depth = next;
    try { localStorage.setItem('ba-lock-depth', String(next)); } catch (e) { /* 隐私模式忽略 */ }
    const nodes = neighborhoodNodes(lock.centerId, next);
    lock.nodes = nodes;
    lock.edges = edgesWithin(nodes);
    applyLockFilter();
    renderLockBar();
    hideTipNow();
    updateCountHint();
    if (state.chart) state.chart.setOption(buildOption({ keepView: true }));
    fitLockView();
  }
  function unlockClick() {
    if (!state.clickLock) return;
    // v89：记住"刚被丢掉的那把锁是哪种"，好让下一把锁知道该不该清掉另一种查询的残留
    droppedLockOrigin = state.clickLock.origin;
    state.clickLock = null;
    /* v89 修：解除锁定要连高亮集合一起清。
     * 原来只清了 clickLock，hlNodes / hlEdges 留着 —— 而 isCharHidden() 开头就是
     * `if (state.hlNodes.has(c.id)) return false`，于是锁定集合里那些**本来被折叠的
     * 次要人物**又冒了出来：解除锁定后图上的人数比锁定前还多（实测三国 326 → 344）。
     * 两人关系锁看不出来是因为它的集合只有 2 个人、且都在可见集里。
     *
     * 在这里清是安全的：setHighlight / clearHighlight 都会紧接着自己重设这两个集合。 */
    state.hlNodes = new Set();
    state.hlEdges = new Set();
    renderLockBar();
    // 解锁后悬停恢复（各解锁路径本就重建，这里不重复建）
  }
  function restoreLock(lock) {
    state.clickLock = lock;
    renderLockBar();
    // selectCharacter 起手 setHighlight 会清锁重建：回填锁后再建一次，锁外抑制/锁内动效才回到图上
    hideTipNow();
    if (state.chart) state.chart.setOption(buildOption({ keepView: true }));
  }
  function blockLockClick() {
    const lock = state.clickLock;
    if (!lock) return;
    const msg = `🔒 聚焦「${lock.label}」中：只能点图上亮着的人和线（「重置」或右栏人名后点击「清除」可解除；「复位视图」和双击空白只复位视野，不解除）`;
    toast(msg);
    announce(msg);
  }
  function renderLockBar() {
    const bar = document.getElementById('lock-bar');
    if (!bar) return;
    const lock = state.clickLock;
    if (!lock) { bar.hidden = true; stackBars(); return; }
    bar.hidden = false;
    /* v89：锁定后图上只剩相关的人和线（其余不再画），所以原来的"只能点亮着的"已经变成
     * 自动成立，那句话反而误导 —— 改成说明"只看相关"并给出解除方式。
     * 两人关系锁不加跳数控件：集合就是那条最短链，再往外扩跟"只显示他们之间的"矛盾。 */
    const depthCtl = lock.origin === 'search' && lock.centerId
      ? `<span class="lock-depth" role="group" aria-label="显示几跳以内的关系">
           <button class="ghost tiny" type="button" data-lock-depth="dec" ${lock.depth <= LOCK_DEPTH_MIN ? 'disabled' : ''} aria-label="减少显示范围">−跳</button>
           <span class="lock-depth-n">${lock.depth} 跳</span>
           <button class="ghost tiny" type="button" data-lock-depth="inc" ${lock.depth >= LOCK_DEPTH_MAX ? 'disabled' : ''} aria-label="扩大显示范围">＋跳</button>
         </span>`
      : '';
    bar.innerHTML = `🔒 「${esc(lock.label)}」· 只看相关的人和线 ${depthCtl}
      <span class="lock-hint">「重置」或右栏人名后点「清除」可解除</span>`;
    stackBars();
  }
  /** 聚焦条/锁定条：fixed 悬浮，按「顶栏下沿、图区顶端」定位；两条同时可见时上下叠放 */
  function stackBars() {
    const g = document.getElementById('graph');
    const fb = document.getElementById('focus-bar');
    const lb = document.getElementById('lock-bar');
    if (!g || !fb || !lb) return;
    const tbEl = document.querySelector('.topbar');
    const tb = tbEl ? tbEl.getBoundingClientRect() : { bottom: 70 };
    const gr = g.getBoundingClientRect();
    const minTop = Math.round(Math.max(10, tb.bottom + 8));
    const visible = gr.bottom > minTop + 60;      // 图整个滚出视口上部就藏起来，别飘在别的内容上
    fb.style.visibility = visible ? '' : 'hidden';
    lb.style.visibility = visible ? '' : 'hidden';
    const base = Math.max(Math.round(gr.top + 10), minTop);
    fb.style.top = base + 'px';
    lb.style.top = (fb.hidden ? base : Math.round(fb.getBoundingClientRect().bottom + 6)) + 'px';
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
      state.zoom = 1;                       // 先复位再重建（否则 option 用旧 zoom 建、标签按 1 算，不一致）
      state.viewCenter = [0, 0];
      computeLabels(1);
      state.chart.clear();
      state.chart.setOption(buildOption(), { notMerge: true });
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
    // v85：initChart 每次换书 / 每次开关剧透保护都会重跑（见 loadBook 与 applySpoiler），
    // 而 chart.dispose() 只销毁 ECharts 实例、不动我们挂在 window / ResizeObserver 上的回调。
    // 以前每次重建都新加一个 ResizeObserver + 一个 resize 监听且从不解绑 ⇒ 切 5 次书后
    // 一次窗口 resize 会把「重排 + 全量 setOption」跑 5 遍。先解绑上一次的。
    teardownChartListeners();
    clearTimeout(state.freezeTimer);
    state.chart = echarts.init(el, null, { renderer: 'canvas' });
    state.frozen = false;
    state.pos = new Map();
    state.bands = new Map();
    state.fit = { s: 1, cx: 0, cy: 0 };
    // ⚠️ 事件绑定必须在任何 return 之前（之前手动模式提前 return，导致拖动/点击处理器根本没注册）
    state.chart.on('click', (p) => {
      if (p.dataType === 'node' && String(p.data.id || '').startsWith('__gen_')) return;
      hideTipNow();                              // 点击时 tooltip 正显示：先收，避免接下来的重建撞上已销毁的内容容器
      const lock = state.clickLock;
      if (p.dataType === 'edge') {
        if (lock && !lock.edges.has(edgeKey(p.data.source, p.data.target))) { blockLockClick(); return; }
        const rel = findRel(p.data.source, p.data.target, p.data.value, p.data.baRel);
        if (rel) selectRelation(rel);
        if (lock) restoreLock(lock);            // setHighlight 里清了锁，图内合法点击原样回填（不漂移）
        // v82→v84：两步走——先闪右栏关系卡，隔一拍再滚到事件轴上定义这段关系的事件并闪烁
        if (rel) navigateToEvent([rel.from, rel.to], true);
      } else if (p.dataType === 'node') {
        if (lock && !lock.nodes.has(p.data.id)) { blockLockClick(); return; }
        // v84：右栏档案闪一下提示"信息在这儿"。正常点击**不建锁**——锁只来自主动搜索 / 两人关系查询
        selectCharacter(p.data.id);
        if (lock) restoreLock(lock);
      }
    });
    // 单击空白＝清除高亮；锁定期间不响应（保持锁定，解除走「重置 / 右栏人名后点清除」）
    state.chart.getZr().on('click', (e) => { if (!e.target && !state.clickLock) clearHighlight(); });
    /* 双击空白处＝**只**复位视图。
     * v89：原先这里同时调了 unlockClick()，于是"想找回被缩放弄丢的视野"这个动作
     * 会顺带把锁定也丢掉 —— 两个完全不同的意图被捆在一起，而且锁定条上没写，
     * 用户只能自己发现「双击 = 解锁」。（测试 test/lock.mjs 也是靠双击解锁才没发现的。）
     * 锁定中则回到"锁定视野"（只剩两个人时 resetRoam 的 zoom=1 反而太远）。
     * 解除锁定请走「重置」或搜索框旁的「清除」，这两处都写在锁定条上。 */
    state.chart.getZr().on('dblclick', (e) => {
      if (e.target) return;
      if (state.clickLock) fitLockView(); else resetRoam();
    });
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
        /* v89：上面这套是按**全部** state.pos 重新适配的，而锁定态图上只画锁定集合 ——
           按全图算出来的缩放会把"只剩几个人"的那一小块推到屏幕外（窗口一变窄就"人不见了"）。
           所以锁定态改为按锁定集合重新适配一次。 */
        if (state.clickLock) fitLockView();
      }
    };
    // v85：把回调记进 state，好让下一次 initChart 能解绑（见 initChart 开头与 teardownChartListeners）。
    // 另外 onResize 里 applyViewHeight() 会写 el.style.height，也就是在被观察的元素上改样式 ——
    // ResizeObserver 本来就会因为这个再触发一轮。这不是死循环（高度算出来是稳定的），
    // 但会多跑一轮，所以这里加一个重入守卫。
    let resizing = false;
    const guardedResize = () => {
      if (resizing) return;
      resizing = true;
      try { onResize(); } finally { resizing = false; }
    };
    state.chartObserver = new ResizeObserver(guardedResize);
    state.chartObserver.observe(el);
    state.chartResizeHandler = guardedResize;
    window.addEventListener('resize', guardedResize);

    setView(state.view);   // 按当前视图初始化（默认＝代际·纵，可在布局里切换，选择会被记住）
  }

  /** 解绑上一次 initChart 挂的 ResizeObserver 与 resize 监听（v85：见 initChart 开头） */
  function teardownChartListeners() {
    if (state.chartObserver) {
      try { state.chartObserver.disconnect(); } catch (e) { /* 忽略 */ }
      state.chartObserver = null;
    }
    if (state.chartResizeHandler) {
      window.removeEventListener('resize', state.chartResizeHandler);
      state.chartResizeHandler = null;
    }
  }

  /** 找关系：同一对人可能有多条（阶段关系）——优先按"边上写的类型 + 当前时间可见"匹配 */
  function findRel(a, b, type, idx) {
    /* 优先按下标精确定位。
     * 同一对之间可能有**类型完全相同**的多条关系：实测刘备—诸葛亮有两条「君臣军师」
     * （第40章、第49章）。只按 (pair, type) 找的话，第二条永远会被解析成第一条 ——
     * 于是悬停第49章那条线，弹出来的是第40章的内容；点它，打开的也是第40章那张卡。
     * 用户看到的就是"这条线点了没反应"（其实有反应，只是响应的是旁边那条线）。
     * 图上每条线由 buildOption 一对一生成，所以把 relations 的下标带在线上就能消歧。 */
    if (typeof idx === 'number' && idx >= 0) {
      const byIdx = state.book.relations[idx];
      if (byIdx && ((byIdx.from === a && byIdx.to === b) || (byIdx.from === b && byIdx.to === a))) return byIdx;
    }
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
    selectCharacter(id, false);                 // 面板 + 高亮（读屏读的是面板里的文字）；方向键浏览不闪
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
  /** v85：图例项 / 事件芯片的集合缓存。
   *  这两处每次高亮变化都要全量遍历一遍（点节点、点事件、点阵营、点地点都会走到），
   *  而它们的列表只有 renderLegend / renderTimeline 才会变。改完渲染时刷新缓存即可。 */
  function legendItems() {
    if (!state.legendEls || !state.legendEls.length) state.legendEls = document.querySelectorAll('.legend-item');
    return state.legendEls;
  }
  function eventChips() {
    if (!state.chipEls || !state.chipEls.length) state.chipEls = document.querySelectorAll('.event-chip');
    return state.chipEls;
  }
  function refreshHighlightCaches() { state.legendEls = null; state.chipEls = null; }

  function setHighlight(nodes, edges, activeCharId, eventId) {
    unlockClick();                              // 换上下文（图外选择）＝解除点击锁定
    state.hlNodes = nodes || new Set();
    state.hlEdges = edges || new Set();
    state.activeChar = activeCharId || null;
    state.activeEvent = eventId || null;
    if (state.activeChar) state.activeFaction = null;
    for (const el of legendItems()) {
      el.classList.toggle('active', el.dataset.faction === state.activeFaction);
      el.classList.toggle('dim', !!state.activeFaction && el.dataset.faction !== state.activeFaction);
    }
    for (const el of eventChips()) el.classList.toggle('active', el.dataset.event === state.activeEvent);
    freezeNow();
    // 大图上点了看不见 ⇒ 把视野移到高亮区域；focusViewOn 内部会重建 option
    if (!focusViewOn(state.hlNodes) && state.chart) state.chart.setOption(buildOption({ keepView: true }));
  }

  function clearHighlight(updateVisual = true) {
    unlockClick();
    state.hlNodes = new Set();
    state.hlEdges = new Set();
    state.activeChar = null;
    state.activeEvent = null;
    state.activeFaction = null;
    for (const el of legendItems()) el.classList.remove('active', 'dim');
    for (const el of eventChips()) el.classList.remove('active');
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
    flashTo(document.getElementById('panel'));   // v84：点到被剧透保护挡着的人/事件，也让用户看见面板换了内容
  }

  /** nav=true（默认）：把右栏档案滚进视野并闪烁提示。键盘方向键浏览（focusNode）传 false，
   *  否则连按方向键会一路狂闪 —— 浏览是连续的，只有"打开"动作才值得提示一次。 */
  function selectCharacter(id, nav = true) {
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
        if (nav) flashTo(document.getElementById('panel'));
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
    if (nav) flashTo(document.getElementById('panel'));
  }

  function selectRelation(rel, nav = true) {
    const nodes = new Set([rel.from, rel.to]);
    const edges = new Set([edgeKey(rel.from, rel.to)]);
    state.panelKind = 'rel';
    state.activeRel = rel;
    setHighlight(nodes, edges, null, null);
    renderRelationPanel(rel);
    if (nav) flashTo(document.getElementById('panel'));
  }

  /** v82→v84：在事件轴上找"给定这几个人都在场"的第一个未锁定事件（关系自带的事件只有文字+章节，
   *  没有 id，只能按"两人都在场"匹配）。找不到返回 null，点击反馈已经在图上，不硬导航。 */
  function pickRelEvent(chars) {
    try {
      const phases = [...state.book.phases].sort((a, b) => a.order - b.order);
      const pOrder = new Map(phases.map((p, i) => [p.id, i]));
      const cand = state.book.events
        .filter((e) => chars.every((id) => (e.chars || []).includes(id)))
        .filter((e) => !eventLocked(e) && eventVisibleAt(e))
        .filter((e) => !state.placeFilter || e.place === state.placeFilter)
        .sort((a, b) => (pOrder.get(a.phase) ?? 99) - (pOrder.get(b.phase) ?? 99) || (a.order || 0) - (b.order || 0));
      return cand[0] || null;
    } catch (e) { return null; }
  }

  /** 滚到事件轴上那张事件卡并闪烁。delay＝隔一拍再走，让上一步（关系卡/关系链）的闪烁先被看见。
   *  卡片在这里才去查 DOM：延后期间时间轴可能被章节/筛选重画过，早拿引用会闪到已经摘掉的节点上。 */
  function navigateToEvent(chars, delay) {
    const ev = pickRelEvent(chars);
    if (!ev) return false;
    const go = () => {
      const chip = document.querySelector(`#timeline .event-chip[data-event="${CSS.escape(ev.id)}"]`);
      if (!chip) return;                     // 被章节/时间旅行筛掉了 → 不导航
      flashTo(chip, 'center');
    };
    if (delay) navSecondStep(go); else go();
    return true;
  }

  /** v84：跑完两人关系后的事件轴落点——优先"两人都在场"的事件（最能代表这两个人），找不到就
   *  沿链退回每一跳的定义事件，保证长链也总有个着落点。 */
  function navigateToPathEvent(a, b, steps) {
    const pairs = [[a, b], ...steps.map((s) => [s.from, s.to])];
    for (const pair of pairs) if (navigateToEvent(pair, true)) return true;
    return false;
  }

  // 折叠/过滤开关变了以后，右侧面板要跟着重画（否则内容还是旧的）
  function refreshPanel() {
    if (state.panelKind === 'rel' && state.activeRel) { renderRelationPanel(state.activeRel); return; }
    if (state.panelKind === 'char' && state.panelId) { const c = state.byId.get(state.panelId); if (c) renderCharacterPanel(c); return; }
    // v85：事件面板也要能被刷新 —— 文案包贴回来后，事件摘要/影响还没显示出来。
    // 之前这条路径不存在，所以 refreshPanel 从不重画事件面板（对旧逻辑无影响）。
    if (state.panelKind === 'event' && state.activeEvent) {
      const ev = state.book.events.find((e) => e.id === state.activeEvent) || state.book.events.find((e) => e.id === state.panelId);
      if (ev) renderEventPanel(ev);
    }
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
  /* v85：右栏/章节面板里的 data-goto / data-event / data-place-filter / data-focus-rel
   * 以前是「每渲染一次，给每个元素挂一个新 listener」——而面板内容是整体 innerHTML 重建的，
   * 曹操这种 261 条关系的枢纽人物，一次点击就产生几百个闭包；时间轴一次挂 702 个（事件数）。
   * 这些节点每次重渲染都被丢弃，listener 却只增不减。
   * 现在统一走 document 级委托（见 bindUI 里的 handlePanelClick），
   * 与本文件已有的 data-fold / data-export 等委托保持一致。保留这个函数是为了不改调用点。 */
  function bindGoto(root) { /* 委托已全局注册，这里无需再绑 */ void root; }

  /** 右栏/章节面板的委托点击处理（在 bindUI 里注册一次） */
  function handlePanelClick(ev) {
    const goto = ev.target.closest('[data-goto]');
    if (goto) {
      // v82 决策：锁定中点右栏人名＝把锁切换到该人（之后点「清除」才解除）；
      // 没有锁时点人名只看档案、不建锁（锁条只在查询后出现）
      if (state.clickLock) chooseCharById(goto.dataset.goto);
      else selectCharacter(goto.dataset.goto);
      return;
    }
    const evt = ev.target.closest('[data-event]');
    if (evt) { selectEvent(evt.dataset.event); return; }
    const pf = ev.target.closest('[data-place-filter]');
    if (pf) { applyPlaceFilter(pf.dataset.placeFilter || null); return; }
    const fr = ev.target.closest('[data-focus-rel]');
    if (fr) {
      const [a, b] = String(fr.dataset.focusRel).split('|');
      const rel = findRel(a, b);
      if (rel) selectRelation(rel);
    }
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
    // 「X的一生」：按章排的事件（含地点与引文），吃剧透保护；标题按性别人称
    const lifeName = `${c.gender === 'f' ? '她' : '他'}的一生`;
    const lifeEvs = state.book.events.filter((e) => (e.chars || []).includes(c.id)).sort((a, b) => (a.ch || 0) - (b.ch || 0));
    const lifeShown = lifeEvs.filter((e) => !eventLocked(e));
    const lifeItems = lifeShown.map((e) => `
        <li><button class="linkbtn" type="button" data-event="${esc(e.id)}"><span class="ch">第 ${e.ch ?? '?'} 章</span>${esc(e.name)}</button>
          <div class="rel-event">· ${esc(e.summary)}${e.place ? ` <button class="linkbtn" type="button" data-place-filter="${esc(e.place)}">📍${esc(placeName(e.place))}</button>` : ''}</div>
          ${e.quote ? `<div class="quote">「${esc(e.quote)}」</div>` : ''}
        </li>`);
    const lifeHtml = lifeEvs.length ? `
      <h3 style="margin-top:12px;font-size:14px">${lifeName}（按章，${lifeShown.length}/${lifeEvs.length}）</h3>
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
        <span class="badge">${c.gender === 'f' ? SEX_SVG.f : SEX_SVG.m}</span>
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
    // v85：记下当前面板是哪个事件，这样文案包贴回来后 refreshPanel 能把它重画一遍。
    state.panelKind = 'event';
    state.panelId = ev.id;
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
        // relLocked 必须查：state.adj 收录全部关系，不过滤。漏掉它会让 BFS 穿过读者还没读到的边，
        // runPath 再把 rel.type 原样印出来（实测三国读到第 10 章时有 201 条边可穿）。口径与 shared/graph-core.js 保持一致。
        if (relLocked(e.rel)) continue;
        if (!prev.has(e.to)) { prev.set(e.to, { from: cur, rel: e.rel }); queue.push(e.to); }
      }
    }
    if (!prev.has(toId)) return null;
    const steps = [];
    let cur = toId;
    while (prev.get(cur)) { const p = prev.get(cur); steps.unshift({ from: p.from, to: cur, rel: p.rel }); cur = p.from; }
    return steps;
  }

  /** 两人关系输入框 → 人物 id：优先下拉选中的精确 id，没选过就按输入文字匹配一次 */
  function pathCharId(input) {
    if (input.dataset.id && state.byId.has(input.dataset.id)) return input.dataset.id;
    const q = input.value.trim();
    if (!q) return '';
    const match = (x) => x.name === q || (x.aliases || []).includes(q) || x.name.includes(q) || (x.aliases || []).some((a) => a.includes(q));
    const c = state.book.characters.find((x) => !charLocked(x) && charVisibleAt(x) && !isCharHidden(x) && match(x));
    return c ? c.id : '';
  }

  function runPath() {
    const a = pathCharId($('#path-a')), b = pathCharId($('#path-b'));
    const hint = $('#path-hint');
    if (!a || !b) { hint.textContent = '请选择两个人'; return; }
    const steps = bfs(a, b);
    if (!steps) { hint.textContent = '在图里找不到通路'; return; }
    hint.textContent = `最短 ${steps.length} 跳`;
    const nodes = new Set([a, ...steps.map((s) => s.to)]);
    const edges = new Set(steps.map((s) => edgeKey(s.from, s.to)));
    setHighlight(nodes, edges, null, null);
    lockFromHighlight(`${charName(a)} → ${charName(b)}`, 'path');   // 点击锁定：只能点这条链的点和线

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
    // v84：两步走——先闪关系链面板，隔一拍再滚到事件轴（优先"两人都在场"的事件，否则退回链上每一跳）
    flashTo(document.getElementById('panel'));
    navigateToPathEvent(a, b, steps);
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
    refreshHighlightCaches();          // v85：时间轴重渲染 ⇒ 缓存的 NodeList 失效
    // v85：事件芯片上的 data-event 由 document 级委托处理（handlePanelClick），
    // 这里不再逐个挂 listener —— 三国一次就是 702 个。
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
    // 时间旅行会换掉一大半可见节点：老的视野中心是给旧集合算的，
    // 新子集的包围盒中心往往不在那 —— 不重新居中，内容就会被推出画面
    // （第 43 章最明显：193 人集中在布局左侧，图被裁掉左边一截）。
    // 只重新居中、不动缩放：缩放是用户滚出来的，倍率有意义。
    const data = state.chart.getOption().series[0].data;
    if (!data || !data.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const d of data) {
      if (d.id && d.id.startsWith('__gen_')) continue;   // 排除代际虚拟节点（在全图边缘，会拉偏包围盒）
      if (d.x < minX) minX = d.x;
      if (d.x > maxX) maxX = d.x;
      if (d.y < minY) minY = d.y;
      if (d.y > maxY) maxY = d.y;
    }
    if (minX === Infinity) return;   // 只有虚拟节点（极端情况）
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const vc = state.viewCenter || [0, 0];
    const rect = document.getElementById('graph').getBoundingClientRect();
    // 偏离超过视野短边的 20% 才动：避免拖滑块时图一直轻微跳动
    const threshold = Math.min(rect.width, rect.height) * 0.2;
    if (Math.hypot(cx - vc[0], cy - vc[1]) > threshold) {
      state.viewCenter = [cx, cy];
      state.chart.setOption({ series: [{ center: [cx, cy] }] });
    }
  }
  function applyTimeTravel() {
    try { localStorage.setItem('ba-timetravel', state.timeTravel ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ }
    state.chapter = Math.max(1, Math.min(maxChapter() || 1, state.chapter || 1));
    syncTimeTravelUI();
    clearHighlight(false);
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

  /**
   * 单文件导出要内联的那份数据：跟随当前剧透进度裁剪过的一份"干净"副本。
   *
   * v85 修复：原来这里直接内联整个 state.book，于是"单文件 HTML"是唯一无视剧透过滤的导出格式 ——
   * 明明 index.html 的导出面板写着「导出的内容跟随你当前的筛选：剧透进度、人数、次要人物、
   * 地点、聚焦都会生效」，但把文件发给别人后，对方一搜就能看到所有结局和还没发生的关系。
   *
   * 只按"剧透进度 + 时间旅行"裁剪（这是唯一会造成剧透的两个维度）；人数/次要人物/地点/聚焦
   * 属于视图筛选，内联完整数据让对方能自己筛，反而更有用。
   */
  function standaloneBook() {
    const b = state.book;
    const keepChars = b.characters.filter((c) => !charLocked(c) && charVisibleAt(c));
    const keepIds = new Set(keepChars.map((c) => c.id));
    const keepRels = b.relations.filter((r) =>
      keepIds.has(r.from) && keepIds.has(r.to) && !relLocked(r) && relVisible(r) && relVisibleAt(r));
    const keepEvents = (b.events || []).filter((e) => !eventLocked(e) && eventVisibleAt(e));
    // 关系上挂的小事件也按进度裁；地点只留下还发生过的
    const usedPlaces = new Set();
    for (const e of keepEvents) if (e.place) usedPlaces.add(e.place);
    const relsOut = keepRels.map((r) => {
      const evs = visibleRelEvents(r);
      for (const ev of evs) if (ev.place) usedPlaces.add(ev.place);
      // 裁完后一个事件都不剩 ⇒ 事件数组留空，避免对方看到"这里曾经发生过什么"的结构线索
      return evs.length === (r.events || []).length ? r : { ...r, events: evs };
    });
    const progNote = state.progress === null
      ? '（导出时：未开启剧透保护，含全书信息）'
      : `（导出时：剧透保护开到第 ${state.progress} 章，之后的人物与事件没有写进来）`;
    return {
      ...b,
      characters: keepChars,
      relations: relsOut,
      events: keepEvents,
      places: (b.places || []).filter((p) => usedPlaces.has(p.id)),
      __BA_STANDALONE_NOTE: progNote,
    };
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
    const data = jsSafe(JSON.stringify(standaloneBook()));
    let html = shell;
    html = html.replace(/<link rel="stylesheet" href="css\/style\.css\?v=\d+">/, () => `<style>\n${css}\n</style>`);
    html = html.replace(/\s*<link rel="manifest"[^>]*>/, '');
    html = html.replace(/\s*<link rel="icon"[^>]*>/g, '');
    html = html.replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '');
    html = html.replace(/<img class="logo"[^>]*>/, () => `<img class="logo" alt="书脉" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(logo)}">`);
    html = html.replace(/\s*<a class="icon-btn" href="editor\.html"[\s\S]*?<\/a>/, '');
    html = html.replace(/<a class="ghost tiny" href="editor\.html">打开编辑器<\/a>/, '<span class="hint">（单文件版不含编辑器；在线版可以自己整理一本书）</span>');
    // `<\/script>` 是必要的转义（不是无用转义）：单文件导出把 app.js 原文内联进 HTML 的
    // <script> 块，字面量 `</script>` 会让浏览器提前截断脚本。
    // eslint-disable-next-line no-useless-escape
    html = html.replace(/<script src="vendor\/echarts\.min\.js"><\/script>/, () => `<script>${jsSafe(echarts)}<\/script>`);
    html = html.replace(/<script src="js\/app\.js\?v=\d+"><\/script>/,
      // 同上：这里的 `<\/script>` 同样是为了内联时不截断。
      // eslint-disable-next-line no-useless-escape
      () => `<script>window.__BA_STANDALONE = true;\nwindow.__BA_STANDALONE_BOOK = ${data};<\/script>\n<script>${jsSafe(app)}<\/script>`);
    html = html.replace('</footer>',
      `  <span class="foot-row"><b>导出</b>本文件由《书脉 BookAtlas》导出（${esc(SITE_URL)}）</span>\n</footer>`);
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
      /* v85：buildGenerationPositions 除了 pos/bands 还会**重建** bandLabels 和 stepWorld
       * （它 new Map() 一份新的 bandLabels、按当前容器尺寸重算 stepWorld）。
       * 原来只把 pos/bands 存回来，于是导一次图（PNG/SVG/EPUB 都会走到这里）之后：
       *   · bandLabels 是按"未 fit 过的 bands 坐标"算的，而 bands 已经换回 fit 过的 ——
       *     屏幕上的「第 N 代 / 阵营」图注会漂到别的列上；
       *   · stepWorld 变了，于是 buildOption 里算出的 spacingScreen 与 state.pos 实际
       *     适配出来的间距对不上，节点符号大小跟着变。
       * 这三样都得一起存回。 */
      const backupPos = state.pos, backupBands = state.bands;
      const backupBandLabels = state.bandLabels, backupStepWorld = state.stepWorld;
      buildGenerationPositions(state.view);
      const computed = state.pos;
      state.pos = backupPos;
      state.bands = backupBands;
      state.bandLabels = backupBandLabels;
      state.stepWorld = backupStepWorld;
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
  const aiConfig = () => {
    try {
      return {
        base: localStorage.getItem('ba-ai-base') || AI_DEFAULT_BASE,
        model: localStorage.getItem('ba-ai-model') || 'deepseek-chat',
        key: localStorage.getItem('ba-ai-key') || '',
      };
    } catch (e) {
      return { base: AI_DEFAULT_BASE, model: 'deepseek-chat', key: '' };
    }
  };

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
  ${life ? `<h3>${c.gender === 'f' ? '她' : '他'}的一生（按章）</h3><ul>${life}</ul>` : ''}
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

  /* v85：导出前确保文案已就位。
   *
   * 为什么要专门挡一下：state.book 里的 desc/fate/summary/quote 与关系小事件 text
   * 都来自**文案包**，是图渲染完之后空闲时异步预取进来的。用户在图刚画出来的一两秒内
   * 点「导出 JSON」，拿到的是一份**所有文案都被剥掉**的 JSON —— 而 README 正是让贡献者
   * 把这个文件放进 data/ 再登记进 books.json 的。于是这份残缺的文件会被提交，
   * make-slim-packs.mjs 再从它生成文案包，散文就永久没了（而且 check:packs 会"通过"，
   * 因为它比对的正是这份已被剥掉的文件）。
   *
   * 所以这里等一下再导，而不是导出一个残缺版本。
   * @returns {boolean} true = 文案已就位，可以导出
   */
  async function ensureTextForExport() {
    const ts = state.textStatus;
    if (!ts || ts.status === 'done' || ts.status === 'idle' && !state.books.find((b) => b.slug === slugOf())?.textFile) return true;
    if (!ts || ts.status === 'idle' || ts.status === 'failed') {
      // 还没贴或拉失败了：重新拉一次（失败就如实告知，不导出残缺文件）
      const meta = state.books.find((b) => b.slug === slugOf());
      if (!meta || !meta.textFile) return true;
      try {
        const r = await fetch(meta.textFile, { cache: 'no-cache' });
        if (!r.ok) throw new Error(String(r.status));
        attachText(slugOf(), await r.json());
      } catch (e) {
        return false;
      }
    }
    return state.textStatus && state.textStatus.status === 'done';
  }

  async function runExport(kind) {
    if (!state.book) return;
    const hint = document.getElementById('export-hint');
    const say = (t) => { if (hint) hint.textContent = t; };
    const btn = document.querySelector(`[data-export="${kind}"]`);
    if (btn) btn.disabled = true;
    try {
      // ★ 所有导出都要文案：JSON 会被提交回 data/（缺了就是永久数据丢失），
      //   而单文件 HTML / EPUB / 人物卡里全是描述、结局、摘要，空着等于废掉。
      if (!await ensureTextForExport()) {
        say('文案还没加载出来（网络问题），现在导出会缺人物描述与结局。等几秒再试一次。');
        toast('文案还没加载完，稍等一下再导出');
        return;
      }
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
        // 「看清 1:1」＝让 1 个世界单位正好等于 1 像素 ⇒ zoom = 1 / 真实尺度（pxScale）
        applyZoom(Math.min(40, 1 / (state.pxScale || 1)), p ? [p.x, p.y] : [0, 0]);
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

  /** 被折叠的人物：自动展开层级（次要/提及）再定位——搜索永远找得到 */
  function revealChar(c) {
    if (isMinor(c)) { state.showMinor = true; try { localStorage.setItem('ba-minor', '1'); } catch (e) { /* 忽略 */ } }
    if (isMentioned(c)) { state.showMentioned = true; try { localStorage.setItem('ba-mentioned', '1'); } catch (e) { /* 忽略 */ } }
    const minorBtn2 = document.getElementById('minor-btn');
    if (minorBtn2) minorBtn2.textContent = state.showMinor ? '次要人物：显示' : '次要人物：隐藏';
    const mentionBtn2 = document.getElementById('mentioned-btn');
    if (mentionBtn2) mentionBtn2.textContent = state.showMentioned ? '提及人物：显示' : '提及人物：隐藏';
    updateCountHint();
    if (state.chart) state.chart.setOption(buildOption({ keepView: true }));
  }
  /** 选中一个人物并进入点击锁定（下拉点选走这里：精确 id，世代重名不会取错） */
  function chooseCharById(id) {
    const c = state.byId.get(id);
    if (!c) return;
    if (charLocked(c)) { renderLockedPanel('character', c); return; }
    if (isCharHidden(c)) revealChar(c);
    selectCharacter(c.id);
    lockFromHighlight(c.name, 'search', c.id);
  }

  function bindUI() {
    const search = $('#search-input');
    const doSearch = () => {
      const q = search.value.trim();
      if (!q) return;
      // 刚从下拉选中过：直接用精确 id
      const picked = search.dataset.id;
      const pc = picked ? state.byId.get(picked) : null;
      if (pc && pc.name === q) { chooseCharById(pc.id); return; }
      const match = (x) => x.name === q || (x.aliases || []).includes(q) || x.name.includes(q) || (x.aliases || []).some((a) => a.includes(q));
      const c = state.book.characters.find((x) => !charLocked(x) && !isCharHidden(x) && match(x));
      if (c) { selectCharacter(c.id); lockFromHighlight(c.name, 'search', c.id); return; }
      const hiddenHit = state.book.characters.find((x) => isCharHidden(x) && match(x));
      if (hiddenHit) {                                  // 被折叠的人：自动展开层级再定位（搜索永远找得到）
        revealChar(hiddenHit);
        selectCharacter(hiddenHit.id);
        lockFromHighlight(hiddenHit.name, 'search', hiddenHit.id);
        return;
      }
      const lockedHit = state.book.characters.find((x) => charLocked(x) && match(x));
      $('#path-hint').textContent = lockedHit ? `「${q}」还没到你读到的进度（剧透保护中）` : `没找到「${q}」`;
    };
    const searchCombo = attachCombo(search, {
      kind: 'search',
      onPick: (it) => chooseCharById(it.id),
      onEnter: () => doSearch(),
    });
    searchComboRef = searchCombo;      // v89：clearSearchQuery() 要用（换锁时清掉残留输入）
    search.addEventListener('change', () => { searchCombo.close(); doSearch(); });
    // v83：手动清空搜索框（点原生 ✕ / 全选删除都触发 input；WebKit 的 ✕ 只发 search）＝
    // 用户想解除搜索建的锁；两人关系链的锁（origin='path'）不清搜索框也在，保持原样
    const onSearchCleared = () => {
      if (search.value.trim()) return;
      delete search.dataset.id;
      if (state.clickLock && state.clickLock.origin !== 'path') clearHighlight();
    };
    search.addEventListener('input', onSearchCleared);
    search.addEventListener('search', onSearchCleared);
    $('#search-go').addEventListener('click', () => doSearch());
    $('#search-clear').addEventListener('click', () => { search.value = ''; delete search.dataset.id; searchCombo.close(); clearHighlight(); });

    // 两人关系 A、B：同样可直接输入名字，下拉可选（选中 id 记在 dataset）
    const pathA = $('#path-a'), pathB = $('#path-b');
    attachCombo(pathA, { kind: 'path', onEnter: () => runPath() });
    attachCombo(pathB, { kind: 'path', onEnter: () => runPath() });

    // v82：「重置 / 复位视图」把查询词一起清掉——残留的查询词只要一按回车就会立刻重新上锁、锁条又回来
    //      （v89：查询词清掉后锁还在，得再按一次「重置」才真解除 —— 这里只管清词，解锁是各自的事）
    const clearQueryInputs = () => {
      clearSearchQuery();
      clearPathQuery();
    };

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
      // v89：锁定条上的「−跳 / ＋跳」（只搜索锁定有，两人关系锁没有）
      const ld = ev.target.closest('[data-lock-depth]');
      if (ld && state.clickLock) {
        setLockDepth(state.clickLock.depth + (ld.dataset.lockDepth === 'inc' ? 1 : -1));
        return;
      }
    });

    // v85：右栏 / 章节面板 / 时间轴的动态按钮统一委托（替代原先每次 innerHTML 重建后
    // 由 bindGoto、renderTimeline 逐元素挂 listener 的做法）
    document.addEventListener('click', handlePanelClick);

    const mentionBtn = document.getElementById('mentioned-btn');
    const syncMentionBtn = () => { if (mentionBtn) mentionBtn.textContent = state.showMentioned ? '提及人物：显示' : '提及人物：隐藏'; };
    if (mentionBtn) mentionBtn.addEventListener('click', () => {
      state.showMentioned = !state.showMentioned;
      try { localStorage.setItem('ba-mentioned', state.showMentioned ? '1' : '0'); } catch (e) { /* 忽略 */ }
      syncMentionBtn();
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
    $('#reset-btn').addEventListener('click', () => { clearQueryInputs(); setView(state.view); });
    // v89：「复位视图」只复位视野、不解除锁定（和双击空白一致）。解除锁定走「重置」或「清除」。
    $('#view-reset-btn').addEventListener('click', () => { clearQueryInputs(); if (state.clickLock) fitLockView(); else resetRoam(); });
    const zoomOne = document.getElementById('zoom-one-btn');
    if (zoomOne) zoomOne.addEventListener('click', () => {
      if (!state.chart) return;
      // 世界坐标是 1:1 的：真实尺度是 state.pxScale（见 fitPositions 里的说明），
      // 跳到 1/它 就是"节点原始大小"。注意不能用 state.fitLast —— 那只是 fitPositions
      // 自己乘上去的缩放，ECharts 之后还会再乘一次等比适配系数（代际·横里差 11 倍）。
      const target = Math.min(40, 1 / (state.pxScale || 1));
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
      delete $('#path-a').dataset.id; delete $('#path-b').dataset.id;
      $('#path-hint').textContent = '';
      clearHighlight();
    });

    // 聚焦条/锁定条跟随图区位置（passive + rAF 节流）
    let barTick = false;
    const scheduleBars = () => { if (barTick) return; barTick = true; requestAnimationFrame(() => { barTick = false; stackBars(); }); };
    window.addEventListener('scroll', scheduleBars, { passive: true });
    window.addEventListener('resize', stackBars);

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
          if (state.kbCursor) {
            const lock = state.clickLock;
            if (lock && !lock.nodes.has(state.kbCursor)) { blockLockClick(); return; }
            hideTipNow();                        // 同点击路径：先收 tooltip 再重建
            selectCharacter(state.kbCursor);
            if (lock) restoreLock(lock);
          }
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
    // v85：导出与 AI 的逻辑本来就内联在本文件里，原先 js/export.js / js/ai.js 是同一套逻辑的第二份手抄
    // （且那份把 buildCompanionEpub() 的返回对象当字节数组塞进 Blob，EPUB 直接坏掉），已删除。
    // 这里直接调本文件的实现，少一次网络往返，也少一份会漂移的副本。
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
        const a = pathCharId($('#path-a')), b = pathCharId($('#path-b'));
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
    // v89：视野相关的两个入口。复现「代际·横下点若干次节点 + 缩放几次后一片空白」
    // 需要能脚本化地改 zoom/center 与切换布局（test/lock.mjs、诊断脚本用）。
    applyZoom: (z, c) => applyZoom(z, c),
    setView: (v) => setView(v),
    /** 聚焦集合（v85：供 test/parity.mjs 做三份实现对拍；只读，不改状态） */
    focusSet: () => { const s = focusSet(); return s ? [...s] : null; },
    // v89：锁定可见集合的两份口径（供 test/parity.mjs 与 graph-core / 小程序对拍）
    neighborhoodNodes: (id, depth) => [...neighborhoodNodes(id, depth)],
    edgesWithin: (nodes) => [...edgesWithin(nodes instanceof Set ? nodes : new Set(nodes))],
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
    standaloneBook: () => standaloneBook(),
    buildStandaloneHtml: () => buildStandaloneHtml(),
    buildSharePng: () => buildSharePng(),
    buildPrintSvg: () => buildPrintSvg(),
    buildCharacterPng: (id) => buildCharacterPng(id),
    buildCompanionEpub: () => buildCompanionEpub(),
    aiConfig: () => aiConfig(),
    aiPrompt: (kind, payload) => aiPrompt(kind, payload),
    aiExplain: (kind, payload) => aiExplain(kind, payload),
    bfs: (a, b) => bfs(a, b),
    _buildOption: (o) => buildOption(o),
    _findRel: (a, b, t, i) => findRel(a, b, t, i),
    _relaxPositions: (n) => relaxPositions(n),
    _fillMissing: () => fillMissingPositions(),
    _gen: (v) => buildGenerationPositions(v || state.view),
    _labels: (z) => computeLabels(z),
    _fit: () => fitPositions(),
    /** v85：计数提示与 aria 文案（供 test/browser.mjs 断言两者一致） */
    countHint: () => {
      const el = document.getElementById('count-hint');
      return el ? el.textContent : null;
    },
    /* v85：把纯判定谓词也暴露出来，供 test/browser.mjs 做「三份实现一致性」对拍。
     * 起因：同一套过滤逻辑在 js/app.js、miniprogram/utils/graph.js、shared/graph-core.js
     * 各手抄一份，三国分组口径就漂移过一次（app.js 修了两份没修），
     * 而 test/core.mjs 只测 graph-core 那份、且只断言 typeof，从来看不见。
     * 全部是纯函数、无副作用，不改变任何现有行为。 */
    _predicates: () => ({
      chOf, charCh, relCh, relFrom, lockedCh, charLocked, relLocked, eventLocked,
      eventChOf, eventVisibleAt, charVisibleAt, relVisibleAt, relVisible,
      passEdgeFilter, symbolSize, groupKeyOf, groupLabelOf, effectiveFactionKey,
      visibleRelEvents, charLastCh, fateLocked, periodText, maxChapter, asOf, timeCeiling,
    }),
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
