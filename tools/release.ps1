<#
.SYNOPSIS
    Pipeline de release des jeux Godot vers jnm.app/jeux (binaires sur Cloudflare R2).

.DESCRIPTION
    release.ps1 build   <jeu>   Exporte Windows / Android / macOS dans un dossier de préparation.
    release.ps1 shots   <jeu>   Génère (tools/shots.gd du jeu) ou importe (-From) les captures en WebP.
    release.ps1 publish <jeu>   Envoie la version préparée sur R2, met à jour la fiche, applique la
                                rétention, puis commit + push du site (GitHub Pages redéploie).
    release.ps1 list            Liste les jeux publiés et leurs versions.

    <jeu> = nom du dossier dans D:\godot (ex. commun) ou chemin complet du projet.

.EXAMPLE
    ./tools/release.ps1 build commun
    ./tools/release.ps1 shots commun
    ./tools/release.ps1 publish commun -Notes "Nouveau mode défi du jour."

.EXAMPLE
    # Publier des builds déjà faits (sans réexporter)
    ./tools/release.ps1 build parjure -Windows D:\build\windows\Parjure_v0.1.0.exe -Android D:\build\android\Parjure_v0.1.0.apk -Mac D:\build\mac\Parjure_v0.1.0.zip
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0, Mandatory)][ValidateSet('build', 'shots', 'publish', 'list')][string]$Command,
    [Parameter(Position = 1)][string]$Project,
    [string]$Version,
    [ValidateSet('windows', 'android', 'macos')][string[]]$Platforms = @('windows', 'android', 'macos'),
    [string]$Windows,
    [string]$Android,
    [string]$Mac,
    [string]$From,
    [string]$Notes,
    [switch]$Milestone,
    [int]$Keep,
    [switch]$SkipUpload,
    [switch]$NoPush,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Site = Split-Path $PSScriptRoot -Parent
$Config = Get-Content (Join-Path $PSScriptRoot 'release.config.json') -Raw | ConvertFrom-Json
$SiteCfg = Get-Content (Join-Path $Site 'content/site.json') -Raw | ConvertFrom-Json
$GamesContent = Join-Path $Site 'content/games'
$StageRoot = Join-Path $env:LOCALAPPDATA 'jnm-release/stage'
if (-not $Keep) { $Keep = $Config.keep }

$PresetPlatform = @{ windows = 'Windows Desktop'; android = 'Android'; macos = 'macOS' }
$LocalSub = @{ windows = 'windows'; android = 'android'; macos = 'mac' }

function Step($msg) { Write-Host "`n▸ $msg" -ForegroundColor Cyan }
function Info($msg) { Write-Host "  $msg" }
function Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Fail($msg) { throw $msg }

# ---------- projet Godot ----------

function Resolve-Project([string]$p) {
    if (-not $p) { $p = (Get-Location).Path }
    if (-not (Test-Path $p)) { $p = Join-Path $Config.gamesDir $p }
    $p = (Resolve-Path $p).Path
    if (-not (Test-Path (Join-Path $p 'project.godot'))) { Fail "Pas de project.godot dans $p" }
    return $p
}

function Read-ProjectSetting([string]$proj, [string]$key) {
    $m = Select-String -Path (Join-Path $proj 'project.godot') -Pattern ('^' + [regex]::Escape($key) + '=(.*)$') | Select-Object -First 1
    if (-not $m) { return $null }
    return $m.Matches[0].Groups[1].Value.Trim('"')
}

function Read-Presets([string]$proj) {
    $file = Join-Path $proj 'export_presets.cfg'
    if (-not (Test-Path $file)) { return @() }
    $presets = [ordered]@{}
    $cur = $null
    foreach ($line in Get-Content $file) {
        if ($line -match '^\[preset\.(\d+)(\.options)?\]') { $cur = $Matches[1]; if (-not $presets.Contains($cur)) { $presets[$cur] = @{ options = @{} } }; $isOpt = [bool]$Matches[2]; continue }
        if ($null -eq $cur -or $line -notmatch '^([^=]+)=(.*)$') { continue }
        $k = $Matches[1]; $v = $Matches[2].Trim('"')
        if ($isOpt) { $presets[$cur].options[$k] = $v } else { $presets[$cur][$k] = $v }
    }
    return @($presets.Values)
}

