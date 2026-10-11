# `scripts/` 索引

> **本文件由 `node scripts/make-scripts-index.mjs` 生成**（加 `--check` 只对拍、不写）。
> 别手改 —— 手改会被门禁 `test/scripts-index-guard.mjs` 打回。

## 为什么要有它

`scripts/` 现在有 105 个 `.mjs`（另加 `scripts/archive/` 8 个）。
它们**不是一类东西**，混在一起看会做出两个**相反**的误判：

* **把一次性补丁当成死代码删掉**。可它们是**证据链**的一部分：
  数据里某个值"是哪一轮、依据哪句原文改的"，只有补丁脚本里写着。
  ⇒ **不删**（已归档的在 `scripts/archive/`）。
* **把从没被引用过的脚本当成在用**。于是改了数据却没人跑它 ——
  和"写了没人 import 的库""建了没人读的清单"是同一族的病。

分类判据（机械可判，本文件就是按它生成的）：

| 类别 | 怎么认 |
|---|---|
| 库 | 在 `scripts/lib/` 下 |
| 门禁 | 出现在 `check.yml` 的 `run: node scripts/<名字>` 里 |
| 一次性补丁 | 名字以 `fix-` / `add-` / `purge-` / `strip-` / `sync-` / `tag-` / `merge-` / `_` 开头，且不是门禁 |
| 工具 | 其余 |

「引用」列的四个标记：
`CI` = 门禁里每轮跑（`run: node scripts/…`）；
`提及` = 只在 `check.yml` 里出现过（`node --check` 文件列表或注释里 —— **不等于在跑**）；
`import` = 被别的脚本 `import`；`文档` = 在 `docs/*.md` 或 `README.md` 里被点名；`—` = 四处都没有。

## 一览

| 类别 | 个数 |
|---|---|
| 门禁 | 27 |
| 库 | 8 |
| 工具 | 22 |
| 一次性补丁 | 48 |
| **合计** | **105** |

## ⚠ 没进 CI、没被 import、文档里也没提的

共 **48** 个。分两类看，性质完全不同：

* **42 个是一次性补丁**（名字带补丁前缀）—— 这是**正常的**：
  它们本来就只跑一次，跑完留档当证据，**不需要**被任何东西引用。
* **6 个不是补丁命名** —— 这几个才值得看一眼：
  名字像是"常驻工具"，却既不在门禁、也没被 import、文档里也没提。
  要么它是"还没归档的一次性补丁"，要么它是**真的没人用**。两种情况都值得看一眼，**但别直接删**。

| 脚本 | 类别 | 一句话 |
|---|---|---|
| `audit-annotations.mjs` | 工具 | 拆书内容体检 —— v0.141；v0.143 扩到全部书 |
| `audit-kin-direction.mjs` | 工具 | 找**父子边方向反了**的记录。 |
| `find-missing-people.mjs` | 工具 | 找《三国演义》里"有台词、但数据里没有"的人物。 |
| `name2id.mjs` | 工具 | 人名 → id 解析器。拆书条目里 chars 一律写中文名，由本脚本转成 id。 |
| `verify-quotes.mjs` | 工具 | 逐条核验数据里的引号片段，给出 evidence，并把**真问题**单独拎出来。 |
| `verify-wiki-altnames.mjs` | 工具 | 核实 S5（中文维基百科《百年孤独》词条）那 3 条 altNames，并记录判定。 |

<details><summary>补丁命名的那些（展开）</summary>

