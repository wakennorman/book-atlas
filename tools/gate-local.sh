#!/usr/bin/env bash
# 本机全量门禁运行器 —— `npm run gate` 在这台机器上**一步都跑不了**时的替代品。
#
# 用法：
#   bash tools/gate-local.sh                     # 跑全部步骤
#   bash tools/gate-local.sh --list              # 只列出会跑什么
#   bash tools/gate-local.sh --only check-dup    # 只跑命令里含该子串的步骤
#   bash tools/gate-local.sh --skip-slow         # 跳过四个最慢的（layout-stable / place-visible / lock / render-scale）
#
# ---------------------------------------------------------------------------
# 为什么需要它
#
# `tools/gate.mjs` 用 spawnSync 起子进程，而**本机 node 起不了任何子进程**
# （连 `spawnSync(process.execPath,['-e','0'])` 都 EBUSY）⇒ 它启动后先探一次，
# 探不通就直说"一步都跑不了"并 exit 1。于是本地验收退化成**人肉挑几条跑**。
#
# 人肉挑就会挑漏，而且漏得很安静。实测代价（v0.185，2026-10-11）：
#   CHANGELOG 写着「20 个相关门禁/检查全绿（含 validate / kin-check / relations /
#   parent-child / 5 个台账守卫 / check-event-chars / make-slim-packs）」——
#   那 20 条里**恰好不含** `make-anno-digest.mjs --check` 与 `check-packs-sync.mjs`，
#   而这两条正是能抓到「改了 data/*.json 却忘了重生成」的那两条。
#   ⇒ 于是带着 **2 道红门禁**上了 main，直到下一次全量复核才发现。
#   这跟本项目反复踩的那一族是同一个病：**"没跑"和"跑绿了"长得一模一样。**
#
# ---------------------------------------------------------------------------
# 命令从哪来
#
# 直接读 `.github/workflows/check.yml` 里 `run: node …` 的行，**连参数一起**取。
# ⚠ 不在这里重写"解析 yml"那套复杂逻辑 —— `tools/gate.mjs` 已经为它吃过三次亏
#   （见它文件头：只吃脚本名丢参数、`name:` 与 `run:` 之间注释太长整步漏掉、
#   `- run: node` 继承上一步名字）。本脚本只做最朴素的一条：
#   **`run:` 行去掉前缀就是命令**，参数天然保留，不需要识别步骤边界。
#
# 跑之前先跟 gate.mjs 对一次**步数**与**参数自检**：
#   · gate.mjs 报的步数 ≠ 本脚本抽到的行数 ⇒ 立刻 exit 2 拒绝跑
#     （说明 yml 的写法变了、或这里抽漏了，继续跑就会"少跑几步还报全绿"）
#   · gate.mjs 的参数自检没过 ⇒ 同样拒绝跑
# 宁可现在报错，也不要跑一个"看起来全绿"的门禁。
#
# ⚠ **只抽 `run: node …` 会漏掉「不是 node 的检查步骤」**（v0.188 实测）：
#   check.yml 里 ESLint 那一步写的是 `npx eslint …`，`gate.mjs` 与本脚本的抽取都不认它
#   ⇒ 本地全量跑绿、CI 上 lint 报红，仍然是"本地绿 ≠ CI 绿"。
#   所以下面第 2b 段把非 node 的检查步骤也收进来，并用写死的 EXTRA_EXPECT 逼人登记。
#
# ⚠ 与 `npm run gate` 的差异：这里**不区分 blocked / failed** ——
#   能跑起来就是真结果。浏览器测试在本机会真的跑（找得到 Edge），只是慢。
# ⚠ `GATE_YML` 环境变量**只给测试用**（指一份改了步数的 yml，证明"对不上就拒绝跑"这条真会红）。
#   不设时行为逐字相同。
# ⚠ 本机 fork 一个进程要一百多毫秒 ⇒ 全程**避免逐行起外部命令**：
#   抽取是单趟 grep+sed，筛选用 bash 内建 `case`/`[[ ]]`，统计 ✗ 行数用内建 read 循环。
#   （第一版逐行 `printf | sed | sed` 抽 72 行就卡了几十秒。）
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

YML=${GATE_YML:-.github/workflows/check.yml}
NODE=${NODE:-node}

ONLY=''
SKIP_SLOW=0
LIST_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only)      ONLY="${2:-}"; shift 2 ;;
    --skip-slow) SKIP_SLOW=1; shift ;;
    --list)      LIST_ONLY=1; shift ;;
    -h|--help)   sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "未知参数：$1（用 --help 看用法）"; exit 2 ;;
  esac
done

[ -f "$YML" ] || { echo "✗ 找不到 $YML"; exit 2; }

# ---- 1. 先问 gate.mjs：一共几步？参数自检过没过？ ----
if ! list_out=$($NODE tools/gate.mjs --list 2>&1); then
  printf '%s\n' "$list_out"
  echo "✗ tools/gate.mjs --list 没跑成（它自己会说明原因）"
  exit 2
fi
case "$list_out" in
  *参数自检通过*) ;;
  *) printf '%s\n' "$list_out"; echo "✗ gate.mjs 的参数自检未通过 ⇒ 拒绝跑"; exit 2 ;;
