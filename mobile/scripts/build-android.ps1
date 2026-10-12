$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = 'F:\AndroidTools\jdk-21'
$env:ANDROID_HOME = 'F:\AndroidSDK'
$env:GRADLE_USER_HOME = 'F:\AndroidTools\coc-android-spike\gradle-cache'
Push-Location (Join-Path $PSScriptRoot '..\android')
try {
    & '.\gradlew.bat' assembleDebug --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Android build failed: $LASTEXITCODE" }
} finally { Pop-Location }
