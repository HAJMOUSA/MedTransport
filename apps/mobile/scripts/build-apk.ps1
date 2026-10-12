<#
.SYNOPSIS
  Build a distributable release APK for the MidTransport Driver app.

.DESCRIPTION
  Auto-increments versionCode in android/app/build.gradle, optionally sets a
  new versionName, embeds the backend API URL into the JS bundle, runs
  `gradlew assembleRelease`, and copies the signed APK into apps/mobile/dist/
  with the version in the filename so testers can tell builds apart.

  The release APK is signed with the shared debug keystore (fine for
  sideloading via Drive; NOT for Play Store upload).

.PARAMETER VersionName
  Optional. Sets versionName (e.g. "1.0.1"). If omitted, the current
  versionName is kept.

.PARAMETER ApiUrl
  Backend URL baked into the build. Defaults to the preview backend.

.EXAMPLE
  ./scripts/build-apk.ps1
  ./scripts/build-apk.ps1 -VersionName 1.1.0
  ./scripts/build-apk.ps1 -ApiUrl https://staging.example.com
#>
[CmdletBinding()]
param(
    [string]$VersionName,
    [string]$ApiUrl = "https://midtransport.hajmousa.com"
)

$ErrorActionPreference = "Stop"

# --- Resolve paths relative to this script (apps/mobile/scripts) ---
$mobileDir  = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $mobileDir "android"
$gradleFile = Join-Path $androidDir "app\build.gradle"
$distDir    = Join-Path $mobileDir "dist"

if (-not (Test-Path $gradleFile)) {
    throw "build.gradle not found at $gradleFile. Run from the mobile app repo."
}

# --- Bump versionCode (+1) and optionally set versionName ---
$gradle = Get-Content $gradleFile -Raw

if ($gradle -notmatch 'versionCode\s+(\d+)') {
    throw "Could not find versionCode in build.gradle."
}
$oldCode = [int]$Matches[1]
$newCode = $oldCode + 1
$gradle  = $gradle -replace 'versionCode\s+\d+', "versionCode $newCode"

if ($VersionName) {
    $gradle = $gradle -replace 'versionName\s+"[^"]*"', "versionName `"$VersionName`""
}
if ($gradle -match 'versionName\s+"([^"]*)"') {
    $effectiveVersionName = $Matches[1]
}

Set-Content -Path $gradleFile -Value $gradle -NoNewline
Write-Host "versionCode: $oldCode -> $newCode  |  versionName: $effectiveVersionName" -ForegroundColor Cyan

# --- Build ---
$env:EXPO_PUBLIC_API_URL = $ApiUrl
Write-Host "API URL baked in: $ApiUrl" -ForegroundColor Cyan
Write-Host "Running gradlew assembleRelease..." -ForegroundColor Cyan

Push-Location $androidDir
try {
    & .\gradlew.bat assembleRelease --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed (exit $LASTEXITCODE)." }
}
finally {
    Pop-Location
}

# --- Collect the APK ---
$builtApk = Join-Path $androidDir "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $builtApk)) {
    throw "Build reported success but APK not found at $builtApk."
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$stamp   = Get-Date -Format "yyyyMMdd"
$outName = "midtransport-driver-v$effectiveVersionName-b$newCode-$stamp.apk"
$outPath = Join-Path $distDir $outName
Copy-Item $builtApk $outPath -Force

$sizeMB = [math]::Round((Get-Item $outPath).Length / 1MB, 1)
Write-Host ""
Write-Host "APK ready: $outPath ($sizeMB MB)" -ForegroundColor Green
Write-Host "Upload this file to Drive and share the link with testers." -ForegroundColor Green