function Find-Preset($presets, [string]$platform) {
    $wanted = $PresetPlatform[$platform]
    $all = @($presets | Where-Object { $_['platform'] -eq $wanted })
    if (-not $all) { return $null }
    $exact = $all | Where-Object { $_['name'] -in @($wanted, $platform, 'Windows', 'Android', 'macOS') } | Select-Object -First 1
    if ($exact) { return $exact }
    return $all[0]
}

function Get-ProjectVersion([string]$proj, $presets) {
    $v = Read-ProjectSetting $proj 'config/version'
    if ($v) { return $v }
    foreach ($key in 'version/name', 'application/short_version') {
        $hit = $presets | ForEach-Object { $_.options[$key] } | Where-Object { $_ } | Select-Object -First 1
        if ($hit) { return $hit }
    }
    return $null
}

function Get-Godot([string]$proj) {
    $features = Read-ProjectSetting $proj 'config/features'
    $major = if ($features -match '"(\d+\.\d+)"') { $Matches[1] } else { '' }
    $mono = [bool](Get-ChildItem $proj -Filter *.csproj -ErrorAction SilentlyContinue)
    $all = Get-ChildItem $Config.godotDir -Filter 'Godot_v*_console.exe' | Where-Object { ($_.Name -match 'mono') -eq $mono }
    $match = $all | Where-Object { $_.Name -like "Godot_v$major*" } | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $match) {
        $match = $all | Sort-Object Name -Descending | Select-Object -First 1
        Warn "Aucun Godot $major trouvé, utilisation de $($match.Name)"
    }
    return $match.FullName
}

function ConvertTo-Slug([string]$s) {
    $n = $s.Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', ''
    return (($n.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-'))
}

# ---------- fiche (content/games/<slug>/game.json) ----------

function Find-Slug([string]$proj, [string]$title) {
    $folder = Split-Path $proj -Leaf
    if (Test-Path $GamesContent) {
        foreach ($f in Get-ChildItem $GamesContent -Directory) {
            $j = Join-Path $f.FullName 'game.json'
            if ((Test-Path $j) -and ((Get-Content $j -Raw | ConvertFrom-Json).source -eq $folder)) { return $f.Name }
        }
    }
    return ConvertTo-Slug $title
}

function Read-Game([string]$slug) {
    $path = Join-Path $GamesContent "$slug/game.json"
    if (Test-Path $path) { return Get-Content $path -Raw | ConvertFrom-Json -AsHashtable }
    return $null
}

function Save-Game([string]$slug, $game) {
    $dir = Join-Path $GamesContent $slug
    New-Item -ItemType Directory -Force $dir | Out-Null
    $game | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $dir 'game.json') -Encoding utf8NoBOM
}

function New-GameSkeleton([string]$proj, [string]$title, [string]$slug) {
    $game = [ordered]@{
        title    = $title
        source   = (Split-Path $proj -Leaf)
        tagline  = (Read-ProjectSetting $proj 'config/description')
        summary  = ''
        controls = ''
        genres   = @()
        players  = 'Solo'
        language = 'Français'
        status   = 'Alpha'
        pixelArt = $false
        media    = [ordered]@{ cover = $null; icon = $null; screenshots = @() }
        versions = @()
    }
    $icon = Read-ProjectSetting $proj 'config/icon'
    if ($icon) {
        $iconPath = Join-Path $proj ($icon -replace '^res://', '')
        if ((Test-Path $iconPath) -and $iconPath -match '\.(png|webp|jpg)$') {
            $media = Join-Path $GamesContent "$slug/media"
            New-Item -ItemType Directory -Force $media | Out-Null
            $name = 'icon' + [IO.Path]::GetExtension($iconPath)
            Copy-Item $iconPath (Join-Path $media $name) -Force
            $game.media.icon = "media/$name"
        }
    }
    return $game
}

# ---------- R2 (rclone) ----------

function Initialize-R2 {
    $path = $Config.secrets -replace '^~', $HOME
    if (-not (Test-Path $path)) { Fail "Fichier de clés R2 absent : $path (voir tools/README.md)" }
    $vars = @{}
    foreach ($line in Get-Content $path) {
        if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { $vars[$Matches[1]] = $Matches[2].Trim('"') }
    }
    foreach ($k in 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET') {
        if (-not $vars[$k]) { Fail "$k manquant dans $path" }
    }
    # Tolère un ID collé avec un préfixe ou sous forme d'endpoint complet : on garde les 32 caractères hexadécimaux.
    if ($vars.R2_ACCOUNT_ID -match '([0-9a-fA-F]{32})') { $vars.R2_ACCOUNT_ID = $Matches[1].ToLowerInvariant() }
    else { Fail "R2_ACCOUNT_ID doit contenir l'Account ID Cloudflare (32 caractères hexadécimaux)" }
    if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) { Fail 'rclone introuvable (winget install Rclone.Rclone)' }
    $env:RCLONE_LOW_LEVEL_RETRIES = '3'
    $env:RCLONE_CONTIMEOUT = '15s'
    $env:RCLONE_CONFIG_R2_TYPE = 's3'
    $env:RCLONE_CONFIG_R2_PROVIDER = 'Cloudflare'
    $env:RCLONE_CONFIG_R2_ACCESS_KEY_ID = $vars.R2_ACCESS_KEY_ID
    $env:RCLONE_CONFIG_R2_SECRET_ACCESS_KEY = $vars.R2_SECRET_ACCESS_KEY
    $env:RCLONE_CONFIG_R2_ENDPOINT = "https://$($vars.R2_ACCOUNT_ID).r2.cloudflarestorage.com"
    $env:RCLONE_CONFIG_R2_NO_CHECK_BUCKET = 'true'
    return $vars.R2_BUCKET
}

