param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
& (Join-Path $projectRoot 'askcosctl.ps1') @Args
exit $LASTEXITCODE
