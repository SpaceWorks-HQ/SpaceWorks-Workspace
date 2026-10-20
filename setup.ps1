<# Space Works Workspace guided setup. Docker Desktop with WSL2 is required. #>
[CmdletBinding()]
param([switch]$Build)
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "setup.sh"
$unixPath = (& wsl wslpath -a $script).Trim()
if ($LASTEXITCODE -ne 0) { throw "Enable Docker Desktop WSL2 integration and run setup from a WSL2 shell." }
$arguments = @($unixPath)
if ($Build) { $arguments += "--build" }
& wsl bash @arguments
if ($LASTEXITCODE -ne 0) { throw "Setup failed with exit code $LASTEXITCODE. Inspect the output above." }
