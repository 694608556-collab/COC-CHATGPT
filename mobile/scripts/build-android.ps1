$ErrorActionPreference = 'Stop'
if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) {
    throw '请安装 JDK 21 并设置 JAVA_HOME，再执行安卓构建。浏览器开发请运行 pnpm dev。'
}
if (-not $env:ANDROID_HOME -and $env:ANDROID_SDK_ROOT) { $env:ANDROID_HOME = $env:ANDROID_SDK_ROOT }
if (-not $env:ANDROID_HOME -or -not (Test-Path -LiteralPath $env:ANDROID_HOME)) {
    throw '请安装 Android SDK 并设置 ANDROID_HOME，再执行安卓构建。'
}
# Respect the caller's Gradle cache configuration; never reuse another computer's fixed drive paths.
Push-Location (Join-Path $PSScriptRoot '..\android')
try {
    & '.\gradlew.bat' assembleDebug --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Android build failed: $LASTEXITCODE" }
} finally { Pop-Location }
