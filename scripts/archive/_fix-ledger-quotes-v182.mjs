/* 一次性补丁（v0.182）：把台账里 3 条「不是印刷版逐字」的引文按**原文**改正。
 * 【已归档】2026-10-12　v0.195 债二 B1：一次性补丁，用完即归档。
 *                     结论去向：CHANGELOG.md 的 v0.182 段
 *                     留在这里是为了留痕「当时怎么改的」，不再是可执行入口。
 *
 * ⚠ 第一版把「**整段替换文本**」拿去原文里查 ⇒ 必然查不到（那段里有我写的说明文字），
 *   于是它拒绝执行、什么都不改。**错的是判据**：要核的只有「」里那段**引文本身**。
 *   ⇒ 每条改动显式带上 `quote`（要核的那段）；`text`（要替换的字面串）另行断言命中一次。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_DIR, BOOK_TXT } from './lib/book-sources.mjs';

const WRITE = process.argv.includes('--write');

const EDIT = (rel, book, edits) => {
  const rawPath = path.join(SOURCE_DIR, BOOK_TXT[book] || '');
  const raw = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, 'utf8').replace(/[\s　]/g, '') : '';
  if (!raw) { console.error(`✗ ${rel}：读不到《${book}》原文（${rawPath}）⇒ 拒绝改`); return false; }
  let text = fs.readFileSync(rel, 'utf8');
  for (const { text: from, to, quote } of edits) {
    /* ① 要核的**引文本身**必须是印刷版逐字 */
    if (!raw.includes(quote.replace(/[\s　]/g, ''))) {
      console.error(`  ✗ ${rel}：引文不是印刷版逐字 ⇒ 拒绝改\n     ${JSON.stringify(quote)}`);
      return false;
    }
    /* ② 待替换的字面串必须**恰好出现一次**（多一处少一处都说明判断错了） */
    const hits = text.split(from).length - 1;
    if (hits !== 1) {
      console.error(`  ✗ ${rel}：待替换片段出现 ${hits} 次（应为 1）\n     ${JSON.stringify(from.slice(0, 50))}`);
      return false;
    }
    text = text.split(from).join(to);
    console.log(`  · 引文 ✓逐字  ${JSON.stringify(quote.slice(0, 40))}`);
  }
  if (WRITE) { fs.writeFileSync(rel, text, 'utf8'); console.log(`  ✓ 已写盘 ${rel}`); }
  return true;
};

const ok1 = EDIT('data/dup-names-ok.json', 'one-hundred-years-of-solitude', [
  {
    text: '原著里后者叫「何塞阿尔卡蒂奥」',
    to: '原著里后者叫「何塞·阿尔卡蒂奥」',
    quote: '何塞·阿尔卡蒂奥',
  },
  {
    text: '「乌尔苏拉几乎无睱顾及对何塞阿尔卡蒂奥的教皇培养，一转眼就到了他该收拾行装去上神学院的时候」',
    to: '「乌尔苏拉几乎无睱顾及对何塞·阿尔卡蒂奥的教皇培养，一转眼就到了他该收拾行装去上神学院的时候」',
    quote: '乌尔苏拉几乎无睱顾及对何塞·阿尔卡蒂奥的教皇培养，一转眼就到了他该收拾行装去上神学院的时候',
  },
]);

const ok2 = EDIT('data/first-ch-ok.json', 'three-kingdoms', [
  {
    text: '第 7 回那个「江夏张虎」是黄祖部将（原文「一个是江夏[202]张虎，一个是襄阳陈生」，随后「被韩当一刀，削去半个脑袋」），数据里的张虎是张辽之子、曹真先锋。',
    to: '第 7 回那个江夏张虎是黄祖部将（原文作「一个是江夏[202]张虎，一个是襄阳陈生」—— ⚠ 原书脚注标记 [202] 正好插在「江夏」与「张虎」之间，所以这两个字连写在原书里**从不出现**，不要拿它去逐字搜，也不要给它加引号），随后「被韩当一刀，削去半个脑袋」，数据里的张虎是张辽之子、曹真先锋。',
    quote: '一个是江夏[202]张虎，一个是襄阳陈生',
  },
]);

if (!ok1 || !ok2) { console.error('\n有改动不成立，拒绝落盘。'); process.exit(1); }
if (!WRITE) console.log('\n（演练：没有写盘。加 --write 才落盘）');