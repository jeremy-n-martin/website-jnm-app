<#
.SYNOPSIS
    Pipeline de release des jeux Godot vers jnm.app/jeux (binaires sur Cloudflare R2).

.DESCRIPTION
    release.ps1 ship    <jeu>   Tout en une fois : version +1, contrôles, export, tests, captures, publication.
    release.ps1 bump    <jeu>   Version +1 (0.007 → 0.008) dans project.godot et tous les presets.
    release.ps1 doctor  <jeu>   Vérifie et corrige les presets (exe autonome x64, macOS universel, APK ARM).
    release.ps1 build   <jeu>   Exporte Windows / Android / macOS, lance les tests et un test de démarrage.
    release.ps1 shots   <jeu>   3 captures (-Count pour changer) : tools/shots.gd du jeu s'il existe, sinon
                                l'explorateur. Une seule ouverture de Godot quand c'est possible.
    release.ps1 publish <jeu>   Envoie la version préparée sur R2, met à jour la fiche, applique la
                                rétention, puis commit + push du site (GitHub Pages redéploie).
    release.ps1 list            Liste les jeux publiés et leurs versions.

    <jeu> = nom du dossier dans D:\godot (ex. commun) ou chemin complet du projet.

.EXAMPLE
    ./tools/release.ps1 ship commun -Notes "Nouveau mode défi du jour."

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
    [Parameter(Position = 0, Mandatory)][ValidateSet('ship', 'bump', 'doctor', 'build', 'shots', 'publish', 'list')][string]$Command,
    [Parameter(Position = 1)][string]$Project,
    [string]$Version,
    [ValidateSet('windows', 'android', 'macos')][string[]]$Platforms = @('windows', 'android', 'macos'),
    [string]$Windows,
    [string]$Android,
    [string]$Mac,
    [string]$From,
    [int]$Count = 3,
    [string]$Notes,
    [switch]$Milestone,
    [int]$Keep,
    [switch]$SkipUpload,
    [switch]$NoPush,
    [switch]$NoBump,
    [switch]$Shots,
    [switch]$SkipTests,
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
        if ($line -match '^\[preset\.(\d+)(\.options)?\]') { $cur = $Matches[1]; if (-not $presets.Contains($cur)) { $presets[$cur] = @{ options = @{}; index = $cur } }; $isOpt = [bool]$Matches[2]; continue }
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

# ---------- écriture de project.godot / export_presets.cfg ----------

function Edit-CfgFile([string]$file, [string]$section, [string]$key, [string]$value) {
    # Remplace (ou ajoute) key=value dans la section [section] d'un fichier .cfg / project.godot.
    $lines = [Collections.Generic.List[string]]([IO.File]::ReadAllText($file) -split "`n")
    $start = $lines.FindIndex({ param($l) $l.TrimEnd("`r") -eq "[$section]" })
    if ($start -lt 0) { $lines.Add(''); $lines.Add("[$section]"); $lines.Add(''); $start = $lines.Count - 2 }
    $end = $lines.FindIndex($start + 1, { param($l) $l -match '^\[' })
    if ($end -lt 0) { $end = $lines.Count }
    $hit = -1
    for ($i = $start + 1; $i -lt $end; $i++) { if ($lines[$i] -match ('^' + [regex]::Escape($key) + '=')) { $hit = $i; break } }
    if ($hit -ge 0) {
        if ($lines[$hit].TrimEnd("`r") -eq "$key=$value") { return $false }
        $lines[$hit] = "$key=$value"
    } else {
        $at = $end
        while ($at -gt $start + 1 -and -not $lines[$at - 1].Trim()) { $at-- }
        $lines.Insert($at, "$key=$value")
    }
    [IO.File]::WriteAllText($file, ($lines -join "`n"))
    return $true
}

function Set-PresetOption($proj, $preset, [string]$key, [string]$value) {
    return Edit-CfgFile (Join-Path $proj 'export_presets.cfg') "preset.$($preset.index).options" $key $value
}

