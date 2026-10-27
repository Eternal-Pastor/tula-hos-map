param(
    [string]$PackageRoot = (Join-Path $PSScriptRoot '..'),
    [ValidateRange(1024,65470)][int]$Port = 19765
)
$ErrorActionPreference = 'Stop'
$PackageRoot = [IO.Path]::GetFullPath($PackageRoot)
$taskTemporary = Join-Path ([IO.Path]::GetTempPath()) ('hospital-map-verify-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $taskTemporary
$taskProcesses = New-Object Collections.Generic.List[object]
$taskBlocker = $null

function Start-TestMap([string]$Name) {
    # START.cmd invokes the Windows PowerShell executable by its absolute path.
    # Give the child only Windows paths to verify that Node/npm are not needed.
    $originalPath = $env:PATH
    try {
        $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
        $output = Join-Path $taskTemporary ($Name + '.out.log')
        $errors = Join-Path $taskTemporary ($Name + '.err.log')
        $arguments = '/d /c ""' + (Join-Path $PackageRoot 'START.cmd') + '" -NoBrowser -Port ' + $Port + '"'
        $process = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList $arguments -WorkingDirectory $PackageRoot -WindowStyle Hidden -RedirectStandardOutput $output -RedirectStandardError $errors -PassThru
        $null = $process.Handle
        $taskProcesses.Add($process)
        return @{ Process = $process; Output = $output; Errors = $errors }
    }
    finally { $env:PATH = $originalPath }
}
function Stop-TestMap($Process) {
    if ($Process.HasExited) { return }
    # Stop only descendants of this test launcher, children before parents.
    function Stop-ChildTree([int]$ProcessId) {
        $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId"
        foreach ($child in $children) { Stop-ChildTree $child.ProcessId }
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
    Stop-ChildTree $Process.Id
    $null = $Process.WaitForExit(5000)
}
function Read-Local([int]$TargetPort, [string]$Resource) {
    $request = [Net.HttpWebRequest]::Create("http://localhost:$TargetPort/$Resource")
    $request.Proxy = $null
    $request.Timeout = 1500
    $response = $request.GetResponse()
    try {
        $memory = New-Object IO.MemoryStream
        try { $response.GetResponseStream().CopyTo($memory); return ,$memory.ToArray() }
        finally { $memory.Dispose() }
    }
    finally { $response.Dispose() }
}
function Wait-Map([int]$TargetPort) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        try { return [Text.Encoding]::UTF8.GetString((Read-Local $TargetPort '.well-known/hospital-map')) | ConvertFrom-Json }
        catch { Start-Sleep -Milliseconds 250 }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Map server did not start on localhost:$TargetPort."
}
try {
    # Abort if either test port is occupied; never reuse or stop a user server.
    foreach ($candidate in @($Port, ($Port + 1))) {
        $probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $candidate)
        try { $probe.Start() }
        finally { $probe.Stop() }
    }
    $manifest = Get-Content -LiteralPath (Join-Path $PackageRoot 'package-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $first = Start-TestMap 'first'
    $health = Wait-Map $Port
    if (!$health.identity.StartsWith('tula-hospital-map:' + $manifest.build + ':')) { throw 'Unexpected server identity.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        foreach ($relative in $manifest.runtimeRequired) {
            $resource = $relative -replace '^hospital-map/', ''
            $bytes = Read-Local $Port $resource
            $actual = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
            if ($actual -ne $manifest.files.PSObject.Properties[$relative].Value.sha256) { throw "HTTP resource differs from manifest: $relative" }
        }
    }
    finally { $sha.Dispose() }
    $reused = Start-TestMap 'reuse'
    $reusedExited = $reused.Process.WaitForExit(15000)
    $reused.Process.Refresh()
    if (!$reusedExited -or $reused.Process.ExitCode -ne 0) {
        throw ('The second START.cmd did not reuse the running server. Exit={0}; output={1}; errors={2}' -f $reused.Process.ExitCode, (Get-Content -LiteralPath $reused.Output -Raw), (Get-Content -LiteralPath $reused.Errors -Raw))
    }
    if ((Get-Content -LiteralPath $reused.Output -Raw) -notmatch 'Reusing the existing server') { throw 'Reuse message is missing.' }
    Stop-TestMap $first.Process
    Start-Sleep -Milliseconds 300
    $taskBlocker = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    $taskBlocker.Start()
    $fallback = Start-TestMap 'fallback'
    $next = Wait-Map ($Port + 1)
    if ($next.identity -ne $health.identity) { throw 'Fallback server has a different identity.' }
    Write-Output ('PASS: START.cmd without Node/npm; {0} HTTP resources; both pages; same-server reuse; occupied-port fallback.' -f $manifest.runtimeRequired.Count)
}
finally {
    foreach ($process in $taskProcesses) { Stop-TestMap $process }
    if ($taskBlocker) { $taskBlocker.Stop() }
    # Remove only this test's verified, uniquely named temp directory.
    $resolvedTemporary = [IO.Path]::GetFullPath($taskTemporary)
    $temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($resolvedTemporary) -ne $temporaryParent -or [IO.Path]::GetFileName($resolvedTemporary) -notlike 'hospital-map-verify-*') { throw 'Unexpected verification temporary directory.' }
    Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
}
