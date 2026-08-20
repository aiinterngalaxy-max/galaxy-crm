# Launcher for the Galaxy render server, run by a Windows Scheduled Task
# ("GalaxyRenderServer") so the service survives logoff/reboot without a
# live SSH/terminal session keeping it alive. Wraps node in a restart loop
# since a Scheduled Task action running once won't restart the process on
# its own if node itself crashes mid-render.
#
# The API key lives in api-key.txt, a sibling file that is NOT committed to
# git (see .gitignore) — never hardcode the real key here, this script is
# version-controlled.
$env:RENDER_API_KEY = (Get-Content "$PSScriptRoot\api-key.txt" -Raw).Trim()
Set-Location "C:\galaxy-render-server"
while ($true) {
  node src\server.js *>> "C:\galaxy-render-server\service.log"
  Add-Content "C:\galaxy-render-server\service.log" "`n[$(Get-Date -Format o)] server.js exited - restarting in 3s`n"
  Start-Sleep -Seconds 3
}