# 0.007 → 0.008, 0.009 → 0.010, 0.1.0 → 0.1.1 (on garde le nombre de chiffres).
function Get-NextVersion([string]$v) {
    if ($v -notmatch '^(.*?)(\d+)(\D*)$') { Fail "Version illisible : $v" }
    $n = [int64]$Matches[2] + 1
    return $Matches[1] + $n.ToString().PadLeft($Matches[2].Length, '0') + $Matches[3]
}

# Windows exige 4 nombres : 0.008 → 0.8.0.0
function ConvertTo-WinVersion([string]$v) {
    $parts = @([regex]::Matches($v, '\d+') | ForEach-Object { [int64]$_.Value })
    while ($parts.Count -lt 4) { $parts += 0 }
    return ($parts[0..3] -join '.')
}

function Get-SafeName([string]$s) { return ($s -replace '[\\/:*?"<>|]', '-').Trim() }

function Test-Published([string]$slug, [string]$ver, [string]$title) {
    $game = Read-Game $slug
    if ($game -and ($game.versions | Where-Object { $_.version -eq $ver })) { return $true }
    if ($Config.localBuildDir) {
        $name = "$(Get-SafeName $title) v$ver"
        foreach ($sub in $LocalSub.Values) { if (Get-ChildItem (Join-Path $Config.localBuildDir $sub) -Filter "$name.*" -ErrorAction SilentlyContinue) { return $true } }
    }
    return $false
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
        if (-not $SkipTests) { Invoke-ProjectTests $proj $godot $slug }
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
                if ($produced.Count -ne 1 -or $main.Extension -ne '.exe') {
                    Fail "windows : un seul .exe autonome attendu, reçu $($produced.Name -join ', '). Lance « doctor » (PCK intégré)."
                }
                if (-not $useExisting) { Test-Smoke $main.FullName $slug }
                $name = "$slug-v$ver-windows-x64.exe"; Move-Item $main.FullName (Join-Path $stage $name)
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
    }
    if (-not $files.Count) { Fail 'Aucun livrable produit.' }

    # Livrables locaux, une fois tout validé : uniquement les exécutables, nommés « <Nom> v<version>.<ext> ».
    if ($Config.localBuildDir -and -not $useExisting) {
        Step "Copie dans $($Config.localBuildDir)"
        foreach ($p in $files.Keys) {
            $dest = Join-Path $Config.localBuildDir $LocalSub[$p]
            New-Item -ItemType Directory -Force $dest | Out-Null
            $src = Join-Path $stage (Split-Path $files[$p].file -Leaf)
            $local = "$(Get-SafeName $title) v$ver$([IO.Path]::GetExtension($src))"
            Copy-Item $src (Join-Path $dest $local) -Force
            Info "$($LocalSub[$p])\$local"
        }
    }

    [ordered]@{ slug = $slug; title = $title; version = $ver; project = $proj; date = (Get-Date -Format 'yyyy-MM-dd'); files = $files } |
        ConvertTo-Json -Depth 6 | Set-Content (Join-Path $stage 'release.json') -Encoding utf8NoBOM

    if (-not $game) {
        Save-Game $slug (New-GameSkeleton $proj $title $slug)
        Info "Fiche créée : content/games/$slug/game.json (résumé et genres à rédiger)"
    }
    Step "Prêt à publier : $stage"
}

function Get-UserDir([string]$proj) {
    if ((Read-ProjectSetting $proj 'config/use_custom_user_dir') -eq 'true') {
        $custom = Read-ProjectSetting $proj 'config/custom_user_dir_name'
        if ($custom) { return Join-Path $env:APPDATA $custom }
    }
    return Join-Path $env:APPDATA "Godot/app_userdata/$(Read-ProjectSetting $proj 'config/name')"
}

