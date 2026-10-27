param(
    [ValidateRange(1024,65504)][int]$Port = 8765,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$packageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$mapRoot = Join-Path $packageRoot 'hospital-map'
$manifestPath = Join-Path $packageRoot 'package-manifest.json'
if (!(Test-Path -LiteralPath $manifestPath)) { throw 'Extract the complete ZIP archive before running START.cmd: package-manifest.json is missing.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schemaVersion -ne 2 -or !$manifest.build -or !$manifest.runtimeRequired) {
    throw 'The static build manifest is missing or outdated. Developers: run npm run build before starting the map.'
}
# Only Windows PowerShell and .NET are needed here. Never invoke npm or Node.js.
# Resolve and verify every built resource, including both pages and Workers.
function Get-StaticFileHash([string]$FilePath) {
    $stream = [IO.File]::OpenRead($FilePath)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose(); $stream.Dispose() }
}
foreach ($relative in $manifest.runtimeRequired) {
    $resourcePath = [IO.Path]::GetFullPath((Join-Path $packageRoot $relative))
    $expected = $manifest.files.PSObject.Properties[$relative].Value
    if (!$resourcePath.StartsWith($packageRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or !$expected) {
        throw "Invalid resource path in package manifest: $relative"
    }
    if (!(Test-Path -LiteralPath $resourcePath -PathType Leaf)) { throw "The static package is incomplete: $relative. Extract the complete archive or rebuild it with npm run build." }
    $file = New-Object IO.FileInfo($resourcePath)
    if ($file.Length -ne $expected.bytes -or (Get-StaticFileHash $resourcePath) -ne $expected.sha256) {
        throw "The static package contains a changed or incomplete resource: $relative. Rebuild it with npm run build or extract the complete archive."
    }
}
$sha = [Security.Cryptography.SHA256]::Create()
try { $rootIdentity = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($packageRoot.ToLowerInvariant())))).Replace('-','').ToLowerInvariant() }
finally { $sha.Dispose() }
$identity = 'tula-hospital-map:' + $manifest.build + ':' + $rootIdentity
Add-Type -Path (Join-Path $PSScriptRoot 'LocalMapServer.cs')
$server = $null
$mapUrl = $null
foreach ($candidatePort in $Port..($Port + 31)) {
    $candidate = New-Object HospitalMap.LocalMapServer($mapRoot, $candidatePort, $identity)
    try {
        $candidate.Start()
        $server = $candidate
        $mapUrl = "http://localhost:$candidatePort/"
        break
    }
    catch {
        $candidate.Stop()
        # Reuse only the exact package/folder already running, not another site.
        try {
            $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:$candidatePort/.well-known/hospital-map")
            $request.Proxy = $null
            $request.Timeout = 500
            $response = $request.GetResponse()
            $reader = New-Object IO.StreamReader($response.GetResponseStream())
            try { $existing = $reader.ReadToEnd() | ConvertFrom-Json }
            finally { $reader.Dispose(); $response.Dispose() }
            if ($existing.identity -eq $identity) {
                $mapUrl = "http://localhost:$candidatePort/"
                break
            }
        }
        catch { }
    }
}
if (!$mapUrl) { throw 'Cannot start the local map server: no free local port was found.' }
Write-Host "Map: $mapUrl"
if (!$NoBrowser) { Start-Process $mapUrl }
if (!$server) {
    Write-Host 'The same map is already running. Reusing the existing server.'
    exit 0
}
Write-Host 'Keep this window open. Press Ctrl+C to stop the map server.'
try { while ($server.IsRunning) { Start-Sleep -Milliseconds 250 } }
finally { $server.Stop() }
