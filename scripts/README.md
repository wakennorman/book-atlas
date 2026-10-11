# `scripts/` 索引

> **本文件由 `node scripts/make-scripts-index.mjs` 生成**（加 `--check` 只对拍、不写）。
> 别手改 —— 手改会被门禁 `test/scripts-index-guard.mjs` 打回。

## 为什么要有它

`scripts/` 现在有 62 个 `.mjs`（另加 `scripts/archive/` 58 个）。
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
| 一次性补丁 | 名字以 `fix-` / `add-` / `purge-` / `strip-` / `sync-` / `tag-` / `merge-` / `_` 开头，且不是门禁，且不在 `KEEP_TOOL` 里 |
| 工具 | 其余 |

⚠ **`KEEP_TOOL` 是例外名单**（v0.195）：前缀只是命名习惯，不是事实。
`merge-duplicate-relations.mjs` 命中 `merge-`，但 `validate.mjs` 会**建议用户跑它** ⇒ 归档它等于删掉一个出口；
`tag-script-lifetime.mjs` / `archive-one-offs.mjs` 是**用来维持规范的那几个脚本**（P3 靠它们才过得去）。
⇒ 凡是「用来维持规范」的脚本都会被自己的守卫先咬到，这是**自指陷阱**，必须显式豁免。

## 写新脚本时（v0.195 起，守卫 `test/scripts-hygiene-guard.mjs` 会查）

1. **文件头必须写明「一次性」还是「长期」**（P3）。分类靠猜 ⇒ 猜错就出事，
   v0.195 就差点把一个常驻工具归档掉。
2. 一次性补丁**跑完就归档**（P1）：
   ```bash
   node scripts/archive-one-offs.mjs --write
   ```
   它会加【已归档】标记（含「结论去哪了」）并搬进 `scripts/archive/`。
   ⚠ 归档前要确认两件事：结论已落进 `data/*.json` 或 CHANGELOG、没有未提交改动。
3. 归档文件**必须有【已归档】标记**（P2），否则那个目录会变成没人看得懂的垃圾桶。
4. 门禁 `run:` 到的脚本**不许被归档**（P4，双向对拍）。

详见 [`scripts/archive/README.md`](archive/README.md)。

「引用」列的四个标记：
`CI` = 门禁里每轮跑（`run: node scripts/…`）；
`提及` = 只在 `check.yml` 里出现过（`node --check` 文件列表或注释里 —— **不等于在跑**）；
`import` = 被别的脚本 `import`；`文档` = 在 `docs/*.md` 或 `README.md` 里被点名；`—` = 四处都没有。

## 一览

| 类别 | 个数 |
|---|---|
| 门禁 | 27 |
| 库 | 8 |
| 工具 | 27 |
| 一次性补丁 | 0 |
| **合计** | **62** |

## ⚠ 没进 CI、没被 import、文档里也没提的

共 **9** 个。分两类看，性质完全不同：

* **0 个是一次性补丁**（名字带补丁前缀）—— 这是**正常的**：
  它们本来就只跑一次，跑完留档当证据，**不需要**被任何东西引用。
* **8 个不是补丁命名** —— 这几个才值得看一眼：
  名字像是"常驻工具"，却既不在门禁、也没被 import、文档里也没提。
  要么它是"还没归档的一次性补丁"，要么它是**真的没人用**。两种情况都值得看一眼，**但别直接删**。

| 脚本 | 类别 | 一句话 |
|---|---|---|
| `archive-one-offs.mjs` | 工具 | 归档一次性脚本（v0.195 · 债二 B1 的一次性执行脚本） |
| `audit-annotations.mjs` | 工具 | 拆书内容体检 —— v0.141；v0.143 扩到全部书 |
| `audit-kin-direction.mjs` | 工具 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `find-missing-people.mjs` | 工具 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `name2id.mjs` | 工具 | 人名 → id 解析器。拆书条目里 chars 一律写中文名，由本脚本转成 id。 |
| `split-bindui.mjs` | 工具 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `verify-quotes.mjs` | 工具 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `verify-wiki-altnames.mjs` | 工具 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |

<details><summary>补丁命名的那些（展开）</summary>

| 脚本 | 一句话 |
|---|---|

</details>

## 门禁（27 个）

每轮 CI 都跑；`CI 里的调用`一列**连参数一起抄**（参数丢了就是另一个命令，见 `tools/gate.mjs` 的文件头）。

