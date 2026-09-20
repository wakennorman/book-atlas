# 通过 GitHub REST API 发布本地目录内容（git push 被墙时的替代方案）
# 用法：powershell -ExecutionPolicy Bypass -File tools\push-via-api.ps1
param(
  [string]$RepoRoot = "D:\Claude Code+DeepSeekV4\book-atlas",
  [string]$Owner = "wakennorman",
  [string]$Repo = "book-atlas",
  [string]$Branch = "main",
  [string]$Message = "书脉 BookAtlas v0.1：百年孤独数据 + 关系图/事件轴/两人关系查询"
)

$ErrorActionPreference = "Stop"
$api = "https://api.github.com"

# 1) 从 Git 凭据管理器取 token（不落盘、不打印）
$payload = "protocol=https`nhost=github.com`n`n"
$probe = $payload | & git credential fill 2>$null
$token = ($probe | Where-Object { $_ -match '^password=' } | Select-Object -First 1) -replace '^password=',''
if (-not $token) { throw "No token from git credential manager" }

$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/vnd.github+json"
  "User-Agent" = "book-atlas-publisher"
}

function Api {
  param([string]$Method, [string]$Uri, $Body)
  if ($Method -eq 'GET') { return Invoke-RestMethod -Method Get -Uri $Uri -Headers $headers }
  if ($null -ne $Body) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 20 -Compress))
    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -Body $bytes -ContentType 'application/json'
  }
  return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers
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
  $initB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($initFile))
  try {
    $null = Api PUT "$api/repos/$Owner/$Repo/contents/.nojekyll" @{ message = "chore: init repo"; content = $initB64; branch = $Branch }
    "init commit created"
  } catch {
    Write-Host "init skipped: $($_.Exception.Message)"
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

# 6) 本地 git 与远程对齐（内容一致，仅 SHA 不同）
git -C $RepoRoot update-ref "refs/remotes/origin/$Branch" $commit.sha
git -C $RepoRoot update-ref "refs/heads/$Branch" $commit.sha
git -C $RepoRoot config "branch.$Branch.remote" origin
git -C $RepoRoot config "branch.$Branch.merge" "refs/heads/$Branch"
"local repo aligned"

# 7) 开启 GitHub Pages
try {
  $pages = Api POST "$api/repos/$Owner/$Repo/pages" @{ source = @{ branch = $Branch; path = "/" } }
  "pages: $($pages.html_url)"
} catch {
  Write-Host "pages create failed: $($_.Exception.Message)"
  try { $p = Api GET "$api/repos/$Owner/$Repo/pages"; "pages exists: $($p.html_url)" } catch { "pages status unknown" }
}
