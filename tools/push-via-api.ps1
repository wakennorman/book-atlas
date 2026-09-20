# 通过 GitHub REST API 发布本地目录内容（git push 被墙时的替代方案）
# v2：改用 curl.exe 发请求（PowerShell 的 Invoke-RestMethod 在本机会因 IPv6/代理超时）
# 用法：powershell -ExecutionPolicy Bypass -File tools\push-via-api.ps1
param(
  [string]$RepoRoot = "D:\Claude Code+DeepSeekV4\book-atlas",
  [string]$Owner = "wakennorman",
  [string]$Repo = "book-atlas",
  [string]$Branch = "main",
  [string]$Message = "书脉 BookAtlas v0.2.1：修复图例取消筛选 + 发布脚本改用 curl"
)

$ErrorActionPreference = "Stop"
$api = "https://api.github.com"

# 1) 从 Git 凭据管理器取 token（不落盘、不打印）
$payload = "protocol=https`nhost=github.com`n`n"
$probe = $payload | & git credential fill 2>$null
$token = ($probe | Where-Object { $_ -match '^password=' } | Select-Object -First 1) -replace '^password=',''
if (-not $token) { throw "No token from git credential manager" }

function Api {
  param([string]$Method, [string]$Uri, $Body)
  $curlArgs = @('-s', '-L', '--max-time', '180', '-X', $Method, $Uri,
    '-H', "Authorization: Bearer $token",
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: book-atlas-publisher')
  $tmp = $null
  if ($null -ne $Body) {
    $tmp = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($tmp, ($Body | ConvertTo-Json -Depth 20 -Compress), (New-Object System.Text.UTF8Encoding($false)))
    $curlArgs += @('--data-binary', "@$tmp", '-H', 'Content-Type: application/json')
  }
  try {
    $out = & curl.exe @curlArgs '-w', "`n%{http_code}"
  } finally {
    if ($tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
  }
  $lines = $out -split "`n"
  $code = ($lines[-1]).Trim()
  $text = ($lines[0..($lines.Count - 2)] -join "`n").Trim()
  if ($code -notmatch '^2') { throw "HTTP $code :: $($text.Substring(0, [Math]::Min(300, $text.Length)))" }
  if (-not $text) { return $null }
  return $text | ConvertFrom-Json
}

"token ok ($($token.Length) chars)"
$me = Api GET "$api/user"
"user: $($me.login)"

# 2) 收集文件（跳过 .git）
$rootLen = $RepoRoot.TrimEnd('\').Length + 1
$files = Get-ChildItem -Path $RepoRoot -Recurse -File -Force | Where-Object { $_.FullName -notmatch '\\\.git\\' }
"files: $($files.Count)"

# 2.5) 空仓库需要先有第一个提交（blobs API 在空仓库会 409）
$initFile = Join-Path $RepoRoot ".nojekyll"
if (Test-Path $initFile) {
  try {
    $null = Api GET "$api/repos/$Owner/$Repo/git/ref/heads/$Branch"
    "repo already has $Branch"
  } catch {
    $initB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($initFile))
    $null = Api PUT "$api/repos/$Owner/$Repo/contents/.nojekyll" @{ message = "chore: init repo"; content = $initB64; branch = $Branch }
    "init commit created"
  }
}

# 3) 逐个建 blob
$tree = @()
$i = 0
foreach ($f in $files) {
  $i++
  $rel = $f.FullName.Substring($rootLen).Replace('\','/')
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName))
  $blob = Api POST "$api/repos/$Owner/$Repo/git/blobs" @{ content = $b64; encoding = "base64" }
  $tree += @{ path = $rel; mode = "100644"; type = "blob"; sha = $blob.sha }
  Write-Host ("  [{0}/{1}] {2}" -f $i, $files.Count, $rel)
}

# 4) tree + commit
$newTree = Api POST "$api/repos/$Owner/$Repo/git/trees" @{ tree = $tree }
$parents = @()
try { $ref = Api GET "$api/repos/$Owner/$Repo/git/ref/heads/$Branch"; $parents = @($ref.object.sha) } catch { }
$commitBody = @{ message = $Message; tree = $newTree.sha }
if ($parents.Count) { $commitBody.parents = $parents }
$commit = Api POST "$api/repos/$Owner/$Repo/git/commits" $commitBody
"commit: $($commit.sha)"

# 5) 创建/更新分支
if ($parents.Count) {
  $null = Api PATCH "$api/repos/$Owner/$Repo/git/refs/heads/$Branch" @{ sha = $commit.sha; force = $true }
} else {
  $null = Api POST "$api/repos/$Owner/$Repo/git/refs" @{ ref = "refs/heads/$Branch"; sha = $commit.sha }
}
"branch $Branch updated"

# 6) 本地 git 对齐（本地没有远程 commit 对象时跳过，等能连 github.com 再 fetch）
$eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
git -C $RepoRoot cat-file -e "$($commit.sha)^{commit}" 2>$null
$hasObj = ($LASTEXITCODE -eq 0)
if ($hasObj) {
  git -C $RepoRoot update-ref "refs/remotes/origin/$Branch" $commit.sha 2>$null
  git -C $RepoRoot update-ref "refs/heads/$Branch" $commit.sha 2>$null
  git -C $RepoRoot config "branch.$Branch.remote" origin
  git -C $RepoRoot config "branch.$Branch.merge" "refs/heads/$Branch"
  "local repo aligned"
} else {
  "local repo NOT aligned（本地缺远程对象；能连 github.com 时执行 git fetch 即可拉齐）"
}
$ErrorActionPreference = $eap

# 7) 开启 GitHub Pages（已开启会报 409，忽略）
try {
  $pages = Api POST "$api/repos/$Owner/$Repo/pages" @{ source = @{ branch = $Branch; path = "/" } }
  "pages: $($pages.html_url)"
} catch {
  try { $p2 = Api GET "$api/repos/$Owner/$Repo/pages"; "pages exists: $($p2.html_url)"; } catch { "pages status unknown: $($_.Exception.Message)" }
}
