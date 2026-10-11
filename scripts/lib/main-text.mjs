/**
 * 「只含**正文**」的切分 —— v0.184 新建。
 *
 * ## 为什么需要它
 *
 * `data` 之外那份原著 txt（本机 `%TEMP%\opencode\ba-books\三国演义.txt`）是
 * **毛宗岗评点本**的电子版，里面混着**四类**东西，而脚本一直把它当一坨文本扫：
 *
 * | 类别 | 标记 | 实测规模 |
 * |---|---|---|
 * | ① **正文** 120 回 | `^第N回` 回目行 | **619,543 字（81%）** |
 * | ② 毛宗岗**评点** | 每回末尾一段连续的 `〚NNN〛` | 11,459 行 |
 * | ③ **音注夹注** | `[NNN]` 标记 | 3,748 处 |
 * | ④ **编者附录** | 版本分析 / 参考书目 / **古今地名对照表** / 注释 / 群英谱 / 作者介绍 | 分片 179–194 |
 *
 * ④ 里有 `山东省`（地名表）、`毛本`（版本分析）、`陈寿`（参考书目）、`罗贯中`（作者介绍）——
 * 这些**都不是这本书登场的人物**，却被缺口检测当成候选报出来。
 *
 * ## ⚠ 为什么是**可选**的过滤器，而不是改 `book-sources.mjs` 的默认行为
 *
 * 因为**有些判据必须能搜到评点**：
 *   · `check-ledger-quotes.mjs` 核台账引文 —— v0.181 的张温证据
 *     「同时有两张温。此一张温，乃汉张温也」**就是毛宗岗的评点**，而且是最硬的依据。
 *   · `fix-dup-names.mjs` 的 locate 短语同理。
 * ⇒ 「正文」是**缺口检测**这一个用途的口径，不是全局口径。
 *   **别把它设成默认**，否则会连带毁掉引文核验。
 *
 * ## 切分判据（全部机械，不写死分片号 —— 换个版本就错）
 *
 * ① 回目标题 `^第N回`。它在**目录里也出现一次**，所以取**同一回号最后一次**出现处。
 * ② 一回之内，回末那段「每个非空行都以 `〚NNN〛` 开头」的**连续区域**是评点，剔掉。
 *
 * ⚠ 第一版按"下一行也是回目 ⇒ 这是目录"来判目录，**恒假**：目录里回目与回目标题在
 *   **同一行**（`第一回 宴桃园豪杰三结义…`），下一行是**第二回**而不以 `第N回` 开头
 *   ⇒ 切出 **240** 回（目录 120 + 正文 120），且正文起点被拉到 CIP 页
 *   ⇒ `罗贯中`/`毛宗岗` 被当成正文。改成"同一回号取最后一次"才对。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 回目标题行：`第N回`。⚠ 必须**行首**锚定（MEMORY 记过：正文里也可能出现「第N回」三个字）。 */
const CHAPTER_HEAD = /^\s*第([一二三四五六七八九十百零〇\d]+)回/;
/** 评点行：毛宗岗评点的行首标记 `〚NNN〛`。 */
const COMMENT_LINE = /^\s*〚\d+〛/;

/**
 * 把一份评点本 txt 切成「每一回的正文体」。
 *
 * @param {string} text 原始 txt（**未压平**）
 * @returns {{chapters: Array<{ch:string, main:string, commentLines:number}>, stats:object}}
 */
export function extractChapters(text) {
  const lines = String(text || '').split(/\r?\n/);

  /* 同一回号出现多次（目录 + 正文）⇒ 取**最后一次**（正文在后） */
  const last = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = CHAPTER_HEAD.exec(lines[i]);
    if (m && !lines[i].trim().startsWith('〚')) last.set(m[1], i);
  }
  const marks = [...last.entries()].sort((a, b) => a[1] - b[1]);

  const chapters = marks.map(([ch, startLine], idx) => {
    const end = idx + 1 < marks.length ? marks[idx + 1][1] : lines.length;
    const body = lines.slice(startLine, end);
    /* 回末那段「每个非空行都是 〚NNN〛」的连续区域 = 评点 */
    let best = null, start = -1;
    for (let j = 0; j < body.length; j++) {
      const s = body[j].trim();
      if (s && COMMENT_LINE.test(body[j])) { if (start < 0) start = j; continue; }
      if (!s) continue;
      if (start >= 0) { const n = j - start; if (!best || n > best.n) best = { start, n }; start = -1; }
    }
    if (start >= 0) { const n = body.length - start; if (!best || n > best.n) best = { start, n }; }
    const cut = best && best.n >= 3 ? best.start : body.length;
    return { ch, main: body.slice(0, cut).join('\n'), commentLines: body.length - cut };
  });

  const flatLen = (s) => s.replace(/[\s·・･　]/g, '').length;
  const stats = {
    chapters: chapters.length,
    mainChars: chapters.reduce((a, c) => a + flatLen(c.main), 0),
    commentLines: chapters.reduce((a, c) => a + c.commentLines, 0),
  };
  return { chapters, stats };
}

/**
 * 只要正文，拼回一段文本。
 * ⚠ 这份 txt 里还有编者附录（版本分析 / 参考书目 / 地名表 / 群英谱 / 作者介绍），
 *   它们**不在任何一回之内** ⇒ 按"取 120 回的正文"这一步就自动排除了。
 *   实测：`山东省`/`毛本`/`陈寿`/`罗贯中`/`毛宗岗` 全部落到正文之外。
 */
export function mainTextOnly(text) {
  return extractChapters(text).chapters.map((c) => c.main).join('\n');
}

/** 从 txt 路径读正文（省得每个调用方自己拼路径）。 */
export function mainTextFromFile(file) {
  if (!fs.existsSync(file)) return null;
  return mainTextOnly(fs.readFileSync(file, 'utf8'));
}