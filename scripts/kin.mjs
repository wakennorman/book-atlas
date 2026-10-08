#!/usr/bin/env node
/**
 * 亲属关系（kin）规范 —— 编辑器 / validate.mjs / annotate-kin.mjs 共用这套口径
 *
 * 为什么要有它：《百年孤独》里既有亲生的（乌尔苏拉→「巨人」是亲母子），
 * 也有收养的（乌尔苏拉↔丽贝卡=养母女）、有非正式的"带大"（乌尔苏拉把孙子带大）、
 * 有姻亲（婆媳/岳父）——如果全都写成「母子」，读者就分不清这条线是不是血缘。
 * 所以：**是家人的关系要标 kin，且 type 的措辞必须跟 kin 一致。**
 *
 * 值：
 *   blood    血缘（亲生；含祖孙、叔侄、舅甥、堂表、孪生）
 *   marriage 婚姻（夫妻、妾室）
 *   inlaw    姻亲（岳父岳母、公婆、儿媳、女婿、嫂、姐夫、妯娌、亲家…）
 *   adoptive 收养（正式收养：养父母 / 养子女）
 *   foster   抚养（非正式：被谁带大、寄养、乳母养大的孩子）
 *   step     继亲（继父母 / 继子女）
 *   sworn    结义干亲（结拜兄弟、干爹干娘、教父教子）
 */

export const KIN = {
  blood: '血缘',
  marriage: '婚姻',
  inlaw: '姻亲',
  adoptive: '收养',
  foster: '抚养',
  step: '继亲',
  sworn: '结义',
};

export const KIN_KEYS = Object.keys(KIN);
export const kinLabel = (k) => KIN[k] || '';

// 明确「不是家人」的词，先挡掉，避免"保姆"撞上"母"、"房东"撞上"父"
const NOT_KIN = /保姆|帮佣|佣人|房东|房客|租客|雇主|信使|使者|囚徒|囚犯|同学|同窗|同舍|同门|同砚|同僚|座师|门生|朋友|挚友|战友|同乡|医生|病人|酒鬼|神父|牧师|校长|老师|学生|上司|下属|对手|政敌|情敌|仇敌|熟人|忘年交|邻居|日常|试探|陷害|决斗|亡灵|幽灵|交情|相遇|意外|犯罪|罪人|同事/;
/* ⚠ 「义」必须**跟一个亲属字**才算结义 —— 裸 `义` 会误伤
 *   「同盟（义状）」「恩义」「义释」「义友」「旧义之将」这些**非亲属**词。 */
const SWORN = /义[父母子女儿兄姐弟妹叔伯侄甥姑姨舅祖同]|情同|干[亲爹娘兄弟姐弟儿女]|结义|结拜|拜把|把兄弟|教[父母]|教子|教女|盟兄弟/;
/* ⚠ 必须**锚定在开头**、并排除「养大／养育」：
 *   不锚定的话「抚养」里的那个「养」也会命中，而 ADOPTIVE 先于 FOSTER 判 ⇒ 把抚养误判成收养。
 *   原写法只枚举了「养父母子女、养兄姐弟妹」，漏了「养祖孙／养曾祖孙／养高祖父…」
 *   ⇒ validate 报 42 条「看着像血缘，但标的是收养」的**假警告**（type 明明写着「养」）。 */
const ADOPTIVE = /收养|抱养|过继|^养[^大育]/;
const FOSTER = /抚养|带大|养大|养育|寄养|乳母|奶妈/;
const STEP = /继[父母子女儿]|后妈|后爹|晚娘|晚爹|填房/;
/* ⚠ 「妻X」「国舅」「姻亲」「内兄」都是姻亲，但含「妻/舅/兄/弟」这些血缘字 ——
 *   旧写法只枚举了内兄/内弟/大舅子/小舅子，漏了「妻舅／妻弟／妻兄／国舅／姻亲」，
 *   于是它们被判成血缘 ⇒ 又一串假警告。 */
