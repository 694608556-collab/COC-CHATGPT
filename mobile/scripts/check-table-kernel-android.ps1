<#
.SYNOPSIS
Build both Android production-kernel CLIs and verify all public differential cases.
.DESCRIPTION
Requires an existing NDK, CMake/Ninja, Node installation and locked mobile dependencies.
Uses the production CMake target (including vendored Expat); downloads nothing.
Device mode requires one authorized device supporting BOTH arm64-v8a and armeabi-v7a.
Only a new /data/local/tmp/coc-table-kernel-<guid> directory is written on the device.
No app is installed, opened, cleared or uninstalled. Remote files are retained for
diagnosis; the script never recursively removes anything. Device IDs are not logged.
Each run has a new local directory. CompileOnly reports nativeDifferential:false
and cannot constitute differential, app, performance or physical-device acceptance.
.PARAMETER SdkRoot
Existing Android SDK; defaults to ANDROID_HOME, then ANDROID_SDK_ROOT.
.PARAMETER NdkRoot
Override the existing NDK directory; defaults to SdkRoot/ndk/NdkVersion.
.PARAMETER CMakeExecutable
Override cmake.exe; defaults to SdkRoot/cmake/CMakeVersion/bin/cmake.exe.
.PARAMETER NinjaExecutable
Override ninja.exe; defaults to the directory containing cmake.exe.
.PARAMETER NodeExecutable
Existing node.exe command or absolute path; defaults to node.
.PARAMETER AdbExecutable
Override adb.exe; defaults to SdkRoot/platform-tools/adb.exe. Unused in CompileOnly.
.PARAMETER DeviceSerial
Explicit device selection when more than one transport exists. Never written to logs.
.PARAMETER OutputRoot
Parent of new run directories; defaults to ignored mobile/android/build/table-kernel-device.
.PARAMETER CompileOnly
Build both ABIs and generate the baseline, without invoking adb.
.EXAMPLE
powershell -NoProfile -File scripts/check-table-kernel-android.ps1 -SdkRoot C:\Android\Sdk -CompileOnly
.EXAMPLE
powershell -NoProfile -File scripts/check-table-kernel-android.ps1 -SdkRoot C:\Android\Sdk
#>
[CmdletBinding()]
param(
    [string]$SdkRoot = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }),
    [string]$NdkRoot,
    [string]$NdkVersion = '28.2.13676358',
    [string]$CMakeExecutable,
    [string]$CMakeVersion = '3.22.1',
    [string]$NinjaExecutable,
    [string]$NodeExecutable = 'node',
    [string]$AdbExecutable,
    [string]$DeviceSerial,
    [string]$OutputRoot,
    [switch]$CompileOnly
)

$ErrorActionPreference = 'Stop'

