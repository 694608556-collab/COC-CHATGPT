param(
    [Parameter(Mandatory = $true)][string]$KeyStore,
    [Parameter(Mandatory = $true)][string]$KeyAlias,
    [Parameter(Mandatory = $true)][string]$StorePasswordFile,
    [Parameter(Mandatory = $true)][string]$KeyPasswordFile,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$BuildToolsVersion = '36.0.0'
)
$ErrorActionPreference = 'Stop'
$cocMobileRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cocRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $cocMobileRoot '..'))
if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) { throw 'JDK 21 and JAVA_HOME are required.' }
if (-not $env:ANDROID_HOME -and $env:ANDROID_SDK_ROOT) { $env:ANDROID_HOME = $env:ANDROID_SDK_ROOT }
if (-not $env:ANDROID_HOME) { throw 'ANDROID_HOME is required.' }
$cocTools = Join-Path $env:ANDROID_HOME ('build-tools/' + $BuildToolsVersion)
foreach ($cocTool in @('zipalign.exe', 'apksigner.bat', 'aapt.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $cocTools $cocTool))) { throw "Missing Android build tool: $cocTool" }
}
# Secrets are supplied as local files outside the checkout; never accept plaintext CLI passwords.
foreach ($cocSecretFile in @($KeyStore, $StorePasswordFile, $KeyPasswordFile)) {
    $cocSecretPath = (Resolve-Path -LiteralPath $cocSecretFile).Path
    if ($cocSecretPath.StartsWith($cocRepoRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Keep signing material outside the repository.'
    }
}
$KeyStore = (Resolve-Path -LiteralPath $KeyStore).Path
$StorePasswordFile = (Resolve-Path -LiteralPath $StorePasswordFile).Path
$KeyPasswordFile = (Resolve-Path -LiteralPath $KeyPasswordFile).Path
$cocVersion = (Get-Content -Raw -LiteralPath (Join-Path $cocMobileRoot 'package.json') | ConvertFrom-Json).version
$cocGradle = Get-Content -Raw -LiteralPath (Join-Path $cocMobileRoot 'android/app/build.gradle')
$cocVersionCode = [regex]::Match($cocGradle, 'versionCode\s+(\d+)').Groups[1].Value
if (-not $cocVersionCode) { throw 'Android versionCode is missing.' }
$cocOutputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$cocSignedApk = Join-Path $cocOutputRoot ("coc-logbook-$cocVersion.apk")
$cocAlignedApk = Join-Path $cocMobileRoot 'android/app/build/outputs/apk/release/app-release-aligned-unsigned.apk'
if (Test-Path -LiteralPath $cocSignedApk) { throw 'Output already exists; choose a new output directory instead of overwriting.' }
[void][System.IO.Directory]::CreateDirectory($cocOutputRoot)
Push-Location $cocMobileRoot
try {
    & pnpm sync
    if ($LASTEXITCODE -ne 0) { throw 'Web build or Capacitor sync failed.' }
    & node scripts/check-release-web.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Release web artifact check failed.' }
    Push-Location (Join-Path $cocMobileRoot 'android')
    try {
        & '.\gradlew.bat' assembleRelease --no-daemon --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'Release build failed.' }
    } finally { Pop-Location }
    $cocUnsignedApk = Join-Path $cocMobileRoot 'android/app/build/outputs/apk/release/app-release-unsigned.apk'
    & (Join-Path $cocTools 'zipalign.exe') -P 16 -f 4 $cocUnsignedApk $cocAlignedApk
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    if (Test-Path Env:\COC_APK_SIGN_KEY_PASSWORD) { throw 'Reserved signing environment variable is already set.' }
    try {
        # apksigner consumes successive lines when the same password file is used twice.
        # Keep the key password in a short-lived child-process environment instead.
        $env:COC_APK_SIGN_KEY_PASSWORD = [System.IO.File]::ReadAllText($KeyPasswordFile).TrimEnd([char[]]"`r`n")
        & (Join-Path $cocTools 'apksigner.bat') sign --ks $KeyStore --ks-key-alias $KeyAlias --ks-pass "file:$StorePasswordFile" --key-pass env:COC_APK_SIGN_KEY_PASSWORD --out $cocSignedApk $cocAlignedApk
        if ($LASTEXITCODE -ne 0) { throw 'Release signing failed.' }
    } finally { Remove-Item Env:\COC_APK_SIGN_KEY_PASSWORD -ErrorAction SilentlyContinue }
    $cocSignatureInfo = & (Join-Path $cocTools 'apksigner.bat') verify --verbose --print-certs $cocSignedApk
    if ($LASTEXITCODE -ne 0) { throw 'Release signature verification failed.' }
    if (($cocSignatureInfo -join "`n") -match 'CN=Android Debug') { throw 'A debug signing certificate is not a release identity.' }
    Write-Output $cocSignatureInfo
    & (Join-Path $cocTools 'zipalign.exe') -c -P 16 4 $cocSignedApk
    if ($LASTEXITCODE -ne 0) { throw 'Signed APK alignment verification failed.' }
    $cocBadging = & (Join-Path $cocTools 'aapt.exe') dump badging $cocSignedApk
    $cocExpectedIdentity = "package: name='coc.logbook' versionCode='$cocVersionCode' versionName='$cocVersion'"
    if ($LASTEXITCODE -ne 0 -or -not ($cocBadging -join "`n").Contains($cocExpectedIdentity) -or $cocBadging -match '^application-debuggable') {
        throw 'Unexpected production identity, version or debuggable APK.'
    }
    & node scripts/check-release-apk.mjs $cocSignedApk
    if ($LASTEXITCODE -ne 0) { throw 'Packaged APK asset check failed.' }
    # .NET hashing also works when Windows PowerShell lacks the Utility module.
    $cocHashStream = [System.IO.File]::OpenRead($cocSignedApk)
    $cocHasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $cocHash = [BitConverter]::ToString($cocHasher.ComputeHash($cocHashStream)).Replace('-', '').ToLowerInvariant()
    } finally { $cocHashStream.Dispose(); $cocHasher.Dispose() }
    [System.IO.File]::WriteAllText($cocSignedApk + '.sha256', "$cocHash  $([System.IO.Path]::GetFileName($cocSignedApk))`n", [System.Text.UTF8Encoding]::new($false))
    Get-Item -LiteralPath $cocSignedApk | Select-Object FullName, Length
    Write-Output "SHA256: $cocHash"
} finally { Pop-Location }
