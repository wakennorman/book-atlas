#!/usr/bin/env node
/**
 * 共享核心逻辑单元测试（用 shared/graph-core.js）
 *
 * 测试：
 *   · BFS 最短路正确性
 *   · 剧透过滤（人物/关系/事件锁定）
 *   · 时间旅行关系切换
 *   · 章节摘要数据完整性
 *   · 关系过滤（线条/亲缘）
 *
 * 用法：node test/core.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGraphCore } from '../shared/graph-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function section(name) {
  console.log(`\n▶ ${name}`);
}

/* ---------------- 加载数据并创建 core ---------------- */
function loadCore(slug, stateOverrides = {}) {
  const book = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${slug}.json`), 'utf8'));
  const byId = new Map(book.characters.map((c) => [c.id, c]));
  const adj = new Map(book.characters.map((c) => [c.id, []]));
  const deg = new Map(book.characters.map((c) => [c.id, 0]));
  for (const r of book.relations) {
    if (!byId.has(r.from) || !byId.has(r.to)) continue;
    adj.get(r.from).push({ to: r.to, rel: r });
    adj.get(r.to).push({ to: r.from, rel: r });
    deg.set(r.from, (deg.get(r.from) || 0) + 1);
    deg.set(r.to, (deg.get(r.to) || 0) + 1);
  }
  const state = {
    progress: null,
    chapter: 1,
    timeTravel: false,
    showMinor: false,
    showMentioned: false,
    showDerived: true,
    sizeFilter: 'all',
    focus: null,
    edgeStyles: [],
    edgeKins: [],
    a11yPalette: false,
    fontSize: 'm',
    ...stateOverrides,
  };
  const core = createGraphCore({ pack: book, adj, byId, deg, state });
  return { book, core, state };
}

/* ---------------- 测试 ---------------- */
const books = ['one-hundred-years-of-solitude', 'crime-and-punishment', 'three-kingdoms'];

for (const slug of books) {
  const { book, core, state } = loadCore(slug);

  section(`${book.meta.title}（${slug}）`);

  // 1. BFS 最短路
  if (book.relations.length > 0) {
    const r0 = book.relations[0];
    const steps = core.bfs(r0.from, r0.to);
    assert(steps !== null, `BFS 能找到路径：${r0.from} → ${r0.to}`);
    if (steps && steps.length > 0) {
      assert(steps[0].from === r0.from, `BFS 起点正确`);
      assert(steps[steps.length - 1].to === r0.to, `BFS 终点正确`);
    }
  }

  // 2. 剧透过滤
  state.progress = 5;
  const lockedChar = book.characters.find((c) => c.firstCh > 5);
  if (lockedChar) {
    assert(core.charLocked(lockedChar), `人物被锁定：${lockedChar.name}（firstCh=${lockedChar.firstCh}）`);
  }
  const visibleChar = book.characters.find((c) => c.firstCh <= 5);
  if (visibleChar) {
    assert(!core.charLocked(visibleChar), `人物可见：${visibleChar.name}（firstCh=${visibleChar.firstCh}）`);
  }
  state.progress = null;

  // 3. 时间旅行
  state.timeTravel = true;
  state.chapter = 10;
  const relWithTime = book.relations.find((r) => typeof r.fromCh === 'number');
  if (relWithTime) {
    const visible = core.relVisibleAt(relWithTime);
    assert(typeof visible === 'boolean', `时间旅行关系可见性：${relWithTime.from} → ${relWithTime.to}`);
  }
  state.timeTravel = false;
  state.chapter = 1;

  // 4. 章节摘要
  const digest = core.chapterDigest(1);
  assert(digest.n === 1, `章节摘要：第 1 章`);
  assert(Array.isArray(digest.charsNew), `章节摘要：新人物列表`);
  assert(Array.isArray(digest.events), `章节摘要：事件列表`);

  // 5. 关系过滤
  state.edgeStyles = ['solid'];
  const solidRel = book.relations.find((r) => r.style === 'solid');
  if (solidRel) {
    assert(core.passEdge(solidRel), `线条过滤：solid 通过`);
  }
  const dashedRel = book.relations.find((r) => r.style === 'dashed');
  if (dashedRel) {
    assert(!core.passEdge(dashedRel), `线条过滤：dashed 被过滤`);
  }
  state.edgeStyles = [];

  // 6. 亲缘过滤
  state.edgeKins = ['blood'];
  const bloodRel = book.relations.find((r) => r.kin === 'blood');
  if (bloodRel) {
    assert(core.passEdge(bloodRel), `亲缘过滤：blood 通过`);
  }
  const swornRel = book.relations.find((r) => r.kin === 'sworn');
  if (swornRel) {
    assert(!core.passEdge(swornRel), `亲缘过滤：sworn 被过滤`);
  }
  state.edgeKins = [];

  // 7. 节点大小
  const degMap = new Map(book.characters.map((c) => [c.id, 0]));
  for (const r of book.relations) {
    if (degMap.has(r.from)) degMap.set(r.from, (degMap.get(r.from) || 0) + 1);
    if (degMap.has(r.to)) degMap.set(r.to, (degMap.get(r.to) || 0) + 1);
  }
  const mainChar = book.characters.find((c) => (degMap.get(c.id) || 0) > 5);
  if (mainChar) {
    const size = core.symbolSize(mainChar.id);
    assert(size >= 13 && size <= 40, `节点大小在范围内：${mainChar.name} = ${size}`);
  }

  // 8. 分组
  const groupKey = core.groupKeyOf(book.characters[0]);
  assert(typeof groupKey === 'string' && groupKey.length > 0, `分组键存在：${groupKey}`);

  // 9. 阵营
  const factionKey = core.effectiveFactionKey(book.characters[0]);
  assert(typeof factionKey === 'string', `阵营键存在：${factionKey}`);

  // 10. 人物最后出场章
  const lastCh = core.charLastCh(book.characters[0]);
  assert(typeof lastCh === 'number' && lastCh > 0, `最后出场章：${book.characters[0].name} = ${lastCh}`);
}

/* ---------------- 剧透守卫：app.js 的 bfs 与 graph-core 对齐 ----------------
 *
 * 历史：app.js 的 bfs() 漏了 relLocked 判断，而 shared/graph-core.js 的有。
 * state.adj 收录全部关系不过滤，于是 BFS 会穿过"读者还没读到的边"，
 * runPath 再把 rel.type 原样印出来（实测三国读到第 10 章有 201 条边可穿）。
 *
 * 以前这里只测 graph-core（它有 relLocked，天然通过），测不到 app.js 那份，
 * 于是这个漏洞能在"51 项断言全绿"的情况下存在。这里直接读 app.js 源码比对守卫。
 */
function testSpoilerGuardParity() {
  section('剧透守卫：app.js 的 bfs 与 graph-core 对齐');

  const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const m = appSrc.match(/function bfs\(fromId, toId\) \{[\s\S]*?\n {2}\}/);
  assert(!!m, 'app.js 里能找到 bfs()');
  if (!m) return;

  for (const g of ['relVisible', 'passEdgeFilter', 'relVisibleAt', 'relLocked']) {
    assert(new RegExp(`if\\s*\\([^)]*${g}\\(`).test(m[0]), `app.js 的 bfs() 检查了 ${g}()`);
  }
}

/* ---------------- 剧透泄漏的真实数据断言 ----------------
 *
 * 不只看源码里有没有关键字：用真实数据确认「读到第 N 章时，两端人物都能在
 * 输入框里选中、但这条边本身仍被锁住」的边确实走不通。
 */
function testSpoilerNoLockedEdgeTraversable() {
  section('剧透泄漏（真实数据）：锁住的边走不通');

  const PROGRESS = 10;
  for (const slug of books) {
    const { book, core, state } = loadCore(slug, { progress: PROGRESS });
    const byId = new Map(book.characters.map((c) => [c.id, c]));
    const nameOf = (id) => (byId.get(id) || {}).name || id;

    const lockedReachable = book.relations.filter((r) => {
      const a = byId.get(r.from), b = byId.get(r.to);
      if (!a || !b) return false;
      if (core.charLocked(a) || core.charLocked(b)) return false;  // 两端都能选 ⇒ 用户能发起查询
      return core.relLocked(r);                                      // 但边本身还没发生
    });

    // 这批边必须真的存在，否则下面的断言一条都跑不到、测试会"假绿"
    assert(lockedReachable.length > 0, `${slug}：存在"两端可选但边被锁住"的关系（${lockedReachable.length} 条）`);

    for (const r of lockedReachable.slice(0, 5)) {
      const steps = core.bfs(r.from, r.to);
      const crossed = (steps || []).some((s) => s.rel === r);
      assert(
        !crossed,
        `${slug}：${nameOf(r.from)}→${nameOf(r.to)}` +
        `（${r.type}，第 ${core.relCh(r)} 章才成立）在读到第 ${PROGRESS} 章时不可达`,
      );
    }
  }
}

testSpoilerGuardParity();
testSpoilerNoLockedEdgeTraversable();

/* ---------------- 结果 ---------------- */
console.log(`\n${'='.repeat(40)}`);
console.log(`通过：${passed}  失败：${failed}`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('全部通过');
}