# Quote argv using the Windows CRT convention, including trailing slashes and
# embedded quotes. ProcessStartInfo.ArgumentList is unavailable in PowerShell 5.1.
function ConvertTo-KernelArgument([AllowEmptyString()][string]$Value) {
    return '"' + (($Value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

# Resolve an existing application only; shell scripts and batch files are not used.
function Resolve-KernelTool([string]$Value) {
    $tool = Get-Command -Name $Value -CommandType Application -ErrorAction Stop | Select-Object -First 1
    return $tool.Source
}

# Execute without a shell and fail on every nonzero exit. Capturing both streams
# asynchronously prevents a full stderr pipe from hanging a compiler or adb.
# Private commands suppress raw stderr and all argv (notably adb device IDs).
function Invoke-KernelCommand {
    param([string]$Executable, [string[]]$Arguments, [string]$Directory,
        [string]$Label, [string]$LogPath, [switch]$Private)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = ($Arguments | ForEach-Object { ConvertTo-KernelArgument $_ }) -join ' '
    $info.WorkingDirectory = $Directory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $info.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw "$Label could not start." }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = $stdoutTask.Result
        $stderr = $stderrTask.Result
        if ($LogPath -and -not $Private) {
            [IO.File]::WriteAllText($LogPath, $stdout + $stderr, (New-Object Text.UTF8Encoding($false)))
        }
        if ($process.ExitCode -ne 0) {
            $detail = if ($Private) { ' Raw device output withheld.' } else { " See log: $LogPath" }
            throw "$Label failed with exit code $($process.ExitCode).$detail"
        }
        return $stdout
    } finally { $process.Dispose() }
}

# Return one authorized serial without printing or persisting it. An unauthorized
# or offline second device still makes automatic selection ambiguous.
function Select-KernelDevice([string]$Listing, [string]$Requested) {
    $devices = @($Listing -split '\r?\n' | ForEach-Object {
        if ($_.Trim() -and $_ -notmatch '^List of devices attached\s*$') {
            if ($_ -notmatch '^([^\s]+)\s+(.+?)\s*$') { throw 'Unrecognized device inventory; automatic selection is unsafe.' }
            [pscustomobject]@{ Serial = $Matches[1]; State = $Matches[2] }
        }
    })
    if ($Requested) {
        $selected = @($devices | Where-Object { $_.Serial -ceq $Requested })
        if ($selected.Count -ne 1 -or $selected[0].State -ne 'device') {
            throw 'The explicitly selected device is missing or not authorized/online.'
        }
        return $selected[0].Serial
    }
    if ($devices.Count -ne 1 -or $devices[0].State -ne 'device') {
        throw 'Exactly one authorized device is required; use -DeviceSerial for explicit selection. No device IDs were logged.'
    }
    return $devices[0].Serial
}

# Strictly require both harness summary objects. A baseline with passed:true but
# nativeDifferential:false is NEVER device evidence, and string "true" is rejected.
function Assert-KernelSummaries([string]$Output, [bool]$Native) {
    $summaries = @($Output -split '\r?\n' | Where-Object { $_.Trim().StartsWith('{') } |
        ForEach-Object { ConvertFrom-Json -InputObject $_ -ErrorAction Stop })
    if ($summaries.Count -ne 2) { throw 'Expected both character and records differential summaries.' }
    foreach ($summary in $summaries) {
        if ($summary.passed -isnot [bool] -or -not $summary.passed -or
            $summary.nativeDifferential -isnot [bool] -or $summary.nativeDifferential -ne $Native) {
            throw 'Harness did not confirm the required differential mode and success.'
        }
    }
    if ($summaries[0].cases -ne 33 -or $summaries[1].recordsCases -ne 38) {
        throw 'Expected all 33 character and 38 records cases; update this gate explicitly when extending the corpus.'
    }
    return $summaries
}

# Manifest names become remote shell paths. Permit only public corpus basenames,
# reject duplicate names, and bind each staged file to its generated byte length.
function Get-KernelCases([string]$CorpusDirectory) {
    $cases = @()
    foreach ($kind in @('', 'record-')) {
        $manifest = Get-Content -LiteralPath (Join-Path $CorpusDirectory ($kind + 'manifest.json')) -Raw | ConvertFrom-Json
        $expected = if ($kind) { 38 } else { 33 }
        if ($manifest.Count -ne $expected) { throw 'Incomplete public corpus manifest.' }
        foreach ($item in $manifest) {
            if ($item.name -cnotmatch '^[a-z0-9][a-z0-9-]*$') { throw 'Unsafe public corpus name.' }
            $name = $kind + $item.name
            $inputFile = Join-Path $CorpusDirectory ($name + '.xlsx')
            if ((Get-Item -LiteralPath $inputFile).Length -ne $item.bytes) { throw 'Public corpus length mismatch.' }
            $cases += [pscustomobject]@{ Name = $name; Records = [bool]$kind; File = $inputFile }
        }
    }
    if (@($cases.Name | Select-Object -Unique).Count -ne $cases.Count) { throw 'Duplicate public corpus names.' }
    return $cases
}

function Invoke-AndroidKernelCheck {
    $mobileRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    if (-not $SdkRoot) { throw 'Set -SdkRoot, ANDROID_HOME or ANDROID_SDK_ROOT to an existing SDK.' }
    if (-not $NdkRoot) { $NdkRoot = Join-Path $SdkRoot ('ndk/' + $NdkVersion) }
    if (-not $CMakeExecutable) { $CMakeExecutable = Join-Path $SdkRoot ("cmake/$CMakeVersion/bin/cmake.exe") }
    if (-not $NinjaExecutable) { $NinjaExecutable = Join-Path (Split-Path $CMakeExecutable -Parent) 'ninja.exe' }
    $cmake = Resolve-KernelTool $CMakeExecutable
    $ninja = Resolve-KernelTool $NinjaExecutable
    $node = Resolve-KernelTool $NodeExecutable
    $toolchain = (Resolve-Path -LiteralPath (Join-Path $NdkRoot 'build/cmake/android.toolchain.cmake')).Path
    if (-not $CompileOnly) {
        if (-not $AdbExecutable) { $AdbExecutable = Join-Path $SdkRoot 'platform-tools/adb.exe' }
        $adb = Resolve-KernelTool $AdbExecutable
        $listing = Invoke-KernelCommand $adb @('devices') $mobileRoot 'Device inventory' -Private
        $serial = Select-KernelDevice $listing $DeviceSerial
        $abis = (Invoke-KernelCommand $adb @('-s', $serial, 'shell', 'getprop', 'ro.product.cpu.abilist') $mobileRoot 'Device ABI check' -Private).Trim().Split(',')
        if ('arm64-v8a' -notin $abis -or 'armeabi-v7a' -notin $abis) {
            throw 'Selected device must execute BOTH arm64-v8a and armeabi-v7a; one ABI cannot substitute for the other.'
        }
    }
    if (-not $OutputRoot) { $OutputRoot = Join-Path $mobileRoot 'android/build/table-kernel-device' }
    $runId = [Guid]::NewGuid().ToString('N')
    $runDirectory = [IO.Path]::GetFullPath((Join-Path $OutputRoot $runId))
    $null = New-Item -ItemType Directory -Path $runDirectory
    Write-Host "Local evidence: $runDirectory"
    $null = Invoke-KernelCommand $node @('scripts/check-table-kernel-vendor.mjs') $mobileRoot 'Vendored source verification' (Join-Path $runDirectory 'vendor.log')
    $baseline = Invoke-KernelCommand $node @('scripts/check-table-kernel.mjs') $mobileRoot 'Public baseline generation' (Join-Path $runDirectory 'baseline.log')
    $null = Assert-KernelSummaries $baseline $false
    $generated = Join-Path $mobileRoot 'ios/build/table-kernel-corpus'
    $publicCases = @(Get-KernelCases $generated)
    $corpus = Join-Path $runDirectory 'corpus'
    $null = New-Item -ItemType Directory -Path $corpus
    foreach ($case in $publicCases) { Copy-Item -LiteralPath $case.File -Destination $corpus }
    foreach ($name in @('manifest.json', 'record-manifest.json')) { Copy-Item -LiteralPath (Join-Path $generated $name) -Destination $corpus }
    $publicCases = @(Get-KernelCases $corpus)
    $project = Join-Path $runDirectory 'project'
    $null = New-Item -ItemType Directory -Path $project
    $cmakeSource = @'
cmake_minimum_required(VERSION 3.22)
project(coc_table_kernel_device_probe LANGUAGES C CXX)
add_subdirectory("${COC_MOBILE_ROOT}/native/table-kernel" "${CMAKE_CURRENT_BINARY_DIR}/table-kernel")
add_executable(coc-table-kernel-probe "${COC_MOBILE_ROOT}/tests/table-kernel-cli.cpp")
target_compile_features(coc-table-kernel-probe PRIVATE cxx_std_17)
target_include_directories(coc-table-kernel-probe PRIVATE "${COC_MOBILE_ROOT}/native/table-kernel")
target_link_libraries(coc-table-kernel-probe PRIVATE coc_table_kernel)
'@
    [IO.File]::WriteAllText((Join-Path $project 'CMakeLists.txt'), $cmakeSource, (New-Object Text.UTF8Encoding($false)))
    $builds = @()
    foreach ($abi in @('arm64-v8a', 'armeabi-v7a')) {
        Write-Host "Building production kernel: $abi"
        $build = Join-Path $runDirectory $abi
        $null = Invoke-KernelCommand $cmake @('-S', $project, '-B', $build, '-G', 'Ninja',
            "-DCMAKE_MAKE_PROGRAM=$ninja", "-DCMAKE_TOOLCHAIN_FILE=$toolchain",
            "-DCOC_MOBILE_ROOT=$($mobileRoot.Replace('\', '/'))", "-DANDROID_ABI=$abi",
            '-DANDROID_PLATFORM=android-23', '-DANDROID_STL=c++_static', '-DCMAKE_BUILD_TYPE=Release') $mobileRoot "$abi configure" (Join-Path $runDirectory ($abi + '-configure.log'))
        $null = Invoke-KernelCommand $cmake @('--build', $build, '--target', 'coc-table-kernel-probe', '--parallel', '2') $mobileRoot "$abi compile" (Join-Path $runDirectory ($abi + '-build.log'))
        $binary = Join-Path $build 'coc-table-kernel-probe'
        if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "$abi binary missing after build." }
        $builds += [pscustomobject]@{ abi = $abi; binary = $binary; sha256 = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    $summary = [ordered]@{ status = 'compiled-only'; nativeDifferential = $false; characterCases = 33; recordsCases = 38; builds = $builds }
    if (-not $CompileOnly) {
        # Generated remote paths contain only fixed tokens, hex and validated public
        # names. Never interpolate a local path or device ID into a remote shell.
        $remote = '/data/local/tmp/coc-table-kernel-' + $runId
        $null = Invoke-KernelCommand $adb @('-s', $serial, 'shell', 'mkdir', $remote) $mobileRoot 'Create isolated probe directory' -Private
        $null = Invoke-KernelCommand $adb @('-s', $serial, 'push', $corpus, "$remote/corpus") $mobileRoot 'Stage public corpus' -Private
        foreach ($build in $builds) {
            $abi = $build.abi
            $remoteAbi = "$remote/$abi"
            $null = Invoke-KernelCommand $adb @('-s', $serial, 'shell', 'mkdir', $remoteAbi, "$remoteAbi/results") $mobileRoot "$abi result directory" -Private
            $null = Invoke-KernelCommand $adb @('-s', $serial, 'push', $build.binary, "$remoteAbi/probe") $mobileRoot "$abi stage binary" -Private
            $null = Invoke-KernelCommand $adb @('-s', $serial, 'shell', 'chmod', '700', "$remoteAbi/probe") $mobileRoot "$abi executable permission" -Private
            $index = 0
            foreach ($case in $publicCases) {
                $index++
                Write-Host "$abi public case $index/$($publicCases.Count): $($case.Name)"
                $mode = if ($case.Records) { ' records' } else { '' }
                $command = "$remoteAbi/probe $remote/corpus/$($case.Name).xlsx$mode > $remoteAbi/results/$($case.Name).json"
                $null = Invoke-KernelCommand $adb @('-s', $serial, 'shell', $command) $mobileRoot "$abi case $($case.Name)" -Private
            }
            $results = Join-Path $runDirectory ($abi + '-results')
            $null = Invoke-KernelCommand $adb @('-s', $serial, 'pull', "$remoteAbi/results", $results) $mobileRoot "$abi retrieve public results" -Private
            foreach ($case in $publicCases) {
                $resultFile = Join-Path $results ($case.Name + '.json')
                if (-not (Test-Path -LiteralPath $resultFile -PathType Leaf) -or (Get-Item -LiteralPath $resultFile).Length -eq 0) {
                    throw "$abi missing or empty result: $($case.Name)"
                }
            }
            $verified = Invoke-KernelCommand $node @('scripts/check-table-kernel.mjs', '--saved-results', $results) $mobileRoot "$abi full differential" (Join-Path $runDirectory ($abi + '-verification.log'))
            $null = Assert-KernelSummaries $verified $true
            Write-Host "${abi}: 33 character + 38 records actual native differential cases passed."
        }
        $summary.status = 'native-differential-passed'
        $summary.nativeDifferential = $true
        $summary.remoteDirectory = $remote
    }
    [IO.File]::WriteAllText((Join-Path $runDirectory 'summary.json'), ($summary | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
    if ($CompileOnly) { Write-Host 'COMPILE ONLY: both ABIs built; nativeDifferential:false. No device cases ran.' }
    else { Write-Host 'PASS: both ABIs ran all 71 public cases and passed the complete-reader differential.' }
}

# Dot-sourcing exposes only helpers for the dependency-free regression test.
if ($MyInvocation.InvocationName -ne '.') { Invoke-AndroidKernelCheck }
