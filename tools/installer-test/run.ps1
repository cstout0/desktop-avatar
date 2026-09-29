# Clicks through the built installer on a hidden desktop, so nothing shows up on screen: installs it,
# installs it again over itself (what updating does), then uninstalls it the way Windows Settings
# does, checking the files, shortcuts and Installed apps entry after each step. Run it after
# `npm run dist`:
#
#   powershell -ExecutionPolicy Bypass -File tools\installer-test\run.ps1
#
# Screenshots of every page go to %TEMP%\da-installer-test\shots.
$root = Split-Path (Split-Path $PSScriptRoot)
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$setup = Join-Path $root "dist\Desktop-Avatar-Setup-$version.exe"
$work = Join-Path $env:TEMP 'da-installer-test'
$probe = Join-Path $work 'installer-probe.exe'
# A short folder on purpose: a long one pushes some files past Windows' 260-character path limit.
$dest = Join-Path $env:TEMP 'da-install\Desktop Avatar'
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Desktop Avatar.lnk'
$startLnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Desktop Avatar.lnk'
$koffi = Join-Path $dest 'resources\app.asar.unpacked\node_modules\@koromix\koffi-win32-x64\win32_x64\koffi.node'
$userSettings = Join-Path $env:APPDATA 'Desktop Avatar\settings.json'

function Entry {
  Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' |
    ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.DisplayName -like 'Desktop Avatar*' }
}

$script:failed = 0
function Check($what, $ok) {
  if ($ok) { "   ok    $what" } else { "   FAIL  $what"; $script:failed++ }
}

function ClickThrough($mode, $exe, $shots, $extra) {
  & $probe $mode $exe (Join-Path $work "shots\$shots") $extra
  Check "clicked through every page" ($LASTEXITCODE -eq 0)
}

function Installed($label) {
  $files = @(Get-ChildItem $dest -Recurse -File -ErrorAction SilentlyContinue)
  ""
  "== ${label}: $($files.Count) files, $([math]::Round((($files | Measure-Object Length -Sum).Sum) / 1MB)) MB"
  Check 'the app and its native module are there' ((Test-Path (Join-Path $dest 'Desktop Avatar.exe')) -and (Test-Path $koffi))
  Check 'desktop and Start menu shortcuts' ((Test-Path $desktopLnk) -and (Test-Path $startLnk))
  $e = Entry
  Check "Installed apps entry ($($e.DisplayName))" ($e -and $e.DisplayVersion -eq $version)
}

if (-not (Test-Path $setup)) { "No $setup yet: run npm run dist first."; exit 2 }
if (Entry) { 'Desktop Avatar is installed on this PC. Uninstall it first: this test installs and removes its own copy.'; exit 2 }
$hadSettings = Test-Path $userSettings

New-Item -ItemType Directory -Force $work | Out-Null
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /optimize /r:System.Drawing.dll "/out:$probe" (Join-Path $PSScriptRoot 'installer-probe.cs')
if ($LASTEXITCODE) { 'Could not compile the probe.'; exit 2 }
"Testing $setup ($([math]::Round((Get-Item $setup).Length / 1MB)) MB, signature: $((Get-AuthenticodeSignature $setup).Status))"

""
"=== 1. Install ==="
ClickThrough install $setup 'install' $dest
Installed 'after installing'

""
"=== 2. Install again over it (what updating does) ==="
ClickThrough install $setup 'again' $dest
Installed 'after installing again'

""
"=== 3. Uninstall, the way Windows Settings starts it ==="
$e = Entry
"UninstallString: $($e.UninstallString)"
if ($e.UninstallString -match '^"([^"]+)"\s*(.*)$') { ClickThrough uninstall $matches[1] 'uninstall' $matches[2] }
else { Check 'found the uninstaller' $false }
Start-Sleep -Seconds 2
""
"== after uninstalling"
Check 'no files left' (@(Get-ChildItem $dest -Recurse -File -ErrorAction SilentlyContinue).Count -eq 0)
Check 'shortcuts removed' (-not (Test-Path $desktopLnk) -and -not (Test-Path $startLnk))
Check 'Installed apps entry removed' (-not (Entry))
if ($hadSettings) { Check "the buddy's own settings kept" (Test-Path $userSettings) }
$parent = Split-Path $dest
if ((Test-Path $parent) -and -not (Get-ChildItem $parent -Recurse -Force)) { Remove-Item $parent -Recurse -Force }

""
if ($script:failed) { "FAILED: $script:failed check(s)"; exit 1 }
'PASSED'
