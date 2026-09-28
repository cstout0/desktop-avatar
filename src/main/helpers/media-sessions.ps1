# Prints the PC's media sessions (Spotify, browsers, video players...) as one JSON
# line every ~1.5 s, from Windows' own media controls (the volume-flyout player).
# Read-only; nothing leaves the machine.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $t.Wait(5000)
  $t.Result
}
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$once = $args -contains '-once'
while ($true) {
  $out = @()
  foreach ($s in $mgr.GetSessions()) {
    try {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $info = $s.GetPlaybackInfo()
      $tl = $s.GetTimelineProperties()
      $out += [pscustomobject]@{
        app    = $s.SourceAppUserModelId
        title  = $p.Title
        artist = $p.Artist
        status = "$($info.PlaybackStatus)"
        kind   = "$($info.PlaybackType)"
        pos    = [math]::Round($tl.Position.TotalSeconds, 1)
        dur    = [math]::Round($tl.EndTime.TotalSeconds, 1)
      }
    } catch { }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 3 -InputObject @($out)))
  [Console]::Out.Flush()
  if ($once) { break }
  Start-Sleep -Milliseconds 1500
}