| 脚本 | 一句话 |
|---|---|
| `_patch-v96-chars.mjs` | v0.96：《百年孤独》补漏 —— 对着原著正文（用户提供的 epub，scripts/extract-epub.mjs 抽出）核实后补人物与关系 |
| `add-cdp-guard.mjs` | 给所有浏览器测试补上 CDP 挂死保护（一次性脚本，v0.100 用过即弃）。 |
| `add-liuyao-six.mjs` | v0.119：补刘繇麾下 6 个**原著确有其人、但数据里没有**的人物（第 15 回孙策袭曲阿一线）。 |
| `add-missing-nine.mjs` | v0.116：补 8 个原著确有其人、但数据里没有的人物 ＋ 给蔡夫人补「蔡氏」别名 |
| `add-send-timeout.mjs` | 给 test/*.mjs 的 CDP `send()` 补超时 —— 补齐 v0.115 的第 4 项。 |
| `fix-100y-v099.mjs` | 《百年孤独》数据修正（v0.99）：全部依据用户提供的**范晔译本 epub 全文**。 |
| `fix-100y-v191.mjs` | 《百年孤独》查漏补缺（v0.191）。 |
| `fix-100y-v192.mjs` | v0.192 · 把「何塞·阿尔卡蒂奥（第五代）↔ 阿玛兰妲·乌尔苏拉」这条兄妹线 |
| `fix-altnames-ledger-drift.mjs` | v0.161：修「又译出处台账」与数据的**两处漂移** —— 新门禁 |
| `fix-anno-bold.mjs` | v0.175：修掉拆书数据里**落单的配对记号**（`**` 出现奇数次）。 |
| `fix-anno-declare.mjs` | 一次性修复：把**全库无人声明、却被同章正文引用**的事件补进条目的 `events[]` —— v0.177。 |
| `fix-anno-en.mjs` | v0.174：把拆书数据里**会渲染给读者看**的英文词翻成中文。 |
| `fix-bad-quotes.mjs` | 修掉 verify-quotes.mjs 报出的**确定缺陷**：原文里不存在的引号。 |
| `fix-cao-jie-split.mjs` | v0.126：**两个人被并成了一个 id** —— 宦官曹节 与 曹操之女「曹后」。 |
| `fix-dup-names.mjs` | 把「去括号后同名」里**没带括号**的那几个主名补上括号（v0.181）。 |
| `fix-event-chars.mjs` | v0.123：补事件 `chars` 里**真缺**的人物 ＋ 删掉一个我 v0.121 加错的别名。 |
| `fix-fabricated-quote.mjs` | 修一处**已确认的伪造引文**（v0.102）。 |
| `fix-fate-and-merge-liu.mjs` | v0.125：修两个**真数据错误** ＋ 补 18 条原文有明确交代的 `fate`。 |
| `fix-first-ch.mjs` | v0.178：修 4 处 `firstCh`（首次出场章）记晚了的记录 —— 依据 `audit-first-ch.mjs`。 |
| `fix-id-collisions-v151.mjs` | v0.151：修三处「id 撞车」造成的**关系挂错 id**。 |
| `fix-identity-clash.mjs` | v0.121：修数据里的**身份冲突** —— 重名、别名撞本名、同一人被拆成两个 id。 |
| `fix-isolated.mjs` | v0.118：给「孤立人物」（degree=0）补关系 —— 只连**原文明确写出来**的。 |
| `fix-kin-direction.mjs` | 修 audit-kin-direction.mjs 报出的父子边问题（v0.105）。 |
| `fix-kin-errors.mjs` | v0.127：修 3 条**填错的 kin** ＋ 删 1 条**真重复**的并行边。 |
| `fix-marmeladov-kin.mjs` | v0.179：把玛尔美拉朵夫一家 6 条亲属边改对 —— 玛尔美拉朵夫是**继父**，不是生父。 |
| `fix-merge-leitong.mjs` | v0.159：① 合并「雷同（雒城）」与「雷同（巴西）」—— **同一个人**； |
| `fix-missing-ok-stale.mjs` | v0.163：修「噪声忽略名单」里的两条**自相矛盾**条目 —— 新门禁 |
| `fix-missing-titles.mjs` | v0.128：补 29 个人物缺的 `title`，只填**原文真写了官职**的。 |
| `fix-name-clashes.mjs` | v0.117：修两组同音/近形人名 —— 一组是我刚造的重名，一组是数据里早就有的错边 |
| `fix-name-ledger-and-dailing-note.mjs` | v0.160：清掉「采用名字台账」里两条**已失效**的条目，并改正同一个根因留下的 `note`。 |
| `fix-other-two-books.mjs` | v0.122：清另外两本书的数据脏 + 给《罪与罚》的 2 个孤立人物补关系。 |
| `fix-split-sunhe.mjs` | v0.112：把 v0.105 错误合并的两个人拆开 —— 孙河 ≠ 孙和 |
| `fix-sun-geshi.mjs` | v0.106：① 删掉原著里查无此人的诸葛珪 ② 孙氏世系代号校准 |
| `fix-sun-regress.mjs` | v0.107：修 v0.105 / v0.106 引入的两个回归（自查发现，非用户报告） |
| `fix-sunhe-note.mjs` | v0.115：删掉 `孙权 —赐姓养侄孙— 孙韶`，并把孙河代号值的任意性写进 note |
| `fix-wrong-chapters.mjs` | v0.120：修 20 条**回次记错或内容无原文支撑**的关系事件。 |
| `fix-wu-tail.mjs` | v0.113：删掉两条"编造的姨母"关系 |
| `fix-xiahou.mjs` | v0.110：修 `夏侯楙 —养父子— 夏侯惇` 的方向 |
| `purge-history-only.mjs` | 按「从原著出发」核实并清理：只存在于史书、《三国演义》原文里没有的人物。 |
| `strip-fake-quotes.mjs` | 第一步：把「原文里查不到」的假引号去掉（v0.102 方案阶段 1）。 |
| `sync-name-form-ledger.mjs` | 跟着 purge-history-only.mjs 同步清理「采用名字台账」。 |
| `tag-event-evidence.mjs` | 给 events[] 标注证据等级（v0.102 方案阶段 2/3 的可自动化部分）。 |

</details>

## 门禁（27 个）

每轮 CI 都跑；`CI 里的调用`一列**连参数一起抄**（参数丢了就是另一个命令，见 `tools/gate.mjs` 的文件头）。

| 脚本 | CI 里的调用 | 一句话 |
|---|---|---|
| `audit-kin-gender.mjs` | `node scripts/audit-kin-gender.mjs` | 扫「亲子边的 type 与 gender 不符」。 |
| `audit-relation-actors.mjs` | `node scripts/audit-relation-actors.mjs` | 关系引文的「行为人审计」—— 找出**引文存在、但引文不支持这条关系**的那些边。 |
| `audit-search.mjs` | `node scripts/audit-search.mjs --all` | 搜索命中率审计（每本书整理完的收尾必跑） |
| `check-altnames-ledger.mjs` | `node scripts/check-altnames-ledger.mjs` | 「又译出处台账」与数据的**双向一致性**检查 —— v0.161 新增。 |
| `check-annotations.mjs` | `node scripts/check-annotations.mjs` | 拆书标注（data/annotations/<slug>.json）的校验器。 |
| `check-cross-chapter-ledger.mjs` | `node scripts/check-cross-chapter-ledger.mjs` | A3 跨章声明台账（`data/cross-chapter-ok.json`）的**一致性**检查 —— v0.177 新增。 |
| `check-dup-names-ledger.mjs` | `node scripts/check-dup-names-ledger.mjs` | `data/dup-names-ok.json`（「去括号后同名」已核台账）的门禁 —— v0.181 新增。 |
| `check-event-chars.mjs` | `node scripts/check-event-chars.mjs` | 报「事件在场人物」与人物登场章的时间矛盾 —— v0.135 由整理拆书素材时发现。 |
| `check-first-ch-ledger.mjs` | `node scripts/check-first-ch-ledger.mjs` | `data/first-ch-ok.json`（**firstCh 已核台账**）的门禁。 |
| `check-graph-fields.mjs` | `node scripts/check-graph-fields.mjs` | 网页端图包（data/<slug>.graph.json）的**字段覆盖检查**（v0.97 新增）。 |
| `check-kin-terms-exempt.mjs` | `node scripts/check-kin-terms-exempt.mjs` | 「称谓对质豁免清单」的**引用完整性**检查 —— v0.162 新增。 |
| `check-kin-terms.mjs` | `node scripts/check-kin-terms.mjs --all --coverage=0` | 亲属称谓对质（发布门禁的一步）：拿族谱算出的称谓，去对质数据里**手写的** type。 |
| `check-ledger-quotes.mjs` | `node scripts/check-ledger-quotes.mjs` | 台账 `why` 栏里「逐字引文」的**逐字性**检查 —— v0.182 新增。 |
| `check-missing-ok.mjs` | `node scripts/check-missing-ok.mjs` | 「噪声忽略名单」（`data/<slug>.missing-ok.json`）的**一致性**检查 —— v0.163 新增。 |
| `check-name-form-ledger.mjs` | `node scripts/check-name-form-ledger.mjs` | 「采用名字台账」的**引用完整性**检查 —— v0.160 新增。 |
| `check-packs-sync.mjs` | `node scripts/check-packs-sync.mjs` | 检查小程序数据包是否与 data/*.json 同步（语义比对，不比字节） |
| `check-relation-actors-ledger.mjs` | `node scripts/check-relation-actors-ledger.mjs` | `data/relation-actors-ok.json`（**行为人审计已核台账**）的门禁。 |
| `check-surname-coverage.mjs` | `node scripts/check-surname-coverage.mjs` | 「姓氏提取器盲区」的引用完整性检查 —— v0.164 新增。 |
| `check-sw-precache.mjs` | `node scripts/check-sw-precache.mjs` | 校验 sw.js 的预缓存清单与 data/books.json 一致（发布门禁的一步）。 |
| `check-transition-coverage.mjs` | `node scripts/check-transition-coverage.mjs` | `transition` 覆盖检查：状态规则里改的属性，基础块必须列进 transition。 |
| `check-transition-ease.mjs` | `node scripts/check-transition-ease.mjs` | `transition: all` 展开检查：同一 transition 声明里不得混用两种缓动 / 时长。 |
| `check-version-bump.mjs` | `node scripts/check-version-bump.mjs` | 「改了前端资源，却忘了 bump `sw.js` 的 `CACHE`」的检查。 |
| `check-version.mjs` | `node scripts/check-version.mjs` | 版本号一致性检查（发布门禁的一步）。 |
| `make-anno-digest.mjs` | `node scripts/make-anno-digest.mjs --check` | 生成「拆书素材」文档：把库里已核对的数据重排成写拆解时能直接引用的形式。 |
| `make-scripts-index.mjs` | `node scripts/make-scripts-index.mjs --check` | 生成 `scripts/README.md`（`scripts/` 的索引）。 |
| `make-slim-packs.mjs` | `node scripts/make-slim-packs.mjs --check` | 生成「图 + 文案」两份数据包（v85） |
| `validate.mjs` | `node scripts/validate.mjs --all` | 数据校验：node scripts/validate.mjs data/one-hundred-years-of-solitude.json |

## 库（8 个）

| 脚本 | 引用 | 一句话 |
|---|---|---|
| `against-text.mjs` | import · 文档 | 「对着原著正文找漏人」的**唯一**判据实现（v0.189）。 |
| `anno-cross-chapter.mjs` | import | 「事件章号」与「跨章声明（A3）」的**唯一定义** —— v0.177 新增。 |
| `book-sources.mjs` | import | 「哪本书对应哪份原著 txt」的**唯一**定义（v0.179）。 |
| `data-files.mjs` | import | data/ 目录里"哪些文件是书、哪些是附属文件"的**唯一**定义。 |
| `dup-names.mjs` | import | 「去括号后同名」的定义 —— `scripts/audit-search.mjs` ④ 与 |
| `main-text.mjs` | import | 「只含**正文**」的切分 —— v0.184 新建。 |
| `missing-ok.mjs` | import | 「噪声忽略名单」（`data/<slug>.missing-ok.json`）的**读取** —— v0.183 新建。 |
| `profile-prefixes.mjs` | import | Temp 下「本仓库自己开的临时目录」前缀表 —— **唯一来源**（v0.192）。 |

## 工具（22 个）

| 脚本 | 引用 | 一句话 |
|---|---|---|
| `annotate-kin.mjs` | 文档 | 给数据里的亲属关系补 kin 字段（只补有把握的；拿不准的留给人工） |
| `assign-phases.mjs` | 文档 | 按章节区间把事件归到阶段（phases[].from / phases[].to 用回/章号） |
| `audit-against-text.mjs` | 提及 · 文档 | 对着**原著正文**核一遍人物/地点/名字（规程 §零 第③步的工具） |
| `audit-annotations.mjs` | — | 拆书内容体检 —— v0.141；v0.143 扩到全部书 |
| `audit-first-ch.mjs` | 提及 · import · 文档 | firstCh 审计：把 `characters[].firstCh`（首次出场章）与**原著首现章**对拍。 |
| `audit-kin-direction.mjs` | — | 找**父子边方向反了**的记录。 |
| `bump-version.mjs` | 提及 · 文档 | 版本号同步：改前端资源后跑一次，自动更新所有引用处的版本号。 |
| `dedupe-chars.mjs` | 文档 | 同名/别名人物合并（整本生成后必做一遍） |
| `derive-kin.mjs` | 文档 | 族谱补全：从**亲子边**推导出亲属关系，补成 `derived: true` 的关系。 |
| `draft.mjs` | 文档 | AI 草稿生成（只出草稿，必须人工校对 + validate.mjs 校验后才能发布） |
| `extract-epub.mjs` | 文档 | EPUB 抽文工具（零依赖：Node 内置 zlib 解 zip） |
| `find-missing-people.mjs` | — | 找《三国演义》里"有台词、但数据里没有"的人物。 |
| `kin-terms.mjs` | 提及 · import | 亲属称谓计算 —— 从族谱（亲子边）算出两个人到底是什么关系。 |
| `kin.mjs` | 提及 · import · 文档 | 亲属关系（kin）规范 —— 编辑器 / validate.mjs / annotate-kin.mjs 共用这套口径 |
| `link-mentions.mjs` | 文档 | 文案反挂：事件 summary / 关系小事件里提到的人物，自动补进 events[].chars |
| `make-miniprogram-packs.mjs` | 文档 | 生成微信小程序用的数据包（miniprogram/data/*.js） |
| `make-tutorial-gifs.mjs` | 文档 | 动图教程生成器：用无头 Edge（CDP）真实点击页面，逐帧截图，供 assemble-gif.py 合成 GIF。 |
| `name2id.mjs` | — | 人名 → id 解析器。拆书条目里 chars 一律写中文名，由本脚本转成 id。 |
| `prune.mjs` | 文档 | 剪枝：清掉整本生成后常见的"碎数据" |
| `verify-quotes.mjs` | — | 逐条核验数据里的引号片段，给出 evidence，并把**真问题**单独拎出来。 |
| `verify-wiki-altnames.mjs` | — | 核实 S5（中文维基百科《百年孤独》词条）那 3 条 altNames，并记录判定。 |
| `wholebook.mjs` | 文档 | 整本生成（命令行版）—— 逐章抽取 → 合并去重 → 写出 data/<slug>.json |

## 一次性补丁（48 个）

**执行完只留档，不要删** —— 它们是"数据里这个值是怎么来的"的证据。
`引用`列若是 `—`，说明连语法检查名单都没进（那就更应该留着，否则它连被 `node --check` 摸一下的机会都没有）。

| 脚本 | 引用 | 一句话 |
|---|---|---|
| `_patch-v96-chars.mjs` | — | v0.96：《百年孤独》补漏 —— 对着原著正文（用户提供的 epub，scripts/extract-epub.mjs 抽出）核实后补人物与关系 |
| `add-cdp-guard.mjs` | — | 给所有浏览器测试补上 CDP 挂死保护（一次性脚本，v0.100 用过即弃）。 |
| `add-liuyao-six.mjs` | — | v0.119：补刘繇麾下 6 个**原著确有其人、但数据里没有**的人物（第 15 回孙策袭曲阿一线）。 |
| `add-missing-nine.mjs` | — | v0.116：补 8 个原著确有其人、但数据里没有的人物 ＋ 给蔡夫人补「蔡氏」别名 |
| `add-send-timeout.mjs` | — | 给 test/*.mjs 的 CDP `send()` 补超时 —— 补齐 v0.115 的第 4 项。 |
| `fix-100y-v099.mjs` | — | 《百年孤独》数据修正（v0.99）：全部依据用户提供的**范晔译本 epub 全文**。 |
| `fix-100y-v191.mjs` | — | 《百年孤独》查漏补缺（v0.191）。 |
| `fix-100y-v192.mjs` | — | v0.192 · 把「何塞·阿尔卡蒂奥（第五代）↔ 阿玛兰妲·乌尔苏拉」这条兄妹线 |
| `fix-3k-v144.mjs` | 文档 | v0.144：三国 —— 收尾「事件在场人物」修复暴露出的**六个同类问题**。 |
| `fix-altnames-ledger-drift.mjs` | — | v0.161：修「又译出处台账」与数据的**两处漂移** —— 新门禁 |
| `fix-anno-bold.mjs` | — | v0.175：修掉拆书数据里**落单的配对记号**（`**` 出现奇数次）。 |
| `fix-anno-declare.mjs` | 提及 | 一次性修复：把**全库无人声明、却被同章正文引用**的事件补进条目的 `events[]` —— v0.177。 |
| `fix-anno-en.mjs` | — | v0.174：把拆书数据里**会渲染给读者看**的英文词翻成中文。 |
| `fix-bad-quotes.mjs` | — | 修掉 verify-quotes.mjs 报出的**确定缺陷**：原文里不存在的引号。 |
| `fix-cao-jie-split.mjs` | — | v0.126：**两个人被并成了一个 id** —— 宦官曹节 与 曹操之女「曹后」。 |
| `fix-dup-names.mjs` | 提及 | 把「去括号后同名」里**没带括号**的那几个主名补上括号（v0.181）。 |
| `fix-event-chars.mjs` | — | v0.123：补事件 `chars` 里**真缺**的人物 ＋ 删掉一个我 v0.121 加错的别名。 |
| `fix-fabricated-quote.mjs` | — | 修一处**已确认的伪造引文**（v0.102）。 |
| `fix-fate-and-merge-liu.mjs` | — | v0.125：修两个**真数据错误** ＋ 补 18 条原文有明确交代的 `fate`。 |
| `fix-first-ch.mjs` | 提及 | v0.178：修 4 处 `firstCh`（首次出场章）记晚了的记录 —— 依据 `audit-first-ch.mjs`。 |
| `fix-gongsun.mjs` | 提及 · 文档 | 删掉 v0.108 里我造错的一条边：`公孙康 —父子— 公孙恭` |
| `fix-id-collisions-v151.mjs` | — | v0.151：修三处「id 撞车」造成的**关系挂错 id**。 |
| `fix-identity-clash.mjs` | — | v0.121：修数据里的**身份冲突** —— 重名、别名撞本名、同一人被拆成两个 id。 |
| `fix-isolated.mjs` | — | v0.118：给「孤立人物」（degree=0）补关系 —— 只连**原文明确写出来**的。 |
| `fix-kin-direction.mjs` | — | 修 audit-kin-direction.mjs 报出的父子边问题（v0.105）。 |
| `fix-kin-errors.mjs` | — | v0.127：修 3 条**填错的 kin** ＋ 删 1 条**真重复**的并行边。 |
| `fix-marmeladov-kin.mjs` | 提及 | v0.179：把玛尔美拉朵夫一家 6 条亲属边改对 —— 玛尔美拉朵夫是**继父**，不是生父。 |
| `fix-merge-leitong.mjs` | — | v0.159：① 合并「雷同（雒城）」与「雷同（巴西）」—— **同一个人**； |
| `fix-missing-ok-stale.mjs` | — | v0.163：修「噪声忽略名单」里的两条**自相矛盾**条目 —— 新门禁 |
| `fix-missing-titles.mjs` | — | v0.128：补 29 个人物缺的 `title`，只填**原文真写了官职**的。 |
| `fix-name-clashes.mjs` | — | v0.117：修两组同音/近形人名 —— 一组是我刚造的重名，一组是数据里早就有的错边 |
| `fix-name-ledger-and-dailing-note.mjs` | — | v0.160：清掉「采用名字台账」里两条**已失效**的条目，并改正同一个根因留下的 `note`。 |
| `fix-other-two-books.mjs` | — | v0.122：清另外两本书的数据脏 + 给《罪与罚》的 2 个孤立人物补关系。 |
| `fix-parent-cycles.mjs` | 文档 | 修亲子关系方向：按**人工核对过的方向表**修正，并把可疑的单向边报告出来 |
| `fix-rest.mjs` | 文档 | v0.108：收尾四项 —— 公孙家世系、孙綝代号、三处亲子边方向、曹节性别 |
| `fix-shared-courtesy-names.mjs` | 文档 | v0.124：修「同一个字号/称呼挂在多个人物上」——检索会落到错人。 |
| `fix-split-sunhe.mjs` | — | v0.112：把 v0.105 错误合并的两个人拆开 —— 孙河 ≠ 孙和 |
| `fix-sun-geshi.mjs` | — | v0.106：① 删掉原著里查无此人的诸葛珪 ② 孙氏世系代号校准 |
| `fix-sun-regress.mjs` | — | v0.107：修 v0.105 / v0.106 引入的两个回归（自查发现，非用户报告） |
| `fix-sunhe-note.mjs` | — | v0.115：删掉 `孙权 —赐姓养侄孙— 孙韶`，并把孙河代号值的任意性写进 note |
| `fix-wrong-chapters.mjs` | — | v0.120：修 20 条**回次记错或内容无原文支撑**的关系事件。 |
| `fix-wu-tail.mjs` | — | v0.113：删掉两条"编造的姨母"关系 |
| `fix-xiahou.mjs` | — | v0.110：修 `夏侯楙 —养父子— 夏侯惇` 的方向 |
| `merge-duplicate-relations.mjs` | 文档 | 关系去重：把「同一对人物 + 同一关系类型」的多条重复关系合并成一条 |
| `purge-history-only.mjs` | — | 按「从原著出发」核实并清理：只存在于史书、《三国演义》原文里没有的人物。 |
| `strip-fake-quotes.mjs` | — | 第一步：把「原文里查不到」的假引号去掉（v0.102 方案阶段 1）。 |
| `sync-name-form-ledger.mjs` | — | 跟着 purge-history-only.mjs 同步清理「采用名字台账」。 |
| `tag-event-evidence.mjs` | — | 给 events[] 标注证据等级（v0.102 方案阶段 2/3 的可自动化部分）。 |

## 已归档

`scripts/archive/` 里有 8 个更早的一次性补丁（v0.11–v0.44 一带）。
它们**同样不删**：早期那几轮的数据是靠它们改出来的，出问题时得能翻回去看当时怎么改的。

* `scripts/archive/_fix-ledger-quotes-v182.mjs`
* `scripts/archive/_patch-aliases-v36.mjs`
* `scripts/archive/_patch-faction-history-v44.mjs`
* `scripts/archive/_patch-lord-history-v53.mjs`
* `scripts/archive/_patch-relation-periods.mjs`
* `scripts/archive/_patch-solitude-v35.mjs`
* `scripts/archive/_patch-solitude-v35b.mjs`
* `scripts/archive/_patch-v11.mjs`
