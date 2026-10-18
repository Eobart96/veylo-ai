# Installs developer tools only. Does not read credentials or enable paid services.
# Run only after the owner agrees to installing software on this computer.
[CmdletBinding()]
param([switch]$Install)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $taskRoot '.tools'
if (-not $Install) {
    Write-Host 'План установки: Rust stable (MSVC) в .tools; Microsoft C++ Build Tools с Windows SDK.'
    Write-Host 'Build Tools меняет установленные программы Windows и может запросить права администратора.'
    Write-Host 'Установка запускается только с параметром -Install. Перезагрузка автоматически не выполняется.'
    exit 0
}
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
$rustInstaller = Join-Path $toolsRoot 'rustup-init.exe'
Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile $rustInstaller
$env:RUSTUP_HOME = Join-Path $toolsRoot 'rustup'
$env:CARGO_HOME = Join-Path $toolsRoot 'cargo'
& $rustInstaller -y --no-modify-path --profile minimal --default-toolchain stable-x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw 'Rust installer failed.' }
$buildInstaller = Join-Path $toolsRoot 'vs-buildtools.exe'
Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vs_buildtools.exe' -OutFile $buildInstaller
$signature = Get-AuthenticodeSignature -LiteralPath $buildInstaller
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
    throw 'Microsoft installer signature verification failed.'
}
$buildPath = Join-Path $toolsRoot 'buildtools'
$process = Start-Process -FilePath $buildInstaller -ArgumentList @('--quiet','--wait','--norestart','--installPath', ('"' + $buildPath + '"'),'--add','Microsoft.VisualStudio.Workload.VCTools','--includeRecommended') -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -notin @(0,3010)) { throw "Build Tools installer failed: $($process.ExitCode)" }
if ($process.ExitCode -eq 3010) { Write-Host 'Инструменты установлены; Windows сообщает, что потребуется перезагрузка.' }
else { Write-Host 'Инструменты установлены. Проверка: npm.cmd run doctor' }
