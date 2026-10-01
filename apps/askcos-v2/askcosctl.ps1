param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$ErrorActionPreference = "Stop"

function ConvertTo-WslProjectRoot {
  param([string]$WindowsPath)

  $resolvedPath = [System.IO.Path]::GetFullPath($WindowsPath)
  if ($resolvedPath -notmatch '^\\\\wsl(?:\.localhost)?\\([^\\]+)\\(.+)$') {
    throw "askcosctl.ps1 must be run from the ASKCOSv2 WSL UNC path, got: $resolvedPath"
  }

  return @{
    Distro = $Matches[1]
    LinuxPath = "/" + ($Matches[2] -replace '\\', '/')
  }
}

function ConvertTo-ProcessArgument {
  param([string]$Value)

  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
    return $Value
  }
  return '"' + ($Value -replace '\\', '\\' -replace '"', '\"') + '"'
}

$projectRoot = Split-Path -Parent $PSCommandPath
$wslProject = ConvertTo-WslProjectRoot $projectRoot
$timeoutSeconds = 180
if ($env:ASKCOSCTL_WSL_TIMEOUT_SECONDS) {
  $timeoutSeconds = [int]$env:ASKCOSCTL_WSL_TIMEOUT_SECONDS
}

$arguments = @(
  "-d",
  $wslProject.Distro,
  "--cd",
  "$($wslProject.LinuxPath)/askcos2_core",
  "--",
  "python3",
  "runtime/scripts/askcosctl.py"
) + $Args

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = "wsl.exe"
$startInfo.Arguments = (($arguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join " ")
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true

$process = [System.Diagnostics.Process]::Start($startInfo)
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()

if (-not $process.WaitForExit($timeoutSeconds * 1000)) {
  try {
    $process.Kill()
  } catch {
    # Process already exited.
  }
  [Console]::Error.WriteLine("wsl.exe timed out after ${timeoutSeconds}s while running askcosctl.")
  exit 124
}

$stdout = $stdoutTask.Result
$stderr = $stderrTask.Result
if ($stdout) {
  Write-Output $stdout.TrimEnd()
}
if ($stderr) {
  [Console]::Error.WriteLine($stderr.TrimEnd())
}

exit $process.ExitCode
