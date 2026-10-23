# Dependency-free runner regressions; uses Node only, never adb or a compiler.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/check-table-kernel-android.ps1')
$checks = 0

function Assert-Runner([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    $script:checks++
}

function Assert-RunnerThrows([scriptblock]$Action, [string]$Expected) {
    $caught = $null
    try { & $Action } catch { $caught = $_.Exception.Message }
    Assert-Runner ($null -ne $caught -and $caught.Contains($Expected)) "Expected failure: $Expected; actual: $caught"
}

$node = Resolve-KernelTool 'node'
$working = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$unicode = '$() & ; unicode-' + [char]0x4E2D + [char]0x6587
$arguments = @('', 'with spaces', 'embedded"quote', 'C:\path with spaces\', 'slash\"quote', $unicode)
$actual = Invoke-KernelCommand $node (@('-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--') + $arguments) $working 'Argument round trip'
$decoded = ConvertFrom-Json -InputObject $actual
Assert-Runner ($decoded.Count -eq $arguments.Count) 'Every argument must survive process invocation.'
for ($i = 0; $i -lt $arguments.Count; $i++) { Assert-Runner ($decoded[$i] -ceq $arguments[$i]) "Argument $i was altered." }
Assert-RunnerThrows { Invoke-KernelCommand $node @('-e', 'process.stderr.write("fictional-private-id");process.exit(23)') $working 'Public test command' -Private } 'exit code 23'
try { Invoke-KernelCommand $node @('-e', 'process.stderr.write("fictional-private-id");process.exit(23)') $working 'Public test command' -Private } catch {
    Assert-Runner (-not $_.Exception.Message.Contains('fictional-private-id')) 'Raw private tool output must not appear in the exception.'
}
# Large stdout and stderr exercise both asynchronously drained pipes.
$large = Invoke-KernelCommand $node @('-e', 'process.stderr.write("e".repeat(200000));process.stdout.write("o".repeat(200000))') $working 'Pipe test' -Private
Assert-Runner ($large.Length -eq 200000) 'Full output must survive simultaneous stderr.'

Assert-Runner ((Select-KernelDevice "List of devices attached`r`nfictional-a`tdevice`r`n" '') -ceq 'fictional-a') 'One authorized device must be selected.'
Assert-RunnerThrows { Select-KernelDevice "List of devices attached`n" '' } 'Exactly one'
Assert-RunnerThrows { Select-KernelDevice "fictional-a`tdevice`nfictional-b`toffline" '' } 'Exactly one'
Assert-RunnerThrows { Select-KernelDevice "fictional-a`tdevice`nfictional-b`tauthorizing" '' } 'Exactly one'
Assert-RunnerThrows { Select-KernelDevice "fictional-a`tunauthorized" '' } 'Exactly one'
Assert-RunnerThrows { Select-KernelDevice "fictional-a`tdevice" 'fictional-b' } 'explicitly selected'
Assert-Runner ((Select-KernelDevice "fictional-a`tdevice`nfictional-b`tdevice" 'fictional-b') -ceq 'fictional-b') 'Explicit selection must resolve multiple transports.'

$valid = '{"cases":33,"passed":true,"nativeDifferential":true}' + "`n" + '{"recordsCases":38,"passed":true,"nativeDifferential":true}'
Assert-Runner (@(Assert-KernelSummaries $valid $true).Count -eq 2) 'Both native summaries must be returned.'
$baseline = $valid.Replace('"nativeDifferential":true', '"nativeDifferential":false')
Assert-Runner (@(Assert-KernelSummaries $baseline $false).Count -eq 2) 'Generation baseline can be recognized only in baseline mode.'
Assert-RunnerThrows { Assert-KernelSummaries $baseline $true } 'required differential mode'
Assert-RunnerThrows { Assert-KernelSummaries ($valid.Replace('"nativeDifferential":true', '"nativeDifferential":"true"')) $true } 'required differential mode'
Assert-RunnerThrows { Assert-KernelSummaries ($valid.Replace('"passed":true', '"passed":false')) $true } 'required differential mode'
Assert-RunnerThrows { Assert-KernelSummaries ($valid.Replace('"recordsCases":38', '"recordsCases":37')) $true } 'all 33 character and 38 records'
Assert-RunnerThrows { Assert-KernelSummaries '{"cases":33,"passed":true,"nativeDifferential":true}' $true } 'both character and records'
Write-Host "PASS: $checks runner safety/error-propagation regressions. No device was accessed."
