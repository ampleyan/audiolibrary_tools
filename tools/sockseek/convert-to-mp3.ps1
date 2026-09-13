param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'
$temporary = $null
try {
    $source = Get-Item -LiteralPath $Path
    if ($source.PSIsContainer -or $source.Extension -ieq '.mp3') { exit 0 }
    if ($source.Extension.ToLowerInvariant() -notin @('.flac', '.wav', '.aiff', '.aif', '.m4a', '.aac', '.ogg', '.opus', '.wma', '.alac', '.ape', '.wv', '.mp4', '.webm')) { exit 0 }
    $destination = [IO.Path]::ChangeExtension($source.FullName, '.mp3')
    if (Test-Path -LiteralPath $destination) { throw "MP3 already exists; keeping both files: $destination" }
    $ffmpeg = (Get-Command ffmpeg.exe -ErrorAction Stop).Source
    $temporary = Join-Path $source.DirectoryName ('.sockseek-' + [guid]::NewGuid() + '.mp3')
    & $ffmpeg -hide_banner -loglevel error -nostdin -n -i $source.FullName -map 0:a:0 -map_metadata 0 -vn -c:a libmp3lame -b:a 320k -id3v2_version 3 $temporary
    if ($LASTEXITCODE -ne 0) { throw "FFmpeg conversion failed: $($source.FullName)" }
    if ((Get-Item -LiteralPath $temporary).Length -eq 0) { throw 'FFmpeg produced an empty file.' }
    [IO.File]::Move($temporary, $destination)
    $temporary = $null
    Write-Output "ignored;$destination"
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($temporary -and (Test-Path -LiteralPath $temporary)) {
        Remove-Item -LiteralPath $temporary -Force
    }
}