| 脚本 | CI 里的调用 | 一句话 |
|---|---|---|
| `audit-kin-gender.mjs` | `node scripts/audit-kin-gender.mjs` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `audit-relation-actors.mjs` | `node scripts/audit-relation-actors.mjs` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `audit-search.mjs` | `node scripts/audit-search.mjs --all` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `check-altnames-ledger.mjs` | `node scripts/check-altnames-ledger.mjs` | 「又译出处台账」与数据的**双向一致性**检查 —— v0.161 新增。 |
| `check-annotations.mjs` | `node scripts/check-annotations.mjs` | 拆书标注（data/annotations/<slug>.json）的校验器。 |
| `check-cross-chapter-ledger.mjs` | `node scripts/check-cross-chapter-ledger.mjs` | A3 跨章声明台账（`data/cross-chapter-ok.json`）的**一致性**检查 —— v0.177 新增。 |
| `check-dup-names-ledger.mjs` | `node scripts/check-dup-names-ledger.mjs` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `check-event-chars.mjs` | `node scripts/check-event-chars.mjs` | 报「事件在场人物」与人物登场章的时间矛盾 —— v0.135 由整理拆书素材时发现。 |
| `check-first-ch-ledger.mjs` | `node scripts/check-first-ch-ledger.mjs` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `check-graph-fields.mjs` | `node scripts/check-graph-fields.mjs` | 【长期】发布门禁每轮都跑（v0.195 补的文件头 —— 本脚本原本**完全没有注释头**， |
| `check-kin-terms-exempt.mjs` | `node scripts/check-kin-terms-exempt.mjs` | 「称谓对质豁免清单」的**引用完整性**检查 —— v0.162 新增。 |
| `check-kin-terms.mjs` | `node scripts/check-kin-terms.mjs --all --coverage=0` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `check-ledger-quotes.mjs` | `node scripts/check-ledger-quotes.mjs` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `check-missing-ok.mjs` | `node scripts/check-missing-ok.mjs` | 「噪声忽略名单」（`data/<slug>.missing-ok.json`）的**一致性**检查 —— v0.163 新增。 |
| `check-name-form-ledger.mjs` | `node scripts/check-name-form-ledger.mjs` | 「采用名字台账」的**引用完整性**检查 —— v0.160 新增。 |
| `check-packs-sync.mjs` | `node scripts/check-packs-sync.mjs` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `check-relation-actors-ledger.mjs` | `node scripts/check-relation-actors-ledger.mjs` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `check-surname-coverage.mjs` | `node scripts/check-surname-coverage.mjs` | 「姓氏提取器盲区」的引用完整性检查 —— v0.164 新增。 |
| `check-sw-precache.mjs` | `node scripts/check-sw-precache.mjs` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `check-transition-coverage.mjs` | `node scripts/check-transition-coverage.mjs` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `check-transition-ease.mjs` | `node scripts/check-transition-ease.mjs` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `check-version-bump.mjs` | `node scripts/check-version-bump.mjs` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `check-version.mjs` | `node scripts/check-version.mjs` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `make-anno-digest.mjs` | `node scripts/make-anno-digest.mjs --check` | 生成「拆书素材」文档：把库里已核对的数据重排成写拆解时能直接引用的形式。 |
| `make-scripts-index.mjs` | `node scripts/make-scripts-index.mjs --check` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `make-slim-packs.mjs` | `node scripts/make-slim-packs.mjs --check` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `validate.mjs` | `node scripts/validate.mjs --all` | 【长期】发布门禁每轮都跑 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |

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

## 工具（27 个）

| 脚本 | 引用 | 一句话 |
|---|---|---|
| `add-app-partitions.mjs` | 提及 · import | 【一次性】一次性补丁前缀 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `annotate-kin.mjs` | 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `archive-one-offs.mjs` | — | 归档一次性脚本（v0.195 · 债二 B1 的一次性执行脚本） |
| `assign-phases.mjs` | 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `audit-against-text.mjs` | 提及 · 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `audit-annotations.mjs` | — | 拆书内容体检 —— v0.141；v0.143 扩到全部书 |
| `audit-first-ch.mjs` | 提及 · import · 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `audit-kin-direction.mjs` | — | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `bump-version.mjs` | 提及 · 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `dedupe-chars.mjs` | 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `derive-kin.mjs` | 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `draft.mjs` | 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `extract-epub.mjs` | 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `find-missing-people.mjs` | — | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `kin-terms.mjs` | 提及 · import · 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `kin.mjs` | 提及 · import · 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `link-mentions.mjs` | 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `make-miniprogram-packs.mjs` | 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `make-tutorial-gifs.mjs` | 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `merge-duplicate-relations.mjs` | 文档 | 长期：可反复跑的关系去重工具 —— 不是一次性补丁。 |
| `name2id.mjs` | — | 人名 → id 解析器。拆书条目里 chars 一律写中文名，由本脚本转成 id。 |
| `prune.mjs` | 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `split-bindui.mjs` | — | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `tag-script-lifetime.mjs` | — | 【一次性】一次性补丁前缀 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `verify-quotes.mjs` | — | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `verify-wiki-altnames.mjs` | — | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |
| `wholebook.mjs` | 文档 | 【长期】工具：需要时手动跑，跑完不改仓库状态 （v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定） |