const INLAW = /岳[父母]|公公|婆婆|婆媳|孙媳|儿媳|儿媳妇|女婿|姑爷|嫂|姐夫|妹夫|弟媳|妯娌|连襟|亲家|内[兄弟]|舅子|妻[舅弟兄姐妹]|国舅|姻亲/;
const MARRIAGE = /夫妻|配偶|丈夫|妻子|妾|姨太太/;
const LOVE = /未婚|恋人|情人|相好|单相思|拒婚|婚约|私情/;
const BLOOD = /[父母]亲|父|母|儿子|女儿|子|女|兄|弟|姐|妹|孙|外公|外婆|祖父|祖母|叔|伯|姑|姨|舅|甥|侄|堂兄弟|堂姐妹|堂兄妹|堂姐弟|堂亲|表兄弟|表姐妹|表兄妹|表姐弟|表亲|孪生|双胞胎|家人|本家|长辈|后辈|血脉/;

/**
 * 从关系名猜 kin；猜不出来就返回 ''（宁缺勿错——不硬套）
 */
export function guessKin(type) {
  const t = String(type || '');
  if (!t) return '';
  // 先看明确的几类（它们比"父/母/兄/弟"这类字更具体）
  if (SWORN.test(t)) return 'sworn';
  if (ADOPTIVE.test(t)) return 'adoptive';
  if (STEP.test(t)) return 'step';
  if (INLAW.test(t)) return 'inlaw';
  if (FOSTER.test(t)) return 'foster';
  if (!/未婚/.test(t) && MARRIAGE.test(t)) return 'marriage';
  if (NOT_KIN.test(t)) return '';
  if (BLOOD.test(t)) return 'blood';
  if (LOVE.test(t)) return '';
  return '';
}

/** 纯血缘称谓（不许用来写收养/继亲/结义/抚养） */
const BLOOD_TERM = /^(父子|父女|母子|母女|兄弟|姐妹|兄妹|姐弟|祖孙|曾祖孙|叔侄|舅甥|姨甥|姑侄|表兄弟|表兄妹|堂兄弟|堂兄妹|孪生兄弟|孪生姐妹|父子关系)/;

/**
 * 规则检查：返回 [{ level: 'error'|'warn', msg }]
 * @param {{type?:string, kin?:string}} rel
 */
export function checkKin(rel) {
  const out = [];
  const type = String(rel?.type || '');
  const kinRaw = String(rel?.kin ?? '').trim();
  const kin = /^(空|无|none|null|-|否)$/i.test(kinRaw) ? '' : kinRaw;
  const guessed = guessKin(type);
  if (kin && !KIN_KEYS.includes(kin)) {
    out.push({ level: 'error', msg: `kin「${kin}」不合法（应为 ${KIN_KEYS.join(' | ')}，或留空）` });
    return out;
  }
  if (!kin) {
    if (guessed) out.push({ level: 'warn', msg: `像是亲属关系（type「${type}」），建议补 kin: "${guessed}"（${KIN[guessed]}）` });
    return out;
  }
  // 有 kin：措辞必须与之一致
  const vague = ['adoptive', 'foster', 'step', 'sworn'];
  if (vague.includes(kin) && BLOOD_TERM.test(type)) {
    out.push({ level: 'error', msg: `kin=${kin}（${KIN[kin]}）但 type「${type}」是血缘称谓——收养/继亲/结义/抚养不要写成「父子/母子/兄弟」这类词，要说清是哪一种` });
  }
  if (kin === 'blood' && !guessed) {
    out.push({ level: 'warn', msg: `标了 kin=blood，但 type「${type}」看不出是血缘称谓` });
  }
  if (guessed && guessed !== kin) {
    out.push({ level: 'warn', msg: `type「${type}」看着像 ${KIN[guessed]}，但标的是 ${KIN[kin]}——对一下哪个对` });
  }
  return out;
}