# Lance le jeu avec l'explorateur jnm_autoshots.gd injecté par un override.cfg temporaire.
# Le jeu tourne sur une copie de la sauvegarde : la vraie progression n'est jamais modifiée.
function Invoke-AutoShots([string]$proj, [string]$godot, [string]$outDir, [string]$slug, [int]$want, [string]$driver = '') {
    $override = Join-Path $proj 'override.cfg'
    if (Test-Path $override) { Warn 'override.cfg déjà présent dans le projet : explorateur ignoré.'; return }
    $isolatedName = "jnm-shots/$slug"
    $isolated = Join-Path $env:APPDATA $isolatedName
    if (Test-Path $isolated) { Remove-Item $isolated -Recurse -Force }
    New-Item -ItemType Directory -Force $isolated | Out-Null
    $real = Get-UserDir $proj
    if (Test-Path $real) { Copy-Item (Join-Path $real '*') $isolated -Recurse -Force -Exclude 'shader_cache', 'vulkan', 'logs' }
    $script = if ($driver) { $driver } else { (Join-Path $PSScriptRoot 'godot/jnm_autoshots.gd') -replace '\\', '/' }
    $logName = if ($driver) { 'shots' } else { 'autoshots' }  # journaux distincts : l'explorateur n'écrase pas celui du jeu
    @"
[application]
config/use_custom_user_dir=true
config/custom_user_dir_name="$isolatedName"

[autoload]
JnmAutoshots="*$script"
"@ | Set-Content $override -Encoding utf8NoBOM
    $env:JNM_SHOTS_DIR = $outDir
    $env:JNM_SHOTS_COUNT = "$want"
    $env:JNM_SHOTS_TIME = '100'
    try {
        Info "Explorateur : $want capture(s) visée(s), 2 minutes maximum"
        # --quit-after : filet de sécurité si l'explorateur ne se charge pas (environ 2 min à 60 i/s).
        $proc = Start-Process $godot -ArgumentList '--path', "`"$proj`"", '--quit-after', '8000' -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $env:TEMP "jnm-$logName-$slug.log") -RedirectStandardError (Join-Path $env:TEMP "jnm-$logName-$slug.err.log")
        if (-not $proc.WaitForExit(180000)) { $proc.Kill(); Warn 'Explorateur arrêté (délai dépassé).' }
    } finally {
        Remove-Item $override -Force -ErrorAction SilentlyContinue
        Remove-Item $isolated -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:JNM_SHOTS_DIR, Env:JNM_SHOTS_COUNT, Env:JNM_SHOTS_TIME -ErrorAction SilentlyContinue
    }
    Info "$(@(Get-ChildItem $outDir -Filter '*.png').Count) image(s) au total"
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
        Step 'Captures (le jeu va s''ouvrir, ne touche pas à la fenêtre)'
        $tool = Join-Path $proj 'tools/shots.gd'
        if ((Test-Path $tool) -and (Select-String $tool -Pattern '^extends\s+SceneTree' -Quiet)) {
            # Outil propre au jeu, en script principal (-s) : il construit lui-même ses écrans.
            $log = Join-Path $env:TEMP "jnm-shots-$slug.log"
            $proc = Start-Process $godot -ArgumentList '--path', "`"$proj`"", '-s', 'tools/shots.gd', '--', "`"$raw`"" -PassThru -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError "$log.err"
            if (-not $proc.WaitForExit(300000)) { $proc.Kill(); Fail "shots.gd ne s'est pas terminé en 5 minutes (journal : $log)" }
            if (-not (Get-ChildItem $raw -Filter *.png)) { Warn "shots.gd n'a produit aucune image (journal : $log)" }
        } elseif (Test-Path $tool) {
            # Outil propre au jeu, en autoload : le jeu tourne normalement et le script le pilote.
            Invoke-AutoShots $proj $godot $raw $slug $Count 'res://tools/shots.gd'
        }
        if (Test-Path $tool) {
            # Ses images passent avant celles de l'explorateur (tri par nom).
            Get-ChildItem $raw -Filter *.png | ForEach-Object { Rename-Item $_.FullName "0-$($_.Name)" }
        }
        $have = @(Get-ChildItem $raw -Filter *.png).Count
        if ($have -lt $Count) {
            # L'explorateur complète jusqu'au nombre voulu.
            Invoke-AutoShots $proj $godot $raw $slug ($Count - $have)
        }
        if (-not (Get-ChildItem $raw -Filter *.png)) {
            # Dernier recours : Godot enregistre 9 s du jeu lancé normalement (écran titre).
            Warn 'Explorateur sans résultat : capture de l''écran titre seulement.'
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
    $webp = @(Get-ChildItem $out -Filter *.webp -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -First $Count)
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

# ---------- contrôles avant publication ----------

# Écrit un override.cfg qui redirige user:// vers un dossier jetable (la vraie sauvegarde n'est jamais touchée).
function New-Isolation([string]$dir, [string]$name, [string]$extra = '') {
    $override = Join-Path $dir 'override.cfg'
    if (Test-Path $override) { return $null }
    $isolated = Join-Path $env:APPDATA $name
    if (Test-Path $isolated) { Remove-Item $isolated -Recurse -Force }
    "[application]`nconfig/use_custom_user_dir=true`nconfig/custom_user_dir_name=`"$($name -replace '\\', '/')`"`n$extra" | Set-Content $override -Encoding utf8NoBOM
    return @{ override = $override; isolated = $isolated }
}

function Remove-Isolation($iso) {
    if (-not $iso) { return }
    Remove-Item $iso.override -Force -ErrorAction SilentlyContinue
    Remove-Item $iso.isolated -Recurse -Force -ErrorAction SilentlyContinue
}

# Lance les tests du projet (tests/test_*.gd), chacun en mode headless.
function Invoke-ProjectTests([string]$proj, [string]$godot, [string]$slug) {
    $tests = @(Get-ChildItem (Join-Path $proj 'tests') -Filter 'test_*.gd' -ErrorAction SilentlyContinue)
    if (-not $tests) { return }
    Step "Tests ($($tests.Count))"
    $iso = New-Isolation $proj "jnm-tests/$slug"
    try {
        foreach ($t in $tests) {
            $log = Join-Path $env:TEMP "jnm-test-$slug-$($t.BaseName).log"
            $proc = Start-Process $godot -ArgumentList '--headless', '--path', "`"$proj`"", '-s', "res://tests/$($t.Name)" -PassThru -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError "$log.err"
            if (-not $proc.WaitForExit(240000)) { $proc.Kill(); Fail "Test $($t.Name) : délai dépassé (journal : $log)" }
            if ($proc.ExitCode -ne 0) {
                Get-Content $log, "$log.err" -Tail 8 -ErrorAction SilentlyContinue | ForEach-Object { Info $_ }
                Fail "Test $($t.Name) en échec (code $($proc.ExitCode)). Corrige, ou -SkipTests pour passer outre."
            }
            Info "✓ $($t.Name)"
        }
    } finally { Remove-Isolation $iso }
}

# Démarre l'exe exporté sans fenêtre pendant ~5 s : il doit se lancer et quitter proprement.
function Test-Smoke([string]$exe, [string]$slug) {
    Step 'Test de démarrage (exe Windows)'
    $dir = Split-Path $exe -Parent
    $iso = New-Isolation $dir "jnm-smoke/$slug"
    $log = Join-Path $env:TEMP "jnm-smoke-$slug.log"
    try {
        $proc = Start-Process $exe -ArgumentList '--headless', '--quit-after', '300' -PassThru -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError "$log.err"
        if (-not $proc.WaitForExit(90000)) { $proc.Kill(); Fail "Le jeu ne quitte pas après 300 images (journal : $log)" }
        $out = (Get-Content $log, "$log.err" -Raw -ErrorAction SilentlyContinue) -join "`n"
        if ($proc.ExitCode -ne 0) { Fail "Le jeu exporté plante au démarrage (code $($proc.ExitCode), journal : $log)" }
        $errors = ([regex]::Matches($out, 'SCRIPT ERROR')).Count
        if ($errors) { Warn "$errors erreur(s) de script au démarrage (journal : $log)" } else { Info '✓ démarre et quitte proprement' }
    } finally { Remove-Isolation $iso }
}

function Invoke-Doctor {
    $proj = Resolve-Project $Project
    $presets = Read-Presets $proj
    Step "Contrôle de $(Read-ProjectSetting $proj 'config/name')"
    $fixed = 0
    $w = Find-Preset $presets 'windows'
    if ($w) {
        if (Set-PresetOption $proj $w 'binary_format/embed_pck' 'true') { Info 'Windows : PCK intégré (exe autonome)'; $fixed++ }
        if (Set-PresetOption $proj $w 'binary_format/architecture' '"x86_64"') { Info 'Windows : architecture x64'; $fixed++ }
    } else { Warn 'Pas de preset Windows Desktop' }
    $m = Find-Preset $presets 'macos'
    if ($m) {
        if (Set-PresetOption $proj $m 'binary_format/architecture' '"universal"') { Info 'macOS : universel (Intel + Apple Silicon)'; $fixed++ }
    } else { Warn 'Pas de preset macOS' }
    $a = Find-Preset $presets 'android'
    if ($a) {
        if (Set-PresetOption $proj $a 'architectures/arm64-v8a' 'true') { Info 'Android : ARM64 activé'; $fixed++ }
        if (-not $a.options['keystore/release']) { Warn 'Android : aucun keystore de release (les mises à jour ne s''installeront pas par-dessus)' }
    } else { Warn 'Pas de preset Android' }
    if (-not (Read-ProjectSetting $proj 'config/version')) { Warn 'config/version absent de project.godot (« bump » l''ajoutera)' }
    $shown = Get-ChildItem $proj -Recurse -Include *.gd, *.tscn -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\(\.godot|addons)\\' } |
        Select-String -Pattern 'config/version' -SimpleMatch -List | Select-Object -First 1
    if (-not $shown) { Warn 'La version n''est pas affichée en jeu : ajoute-la en bas de l''écran titre (ProjectSettings.get_setting("application/config/version")).' }
    Info $(if ($fixed) { "$fixed réglage(s) corrigé(s) dans export_presets.cfg" } else { 'Presets conformes' })
}

function Invoke-Bump {
    $proj = Resolve-Project $Project
    $presets = Read-Presets $proj
    $title = Read-ProjectSetting $proj 'config/name'
    $cur = Get-ProjectVersion $proj $presets
    $new = if ($Version) { $Version } elseif ($cur) { Get-NextVersion $cur } else { '0.001' }
    Step "Version : $(if ($cur) { "v$cur → " })v$new"
    $pg = Join-Path $proj 'project.godot'
    Edit-CfgFile $pg 'application' 'config/version' "`"$new`"" | Out-Null
    $w = Find-Preset $presets 'windows'
    if ($w) {
        Set-PresetOption $proj $w 'application/file_version' "`"$(ConvertTo-WinVersion $new)`"" | Out-Null
        Set-PresetOption $proj $w 'application/product_version' "`"$(ConvertTo-WinVersion $new)`"" | Out-Null
    }
    $a = Find-Preset $presets 'android'
    if ($a) {
        $code = [int]($a.options['version/code'] ?? 0) + 1
        Set-PresetOption $proj $a 'version/code' "$code" | Out-Null
        Set-PresetOption $proj $a 'version/name' "`"$new`"" | Out-Null
        Info "Android : versionCode $code"
    }
    $m = Find-Preset $presets 'macos'
    if ($m) {
        Set-PresetOption $proj $m 'application/short_version' "`"$new`"" | Out-Null
        Set-PresetOption $proj $m 'application/version' "`"$new`"" | Out-Null
    }
    $script:Version = $new
}

function Invoke-Ship {
    $proj = Resolve-Project $Project
    $script:Project = $proj
    $title = Read-ProjectSetting $proj 'config/name'
    $slug = Find-Slug $proj $title
    Invoke-Doctor
    $cur = Get-ProjectVersion $proj (Read-Presets $proj)
    # Chaque release a un numéro neuf : on n'incrémente que si la version actuelle est déjà sortie.
    if ($Version) { Invoke-Bump }
    elseif (-not $NoBump -and (-not $cur -or (Test-Published $slug $cur $title))) { Invoke-Bump }
    else { Step "Version v$cur (pas encore publiée, conservée)"; $script:Version = $cur }
    Invoke-Build
    $have = @(Get-ChildItem (Join-Path $GamesContent "$slug/media") -Filter 'shot-*.webp' -ErrorAction SilentlyContinue).Count
    if ($Shots -or $have -lt $Count) { Invoke-Shots } else { Info "Captures conservées ($have) : -Shots pour les refaire" }
    Invoke-Publish
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
    'ship' { Invoke-Ship }
    'bump' { Invoke-Bump }
    'doctor' { Invoke-Doctor }
    'build' { Invoke-Build }
    'shots' { Invoke-Shots }
    'publish' { Invoke-Publish }
    'list' { Invoke-List }
}
