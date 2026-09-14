# dev.ps1 — launch DJ Prep Tool in development mode
# Sets the MSVC + Windows SDK environment that cargo requires on Windows,
# then starts the installed Tauri CLI from this directory.

$MSVC    = "C:\BuildTools\VC\Tools\MSVC\14.44.35207"
$SDK     = "C:\Program Files (x86)\Windows Kits\10"
$SDK_VER = "10.0.26100.0"

$env:PATH = "$MSVC\bin\HostX64\x64;$SDK\bin\$SDK_VER\x64;$env:PATH"

$env:LIB = (
    "$MSVC\lib\x64",
    "$SDK\Lib\$SDK_VER\um\x64",
    "$SDK\Lib\$SDK_VER\ucrt\x64"
) -join ";"

$env:INCLUDE = (
    "$MSVC\include",
    "$SDK\Include\$SDK_VER\ucrt",
    "$SDK\Include\$SDK_VER\um",
    "$SDK\Include\$SDK_VER\shared"
) -join ";"

if (Test-Path (Join-Path $PSScriptRoot "client_secret.json")) {
    $oauth = Get-Content (Join-Path $PSScriptRoot "client_secret.json") | ConvertFrom-Json
    $client = if ($oauth.web) { $oauth.web } else { $oauth.installed }
    $env:YOUTUBE_CLIENT_ID = $client.client_id
    $env:YOUTUBE_CLIENT_SECRET = $client.client_secret
}

Set-Location $PSScriptRoot
$devPort = 5173
while (Get-NetTCPConnection -LocalPort $devPort -State Listen -ErrorAction SilentlyContinue) {
    $devPort++
}

$env:VITE_PORT = $devPort
$frontendRoot = $PSScriptRoot.Replace('\', '/')
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source.Replace('\', '/')
$viteEntry = "$frontendRoot/node_modules/vite/bin/vite.js"
$tauriEntry = "$frontendRoot/node_modules/@tauri-apps/cli/tauri.js"
$beforeDevCommand = "$nodePath $viteEntry"
$tauriDevConfig = @{ build = @{ devUrl = "http://localhost:$devPort"; beforeDevCommand = $beforeDevCommand } } | ConvertTo-Json -Compress
$tauriConfigPath = Join-Path ([System.IO.Path]::GetTempPath()) "dj-prep-tool-tauri-$devPort.json"
[System.IO.File]::WriteAllText($tauriConfigPath, $tauriDevConfig, [System.Text.UTF8Encoding]::new($false))
Write-Host "Starting DJ Prep Tool on port $devPort"
try {
    & $nodePath $tauriEntry dev --config $tauriConfigPath
} finally {
    Remove-Item -LiteralPath $tauriConfigPath -Force -ErrorAction SilentlyContinue
}
