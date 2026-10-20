[CmdletBinding()]
param([string]$Version = "")
$ErrorActionPreference = "Stop"
$path = (& wsl wslpath -a (Join-Path $PSScriptRoot "update.sh")).Trim()
$arguments = @($path, "--force")
if ($Version) { $arguments += @("--version", $Version) }
& wsl bash @arguments
if ($LASTEXITCODE -ne 0) { throw "Update failed with exit code $LASTEXITCODE." }
