$ErrorActionPreference = 'Stop'
$converter = Join-Path $PSScriptRoot 'convert-to-mp3.ps1'
if (-not (Test-Path -LiteralPath $converter)) { throw 'MP3 conversion hook is missing.' }
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('sockseek-mp3-' + [guid]::NewGuid())
[IO.Directory]::CreateDirectory($testDir) | Out-Null
$source = Join-Path $testDir 'Artist & Guest - Song.flac'
& ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:duration=1' -metadata 'title=Conversion test' $source
if ($LASTEXITCODE -ne 0) { throw 'Could not create test audio.' }
$originalHash = (Get-FileHash -LiteralPath $source).Hash
$result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $converter -Path $source
$mp3 = [IO.Path]::ChangeExtension($source, '.mp3')
if ($LASTEXITCODE -ne 0 -or $result -ne "ignored;$mp3") { throw 'Conversion did not return the MP3 index path.' }
$probe = (& ffprobe -v error -show_streams -show_format -of json $mp3) | ConvertFrom-Json
if ($probe.streams[0].codec_name -ne 'mp3' -or $probe.streams[0].bit_rate -ne '320000') { throw 'Output is not 320 kbps MP3.' }
if ($probe.format.tags.title -ne 'Conversion test') { throw 'Track title was not preserved.' }
if ((Get-FileHash -LiteralPath $source).Hash -ne $originalHash) { throw 'Source audio was modified.' }
$mp3Hash = (Get-FileHash -LiteralPath $mp3).Hash
$result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $converter -Path $mp3
if ($LASTEXITCODE -ne 0 -or $result -or (Get-FileHash -LiteralPath $mp3).Hash -ne $mp3Hash) { throw 'Existing MP3 was not skipped.' }
$result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $converter -Path $source 2>$null
if ($LASTEXITCODE -eq 0 -or $result -or (Get-FileHash -LiteralPath $mp3).Hash -ne $mp3Hash) { throw 'An existing destination must not be overwritten or indexed as this download.' }
$invalid = Join-Path $testDir 'Invalid.flac'
Set-Content -LiteralPath $invalid -Value 'not audio'
$result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $converter -Path $invalid 2>$null
if ($LASTEXITCODE -eq 0 -or $result -or (Test-Path -LiteralPath ([IO.Path]::ChangeExtension($invalid, '.mp3')))) { throw 'Invalid audio must fail without publishing an MP3.' }
if (-not (Test-Path -LiteralPath $invalid)) { throw 'Failed conversion removed the source.' }
Write-Output "PASS: encoding, tags, source preservation, MP3 skip, collision protection, invalid audio. Test files: $testDir"