## 一次性补丁（0 个）

**执行完只留档，不要删** —— 它们是"数据里这个值是怎么来的"的证据。
`引用`列若是 `—`，说明连语法检查名单都没进（那就更应该留着，否则它连被 `node --check` 摸一下的机会都没有）。

| 脚本 | 引用 | 一句话 |
|---|---|---|

## 已归档

`scripts/archive/` 里有 58 个更早的一次性补丁（v0.11–v0.44 一带）。
它们**同样不删**：早期那几轮的数据是靠它们改出来的，出问题时得能翻回去看当时怎么改的。

* `scripts/archive/_fix-ledger-quotes-v182.mjs`
* `scripts/archive/_patch-aliases-v36.mjs`
* `scripts/archive/_patch-faction-history-v44.mjs`
* `scripts/archive/_patch-lord-history-v53.mjs`
* `scripts/archive/_patch-relation-periods.mjs`
* `scripts/archive/_patch-solitude-v35.mjs`
* `scripts/archive/_patch-solitude-v35b.mjs`
* `scripts/archive/_patch-v11.mjs`
* `scripts/archive/_patch-v96-chars.mjs`
* `scripts/archive/add-cdp-guard.mjs`
* `scripts/archive/add-liuyao-six.mjs`
* `scripts/archive/add-missing-nine.mjs`
* `scripts/archive/add-send-timeout.mjs`
* `scripts/archive/fix-100y-v099.mjs`
* `scripts/archive/fix-100y-v191.mjs`
* `scripts/archive/fix-100y-v192.mjs`
* `scripts/archive/fix-3k-v144.mjs`
* `scripts/archive/fix-3k-v194-birthrank.mjs`
* `scripts/archive/fix-3k-v194-peixu.mjs`
* `scripts/archive/fix-altnames-ledger-drift.mjs`
* `scripts/archive/fix-anno-bold.mjs`
* `scripts/archive/fix-anno-declare.mjs`
* `scripts/archive/fix-anno-en.mjs`
* `scripts/archive/fix-bad-quotes.mjs`
* `scripts/archive/fix-cao-jie-split.mjs`
* `scripts/archive/fix-dup-names.mjs`
* `scripts/archive/fix-event-chars.mjs`
* `scripts/archive/fix-fabricated-quote.mjs`
* `scripts/archive/fix-fate-and-merge-liu.mjs`
* `scripts/archive/fix-first-ch.mjs`
* `scripts/archive/fix-gongsun.mjs`
* `scripts/archive/fix-id-collisions-v151.mjs`
* `scripts/archive/fix-identity-clash.mjs`
* `scripts/archive/fix-isolated.mjs`
* `scripts/archive/fix-kin-direction.mjs`
* `scripts/archive/fix-kin-errors.mjs`
* `scripts/archive/fix-marmeladov-kin.mjs`
* `scripts/archive/fix-merge-leitong.mjs`
* `scripts/archive/fix-missing-ok-stale.mjs`
* `scripts/archive/fix-missing-titles.mjs`
* `scripts/archive/fix-name-clashes.mjs`
* `scripts/archive/fix-name-ledger-and-dailing-note.mjs`
* `scripts/archive/fix-other-two-books.mjs`
* `scripts/archive/fix-parent-cycles.mjs`
* `scripts/archive/fix-rest.mjs`
* `scripts/archive/fix-shared-courtesy-names.mjs`
* `scripts/archive/fix-split-sunhe.mjs`
* `scripts/archive/fix-sun-geshi.mjs`
* `scripts/archive/fix-sun-regress.mjs`
* `scripts/archive/fix-sunhe-note.mjs`
* `scripts/archive/fix-v195-broken-headers.mjs`
* `scripts/archive/fix-wrong-chapters.mjs`
* `scripts/archive/fix-wu-tail.mjs`
* `scripts/archive/fix-xiahou.mjs`
* `scripts/archive/purge-history-only.mjs`
* `scripts/archive/strip-fake-quotes.mjs`
* `scripts/archive/sync-name-form-ledger.mjs`
* `scripts/archive/tag-event-evidence.mjs`