esac
EXPECT=$(printf '%s\n' "$list_out" | sed -n 's/^门禁共 \([0-9][0-9]*\) 步.*/\1/p' | head -1)
[ -n "$EXPECT" ] || { printf '%s\n' "$list_out"; echo "✗ 读不出步数 ⇒ 拒绝跑"; exit 2; }

# ---- 2. 单趟抽出全部命令（`run: node …`，连参数） ----
CMDS=()
while IFS= read -r cmd; do
  CMDS+=("$cmd")
done < <(grep -E '^[[:space:]]*(-[[:space:]]*)?run:[[:space:]]*node[[:space:]]' "$YML" \
        | sed -E 's/^[[:space:]]*(-[[:space:]]*)?run:[[:space:]]*//; s/[[:space:]]+$//')

for c in "${CMDS[@]}"; do
  case "$c" in
    node\ *) ;;
    *) echo "✗ 抽出来的这一行不是 node 命令，拒绝跑：$c"; exit 2 ;;
  esac
done

if [ "${#CMDS[@]}" -ne "$EXPECT" ]; then
  echo "✗ 本脚本从 yml 抽到 ${#CMDS[@]} 条命令，而 gate.mjs 说共 $EXPECT 步。"
  echo "  ⇒ 两边不同步（yml 换了写法，或这里抽漏了）。继续跑就会「少跑几步还报全绿」。"
  exit 2
fi

# ---- 2b. 非 node 的检查步骤（gate.mjs 与上面第 2 段都不认它们） ----
# ⚠ EXTRA_EXPECT 是**故意写死**的：check.yml 里多/少一条非 node 检查步骤，必须有人来改这个数，
#   否则新加的门禁会「本地永远不跑」—— 那正是本脚本存在的理由。
#   现状：唯一一条非 node 检查步骤 = `npx eslint …`。
#   （`npm install` 是装依赖、`run: |` 是多行 bash 块，都不是「一条检查」，不收。）
EXTRA_EXPECT=1
EXTRA=()
while IFS= read -r cmd; do
  case "$cmd" in
    node\ *|npm\ install*|npm\ ci*|npm\ i) continue ;;
  esac
  EXTRA+=("$cmd")
done < <(grep -E '^[[:space:]]*(-[[:space:]]*)?run:[[:space:]]*[^|[:space:]]' "$YML" \
        | sed -E 's/^[[:space:]]*(-[[:space:]]*)?run:[[:space:]]*//; s/[[:space:]]+$//')

if [ "${#EXTRA[@]}" -ne "$EXTRA_EXPECT" ]; then
  echo "✗ 从 yml 抽到 ${#EXTRA[@]} 条「非 node 的检查步骤」，而本脚本记的是 $EXTRA_EXPECT 条。"
  echo "  ⇒ check.yml 加/删了非 node 步骤。请改本脚本的 EXTRA_EXPECT 把它登记进来，"
  echo "    否则它会静默不跑 —— 本地绿、CI 红。抽到的是："
  for c in ${EXTRA[@]+"${EXTRA[@]}"}; do echo "    $c"; done
  exit 2
fi

CMDS+=(${EXTRA[@]+"${EXTRA[@]}"})

# ---- 3. 过滤（内建，不起子进程） ----
SLOW_RE='layout-stable|place-visible|lock|render-scale'
SELECTED=()
for c in "${CMDS[@]}"; do
  if [ -n "$ONLY" ]; then case "$c" in *"$ONLY"*) ;; *) continue ;; esac; fi
  if [ "$SKIP_SLOW" = 1 ] && [[ "$c" =~ $SLOW_RE ]]; then continue; fi
  SELECTED+=("$c")
done

if [ "$LIST_ONLY" = 1 ]; then
  echo "会跑 ${#SELECTED[@]} 步（check.yml 共 $EXPECT 步 + $EXTRA_EXPECT 条非 node 检查）"
  for c in "${SELECTED[@]}"; do echo "  $c"; done
  exit 0
fi

# ---- 4. 逐条跑（bash 起 node 没问题；被拦的只是 "node 再起 node"） ----
echo "本机全量门禁：跑 ${#SELECTED[@]} 步（check.yml 共 $EXPECT 步 + $EXTRA_EXPECT 条非 node 检查）"
echo
PASS=0; FAIL=0; FAILED=()
for c in "${SELECTED[@]}"; do
  out=$($c 2>&1); code=$?
  red=0; redlines=''
  while IFS= read -r l; do
    case "$l" in
      *✗*) red=$((red + 1))
           [ "$red" -le 3 ] && redlines="$redlines        $l
" ;;
    esac
  done <<< "$out"
  if [ "$code" -eq 0 ] && [ "$red" -eq 0 ]; then
    PASS=$((PASS + 1))
    printf '  ✓ %s\n' "$c"
  else
    FAIL=$((FAIL + 1)); FAILED+=("$c")
    printf '  ✗ %s   exit=%s  红行=%s\n' "$c" "$code" "$red"
    printf '%s' "$redlines"
  fi
done

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✓ 全部 $PASS 步通过"
  exit 0
fi
echo "✗ $FAIL 步报红（通过 $PASS）："
for c in "${FAILED[@]}"; do echo "    $c"; done
exit 1