function Invoke-Rclone {
    & rclone @args
    if ($LASTEXITCODE -ne 0) { Fail "rclone $($args[0]) a échoué ($LASTEXITCODE)" }
}

# ---------- commandes ----------

function Invoke-Build {
    $proj = Resolve-Project $Project
    $presets = Read-Presets $proj
    $title = Read-ProjectSetting $proj 'config/name'
    $ver = if ($Version) { $Version } else { Get-ProjectVersion $proj $presets }
    if (-not $ver) { Fail 'Version introuvable : ajoute config/version dans project.godot ou passe -Version.' }
    $slug = Find-Slug $proj $title
    $stage = Join-Path $StageRoot "$slug/$ver"

    Step "$title v$ver ($slug)"
    $game = Read-Game $slug
    if ($game -and ($game.versions | Where-Object { $_.version -eq $ver -and $_.available }) -and -not $Force) {
        Fail "v$ver est déjà publiée. Monte la version dans project.godot, ou -Force pour la remplacer."
    }
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
    New-Item -ItemType Directory -Force $stage | Out-Null

    $existing = @{ windows = $Windows; android = $Android; macos = $Mac }
    $useExisting = [bool]($Windows -or $Android -or $Mac)
    $godot = if ($useExisting) { $null } else { Get-Godot $proj }
    if ($godot) {
        Info "Godot : $(Split-Path $godot -Leaf)"
        Step 'Import des ressources'
        & $godot --headless --path $proj --import 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { Warn "import terminé avec le code $LASTEXITCODE (on continue)" }
    }

    $files = [ordered]@{}
    foreach ($p in $Platforms) {
        $tmp = Join-Path $stage "_$p"
        New-Item -ItemType Directory -Force $tmp | Out-Null
        if ($useExisting) {
            if (-not $existing[$p]) { continue }
            Step "$p : build existant"
            Copy-Item $existing[$p] $tmp
        } else {
            $preset = Find-Preset $presets $p
            if (-not $preset) { Warn "$p : pas de preset d'export, ignoré"; continue }
            $ext = @{ windows = 'exe'; android = 'apk'; macos = 'zip' }[$p]
            Step "$p : export « $($preset['name']) »"
            $log = Join-Path $stage "$p-export.log"
            & $godot --headless --path $proj --export-release $preset['name'] (Join-Path $tmp "$slug.$ext") *> $log
            $code = $LASTEXITCODE
            if ($code -ne 0 -or -not (Get-ChildItem $tmp -File)) {
                Get-Content $log -Tail 15 | ForEach-Object { Info $_ }
                Fail "$p : export échoué (code $code, journal : $log)"
            }
        }

        $produced = @(Get-ChildItem $tmp -File)
        $main = $produced | Sort-Object Length -Descending | Select-Object -First 1
        if ($main.Length -lt 512KB) { Fail "$p : fichier suspect ($($main.Name), $($main.Length) octets)" }

        switch ($p) {
            'windows' {
                if ($produced.Count -eq 1 -and $main.Extension -eq '.exe') { $name = "$slug-v$ver-windows-x64.exe"; Move-Item $main.FullName (Join-Path $stage $name) }
                elseif ($produced.Count -eq 1 -and $main.Extension -eq '.zip') { $name = "$slug-v$ver-windows-x64.zip"; Move-Item $main.FullName (Join-Path $stage $name) }
                else { $name = "$slug-v$ver-windows-x64.zip"; Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath (Join-Path $stage $name) }
            }
            'android' {
                if ($main.Extension -ne '.apk') { Fail "android : attendu un .apk, reçu $($main.Name)" }
                $name = "$slug-v$ver-android.apk"; Move-Item $main.FullName (Join-Path $stage $name)
            }
            'macos' {
                if ($main.Extension -ne '.zip') { Fail "macos : attendu un .zip, reçu $($main.Name)" }
                $zip = [IO.Compression.ZipFile]::OpenRead($main.FullName)
                try { if (-not ($zip.Entries | Where-Object FullName -match '\.app/Contents/MacOS/')) { Fail 'macos : le zip ne contient pas de .app' } } finally { $zip.Dispose() }
                $name = "$slug-v$ver-macos.zip"; Move-Item $main.FullName (Join-Path $stage $name)
            }
        }
        Remove-Item $tmp -Recurse -Force
        $full = Join-Path $stage $name
        $files[$p] = [ordered]@{
            file   = "$slug/$ver/$name"
            size   = (Get-Item $full).Length
            sha256 = (Get-FileHash $full -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        Info ("{0} · {1:N1} Mo" -f $name, ($files[$p].size / 1MB))

        if ($Config.localBuildDir -and -not $useExisting) {
            $dest = Join-Path $Config.localBuildDir $LocalSub[$p]
            New-Item -ItemType Directory -Force $dest | Out-Null
            Copy-Item $full $dest -Force
        }
    }
    if (-not $files.Count) { Fail 'Aucun livrable produit.' }

    [ordered]@{ slug = $slug; title = $title; version = $ver; project = $proj; date = (Get-Date -Format 'yyyy-MM-dd'); files = $files } |
        ConvertTo-Json -Depth 6 | Set-Content (Join-Path $stage 'release.json') -Encoding utf8NoBOM

    if (-not $game) {
        Save-Game $slug (New-GameSkeleton $proj $title $slug)
        Info "Fiche créée : content/games/$slug/game.json (résumé et genres à rédiger)"
    }
    Step "Prêt à publier : $stage"
}

function Invoke-Shots {
    $proj = Resolve-Project $Project
    $title = Read-ProjectSetting $proj 'config/name'
    $slug = Find-Slug $proj $title
    $game = Read-Game $slug
    if (-not $game) { $game = New-GameSkeleton $proj $title $slug }
    $raw = $From
    if (-not $raw) {
        $raw = Join-Path $env:TEMP "jnm-shots-$slug"
        if (Test-Path $raw) { Remove-Item $raw -Recurse -Force }
        New-Item -ItemType Directory -Force $raw | Out-Null
        $godot = Get-Godot $proj
        Step 'Captures (le jeu va s''ouvrir quelques secondes)'
        if (Test-Path (Join-Path $proj 'tools/shots.gd')) {
            # Outil propre au jeu : il parcourt les écrans clés.
            $proc = Start-Process $godot -ArgumentList '--path', "`"$proj`"", '-s', 'tools/shots.gd', '--', "`"$raw`"" -PassThru -NoNewWindow
            if (-not $proc.WaitForExit(300000)) { $proc.Kill(); Fail 'shots.gd ne s''est pas terminé en 5 minutes' }
        } else {
            # Repli générique : Godot enregistre 9 s du jeu lancé normalement ; sans interaction ce n'est
            # que l'écran titre, donc une seule image (la couverture).
            Warn 'Pas de tools/shots.gd : captures génériques (écran de démarrage seulement).'
            $frames = Join-Path $raw 'frames'
            New-Item -ItemType Directory -Force $frames | Out-Null
            $proc = Start-Process $godot -ArgumentList '--path', "`"$proj`"", '--write-movie', "`"$(Join-Path $frames 'f.png')`"", '--fixed-fps', '10', '--quit-after', '90' -PassThru -NoNewWindow
            if (-not $proc.WaitForExit(180000)) { $proc.Kill() }
            $all = @(Get-ChildItem $frames -Filter 'f*.png' | Sort-Object Name)
            if (-not $all) { Fail 'Aucune image enregistrée.' }
            Copy-Item $all[-1].FullName (Join-Path $raw 'auto-title.png')
            Remove-Item $frames -Recurse -Force
        }
    }
    $media = Join-Path $GamesContent "$slug/media"
    $out = Join-Path $env:TEMP "jnm-webp-$slug"
    if (Test-Path $out) { Remove-Item $out -Recurse -Force }
    $godot = Get-Godot $proj
    $mode = if ($game.pixelArt) { 'nearest' } else { 'lanczos' }
    & $godot --headless -s (Join-Path $PSScriptRoot 'godot/towebp.gd') -- $raw $out 1920 $mode 2>&1 | Out-Null
    $webp = @(Get-ChildItem $out -Filter *.webp -ErrorAction SilentlyContinue | Sort-Object Name)
    if (-not $webp) { Fail "Aucune capture convertie depuis $raw" }

    New-Item -ItemType Directory -Force $media | Out-Null
    Get-ChildItem $media -Filter 'shot-*.webp' | Remove-Item -Force
    $list = @()
    $i = 1
    foreach ($f in $webp) {
        $name = 'shot-{0:D2}.webp' -f $i++
        Copy-Item $f.FullName (Join-Path $media $name)
        $list += "media/$name"
    }
    $game.media.screenshots = $list
    if (-not $game.media.cover -or $game.media.cover -like 'media/shot-*') { $game.media.cover = $list[0] }
    Save-Game $slug $game
    Step "$($list.Count) capture(s) → content/games/$slug/media (couverture : $($game.media.cover))"
}

function Invoke-Publish {
    $proj = Resolve-Project $Project
    $title = Read-ProjectSetting $proj 'config/name'
    $slug = Find-Slug $proj $title
    $dir = if ($Version) { Join-Path $StageRoot "$slug/$Version" } else { Get-ChildItem (Join-Path $StageRoot $slug) -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName }
    if (-not $dir -or -not (Test-Path (Join-Path $dir 'release.json'))) { Fail "Rien de préparé pour $slug : lance d'abord « build »." }
    $rel = Get-Content (Join-Path $dir 'release.json') -Raw | ConvertFrom-Json -AsHashtable
    $game = Read-Game $slug
    if (-not $game) { $game = New-GameSkeleton $proj $title $slug }

    Step "Publication de $title v$($rel.version)"
    if (-not $SkipUpload) {
        $bucket = Initialize-R2
        foreach ($p in $rel.files.Keys) {
            $f = $rel.files[$p]
            $local = Join-Path $dir (Split-Path $f.file -Leaf)
            Info "↑ $($f.file)"
            Invoke-Rclone copyto $local "r2:$bucket/$($f.file)" --s3-chunk-size 64M --retries 5 `
                --header-upload "Content-Disposition: attachment; filename=`"$(Split-Path $f.file -Leaf)`"" `
                --header-upload 'Cache-Control: public, max-age=31536000, immutable'
        }
        $remote = & rclone lsjson "r2:$bucket/$slug/$($rel.version)/" | ConvertFrom-Json
        foreach ($p in $rel.files.Keys) {
            $f = $rel.files[$p]
            $hit = $remote | Where-Object Name -eq (Split-Path $f.file -Leaf)
            if (-not $hit -or $hit.Size -ne $f.size) { Fail "Vérification R2 échouée pour $($f.file)" }
        }
        $probe = "$($SiteCfg.downloadBase)/$(($rel.files.Values | Select-Object -First 1).file)"
        try { Invoke-WebRequest $probe -Method Head -TimeoutSec 20 | Out-Null; Info "En ligne : $probe" }
        catch { Warn "Pas encore accessible publiquement : $probe ($($_.Exception.Message))" }
    } else {
        Warn 'SkipUpload : rien n''est envoyé, la fiche pointe vers des fichiers absents.'
    }

    $entry = [ordered]@{
        version   = $rel.version
        date      = $rel.date
        notes     = $Notes
        milestone = [bool]$Milestone
        available = $true
        files     = $rel.files
    }
    $old = $game.versions | Where-Object { $_.version -eq $rel.version } | Select-Object -First 1
    if ($old -and -not $Notes) { $entry.notes = $old.notes }
    if ($old -and -not $Milestone) { $entry.milestone = [bool]$old.milestone }
    $game.versions = @($entry) + @($game.versions | Where-Object { $_.version -ne $rel.version })

    # Rétention : on garde les $Keep dernières versions + les jalons ; les autres ne sont plus téléchargeables.
    # Les versions sont rangées de la plus récente à la plus ancienne (chaque publication passe en tête).
    $alive = @($game.versions | Where-Object { $_.available })
    $drop = @($alive | Select-Object -Skip $Keep | Where-Object { -not $_.milestone })
    foreach ($v in $drop) {
        Info "Rétention : v$($v.version) archivée"
        if (-not $SkipUpload) { Invoke-Rclone purge "r2:$bucket/$slug/$($v.version)" }
        $v.available = $false
    }
    Save-Game $slug $game

    Step 'Vérification du site'
    & node (Join-Path $PSScriptRoot 'build.mjs')
    if ($LASTEXITCODE -ne 0) { Fail 'La génération du site a échoué.' }

    if ($SkipUpload -or $NoPush) {
        Warn 'Pas de commit/push (SkipUpload ou NoPush).'
    } else {
        Step 'Mise en ligne du site'
        git -C $Site add "content/games/$slug"
        git -C $Site commit -m "release: $title v$($rel.version)" | Out-Null
        git -C $Site pull --rebase --quiet
        git -C $Site push --quiet
        if ($LASTEXITCODE -ne 0) { Fail 'git push a échoué.' }
        Remove-Item $dir -Recurse -Force
        Info "https://jnm.app/jeux/$slug/ (en ligne d'ici 1 à 2 minutes)"
    }
}

function Invoke-List {
    if (-not (Test-Path $GamesContent)) { Info 'Aucun jeu.'; return }
    foreach ($f in Get-ChildItem $GamesContent -Directory | Sort-Object Name) {
        $g = Read-Game $f.Name
        if (-not $g) { continue }
        $vs = ($g.versions | ForEach-Object { if ($_.available) { "v$($_.version)" } else { "(v$($_.version))" } }) -join ' '
        Write-Host ("{0,-28} {1,-14} {2}" -f $f.Name, $g.source, $vs)
    }
}

switch ($Command) {
    'build' { Invoke-Build }
    'shots' { Invoke-Shots }
    'publish' { Invoke-Publish }
    'list' { Invoke-List }
}
