[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TestRoot,

    [string]$ProbeScriptPath = (Join-Path $PSScriptRoot '..\scripts\Test-ProjectContinuity.ps1')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$results = [System.Collections.Generic.List[object]]::new()
$resolvedProbe = (Resolve-Path -LiteralPath $ProbeScriptPath).Path
$resolvedTestRoot = [IO.Path]::GetFullPath($TestRoot)
$runRoot = Join-Path $resolvedTestRoot ("run-{0}-{1}" -f [DateTimeOffset]::Now.ToString('yyyyMMddTHHmmssfff'), [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $runRoot -Force

function Add-TestResult {
    param([string]$Name, [ValidateSet('PASS','FAIL','BLOCKED')][string]$Status, [string]$Detail)
    $results.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail })
}

function Invoke-Native {
    param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $FilePath
    $start.WorkingDirectory = $WorkingDirectory
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.CreateNoWindow = $true
    foreach ($argument in $Arguments) { $null = $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $start; $null = $process.Start()
    $stdout = $process.StandardOutput.ReadToEnd(); $stderr = $process.StandardError.ReadToEnd(); $process.WaitForExit()
    return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr }
}

function Invoke-Probe {
    param([string]$ProjectRoot, [string]$Mode = 'Restore', [int]$MaxBootstrapBytes = 8192)
    $args = @('-NoProfile','-NonInteractive','-File',$resolvedProbe,'-ProjectRoot',$ProjectRoot,'-Mode',$Mode,'-MaxBootstrapBytes',[string]$MaxBootstrapBytes)
    $call = Invoke-Native (Get-Command pwsh -CommandType Application | Select-Object -First 1).Source $args $ProjectRoot
    $json = $null
    try { $json = $call.Stdout.Trim() | ConvertFrom-Json -Depth 40 }
    catch { throw "Probe did not return valid JSON. stdout=$($call.Stdout) stderr=$($call.Stderr)" }
    return [pscustomobject]@{ ExitCode = $call.ExitCode; Result = $json; Stderr = $call.Stderr }
}

function Invoke-FixtureGit {
    param([string]$Root, [string[]]$Arguments)
    return Invoke-Native (Get-Command git -CommandType Application | Select-Object -First 1).Source (@('-c','core.fsmonitor=false','--no-optional-locks','-C',$Root) + $Arguments) $Root
}

function Write-Utf8Json {
    param([string]$Path, [object]$Value)
    $text = $Value | ConvertTo-Json -Depth 40
    [IO.File]::WriteAllText($Path, $text + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Get-HashHex {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-GitBlobOid {
    param([string]$Root, [string]$RelativePath)
    $fullPath = Join-Path $Root ($RelativePath -replace '/', '\')
    $probe = Invoke-FixtureGit $Root @('hash-object', "--path=$RelativePath", $fullPath)
    if ($probe.ExitCode -ne 0) { throw "git hash-object failed for ${RelativePath}: $($probe.Stderr)" }
    return $probe.Stdout.Trim().ToLowerInvariant()
}
function Complete-FixtureState {
    param([string]$Root, [hashtable]$State)
    $live = Invoke-Probe $Root 'Probe'
    $State.observation.dirty = [bool]$live.Result.git.dirty
    $State.observation.change_summary.staged = [int]$live.Result.git.change_summary.staged
    $State.observation.change_summary.unstaged = [int]$live.Result.git.change_summary.unstaged
    $State.observation.change_summary.untracked = [int]$live.Result.git.change_summary.untracked
    Write-Utf8Json (Join-Path $Root 'runtime\context\state.json') $State
}

function New-Fixture {
    param([string]$Name, [switch]$Detached)
    $root = Join-Path $runRoot $Name
    $null = New-Item -ItemType Directory -Path $root
    $init = Invoke-Native (Get-Command git -CommandType Application | Select-Object -First 1).Source @('init','--initial-branch=main',$root) $runRoot
    if ($init.ExitCode -ne 0) { throw "git init failed: $($init.Stderr)" }

    $env:GIT_AUTHOR_NAME = 'Project Relay Test'
    $env:GIT_AUTHOR_EMAIL = 'relay-test@example.invalid'
    $env:GIT_COMMITTER_NAME = 'Project Relay Test'
    $env:GIT_COMMITTER_EMAIL = 'relay-test@example.invalid'

    $null = New-Item -ItemType Directory -Path (Join-Path $root 'docs') -Force
    Write-Utf8Json (Join-Path $root 'package.json') ([ordered]@{ name = 'gpt-talk-enhancer' })
    [IO.File]::WriteAllText((Join-Path $root 'README.md'), "fixture baseline`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $root 'docs\DOM-CONTRACT.md'), "fixture`n", [Text.UTF8Encoding]::new($false))
    $null = Invoke-FixtureGit $root @('add','package.json','README.md','docs/DOM-CONTRACT.md')
    $commit = Invoke-FixtureGit $root @('commit','-m','fixture baseline','--no-gpg-sign')
    if ($commit.ExitCode -ne 0) { throw "fixture baseline commit failed: $($commit.Stderr)" }
    $baseHead = (Invoke-FixtureGit $root @('rev-parse','HEAD')).Stdout.Trim()

    if ($Detached) {
        $detach = Invoke-FixtureGit $root @('checkout','--detach','--quiet')
        if ($detach.ExitCode -ne 0) { throw "fixture detach failed: $($detach.Stderr)" }
    }

    $null = New-Item -ItemType Directory -Path (Join-Path $root 'runtime\context') -Force
    [IO.File]::AppendAllText((Join-Path $root 'README.md'), "relay entry`n", [Text.UTF8Encoding]::new($false))
    $bootstrap = [ordered]@{
        protocol_id = 'project-relay'; schema_version = 2; project_id = 'gpt-talk-enhancer'
        identity_checks = @([ordered]@{ path = 'package.json'; json_pointer = '/name'; expected = 'gpt-talk-enhancer' })
        state_ref = 'runtime/context/state.json'
        entry_refs = [ordered]@{ readme = 'README.md'; host_contract = 'docs/DOM-CONTRACT.md' }
    }
    Write-Utf8Json (Join-Path $root 'runtime\context\bootstrap.json') $bootstrap

    $state = [ordered]@{
        protocol_id = 'project-relay'; schema_version = 2; project_id = 'gpt-talk-enhancer'; revision = 1
        observed_at = [DateTimeOffset]::Now.ToString('o')
        checkpoint = [ordered]@{
            mode = 'carrier_commit'; base_head = $baseHead; target_ref = 'refs/heads/main'
            carrier_paths = @('README.md','runtime/context/bootstrap.json','runtime/context/state.json')
        }
        observation = [ordered]@{
            dirty = $true
            change_summary = [ordered]@{ staged = 0; unstaged = 1; untracked = 2 }
            relevant_paths = @('package.json','README.md','docs/DOM-CONTRACT.md','runtime/context/bootstrap.json','runtime/context/state.json')
            content_checks = @(
                [ordered]@{ path='README.md'; algorithm='git-blob-oid'; digest=(Get-GitBlobOid $root 'README.md') },
                [ordered]@{ path='runtime/context/bootstrap.json'; algorithm='git-blob-oid'; digest=(Get-GitBlobOid $root 'runtime/context/bootstrap.json') }
            )
            probe_notes = @('Schema v2 fixture')
        }
        current_task = [ordered]@{
            goal='Exercise Project Relay schema v2.'; status='completed'; scope=@('fixture')
            source=[ordered]@{kind='current_user_request'; reference=$null; note='Synthetic fixture.'}
            authorization_note='Fixture metadata grants no authorization.'
        }
        open_items=@(); verification=@(); relevant_refs=@('README.md','docs/DOM-CONTRACT.md'); handoff_ref=$null
    }
    Write-Utf8Json (Join-Path $root 'runtime\context\state.json') $state
    Complete-FixtureState $root $state
    return $root
}

function Commit-Carrier {
    param([string]$Root)
    $null = Invoke-FixtureGit $Root @('add','README.md','runtime/context/bootstrap.json','runtime/context/state.json')
    $commit = Invoke-FixtureGit $Root @('commit','-m','relay carrier','--no-gpg-sign')
    if ($commit.ExitCode -ne 0) { throw "carrier commit failed: $($commit.Stderr)" }
}

function Test-Case {
    param([string]$Name, [scriptblock]$Body)
    try { & $Body; Add-TestResult $Name PASS 'Observed expected behavior.' }
    catch { Add-TestResult $Name FAIL $_.Exception.Message }
}

Test-Case 'prepared checkpoint matches carrier paths before commit' {
    $root = New-Fixture 'prepared'
    $probe = Invoke-Probe $root
    if ($probe.ExitCode -ne 0 -or $probe.Result.metadata_status -ne 'valid' -or $probe.Result.checkpoint_state -ne 'prepared' -or $probe.Result.freshness -ne 'matches') { throw "Unexpected result: $($probe.Result | ConvertTo-Json -Compress)" }
}

Test-Case 'staging carrier paths preserves prepared freshness' {
    $root = New-Fixture 'staged-prepared'
    $null = Invoke-FixtureGit $root @('add','README.md','runtime/context/bootstrap.json','runtime/context/state.json')
    $probe = Invoke-Probe $root
    if ($probe.ExitCode -ne 0 -or $probe.Result.checkpoint_state -ne 'prepared' -or $probe.Result.freshness -ne 'matches') { throw 'Staging the exact carrier path set changed checkpoint freshness.' }
}
Test-Case 'committed carrier remains matches without predicting its own HEAD' {
    $root = New-Fixture 'committed'; Commit-Carrier $root
    $probe = Invoke-Probe $root
    if ($probe.ExitCode -ne 0 -or $probe.Result.checkpoint_state -ne 'committed' -or $probe.Result.freshness -ne 'matches') { throw "Carrier commit did not remain fresh: $($probe.Result | ConvertTo-Json -Compress)" }
}

Test-Case 'Git-canonical content checks survive CRLF checkout normalization' {
    $root = New-Fixture 'crlf-normalization'; Commit-Carrier $root
    $null = Invoke-FixtureGit $root @('config','core.autocrlf','true')
    $readme = Join-Path $root 'README.md'
    $beforeRaw = Get-HashHex $readme
    $base = (Invoke-FixtureGit $root @('rev-parse','HEAD^')).Stdout.Trim()
    $away = Invoke-FixtureGit $root @('switch','--detach',$base)
    if ($away.ExitCode -ne 0) { throw "Could not switch to the carrier parent: $($away.Stderr)" }
    $back = Invoke-FixtureGit $root @('switch','main')
    if ($back.ExitCode -ne 0) { throw "Could not switch back to the carrier branch: $($back.Stderr)" }
    $afterRaw = Get-HashHex $readme
    if ($beforeRaw -eq $afterRaw) { throw 'Git checkout did not change raw line-ending bytes.' }
    $status = Invoke-FixtureGit $root @('status','--porcelain=v1','--untracked-files=all')
    if (-not [string]::IsNullOrWhiteSpace($status.Stdout)) { throw "Git checkout did not return a clean worktree: $($status.Stdout)" }
    $headOid = (Invoke-FixtureGit $root @('rev-parse','HEAD:README.md')).Stdout.Trim()
    $liveOid = Get-GitBlobOid $root 'README.md'
    if ($headOid -ne $liveOid) { throw 'Git-canonical README identity changed across checkout normalization.' }
    $probe = Invoke-Probe $root
    if ($probe.ExitCode -ne 0 -or $probe.Result.checkpoint_state -ne 'committed' -or $probe.Result.freshness -ne 'matches') { throw "Git-canonical check did not survive CRLF checkout normalization: $($probe.Result | ConvertTo-Json -Compress)" }
}
Test-Case 'worktree change after committed carrier becomes stale' {
    $root = New-Fixture 'postdirty'; Commit-Carrier $root
    [IO.File]::WriteAllText((Join-Path $root 'extra.txt'), "extra`n", [Text.UTF8Encoding]::new($false))
    $probe = Invoke-Probe $root
    if ($probe.ExitCode -ne 2 -or $probe.Result.checkpoint_state -ne 'committed' -or $probe.Result.freshness -ne 'worktree_changed') { throw 'Post-carrier worktree change was not detected.' }
}

Test-Case 'descendant commit after carrier becomes head_changed' {
    $root = New-Fixture 'descendant'; Commit-Carrier $root
    [IO.File]::WriteAllText((Join-Path $root 'post.txt'), "post`n", [Text.UTF8Encoding]::new($false))
    $null = Invoke-FixtureGit $root @('add','post.txt')
    $commit = Invoke-FixtureGit $root @('commit','-m','later change','--no-gpg-sign')
    if ($commit.ExitCode -ne 0) { throw 'Could not create descendant commit.' }
    $probe = Invoke-Probe $root
    if ($probe.ExitCode -ne 2 -or $probe.Result.freshness -ne 'head_changed' -or $probe.Result.checkpoint_state -ne 'stale') { throw 'Descendant commit was not reported stale.' }
}

Test-Case 'prepared checkpoint rejects an unexpected extra path' {
    $root = New-Fixture 'extra-path'
    [IO.File]::WriteAllText((Join-Path $root 'extra.txt'), "extra`n", [Text.UTF8Encoding]::new($false))
    $probe = Invoke-Probe $root
    if ($probe.ExitCode -ne 2 -or $probe.Result.checkpoint_state -ne 'prepared' -or $probe.Result.freshness -ne 'worktree_changed') { throw 'Unexpected prepared path was not detected.' }
}

Test-Case 'unborn repository is a valid probe state' {
    $root = Join-Path $runRoot 'unborn'; $null = New-Item -ItemType Directory -Path $root
    $null = Invoke-Native (Get-Command git -CommandType Application | Select-Object -First 1).Source @('init','--initial-branch=main',$root) $runRoot
    $probe = Invoke-Probe $root 'Probe'
    if ($probe.ExitCode -ne 0 -or $probe.Result.git.head_state -ne 'unborn' -or $null -ne $probe.Result.git.head) { throw 'Unborn state was not preserved.' }
}

Test-Case 'detached HEAD is reported explicitly' {
    $root = New-Fixture 'detached' -Detached
    $probe = Invoke-Probe $root 'Probe'
    if ($probe.ExitCode -ne 0 -or $probe.Result.git.branch_state -ne 'detached' -or $null -ne $probe.Result.git.branch) { throw 'Detached state was not preserved.' }
}

Test-Case 'dirty categories are counted independently' {
    $root = New-Fixture 'dirty'
    [IO.File]::WriteAllText((Join-Path $root 'tracked.txt'), "one`n", [Text.UTF8Encoding]::new($false))
    $null = Invoke-FixtureGit $root @('add','tracked.txt')
    [IO.File]::AppendAllText((Join-Path $root 'tracked.txt'), "two`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $root 'another.txt'), "untracked`n", [Text.UTF8Encoding]::new($false))
    $probe = Invoke-Probe $root 'Probe'
    if ($probe.Result.git.change_summary.staged -lt 1 -or $probe.Result.git.change_summary.unstaged -lt 1 -or $probe.Result.git.change_summary.untracked -lt 1) { throw 'Staged, unstaged, and untracked categories were not all detected.' }
}

Test-Case 'malformed JSON returns exit 10' {
    $root = New-Fixture 'malformed'; [IO.File]::WriteAllText((Join-Path $root 'runtime\context\bootstrap.json'), '{', [Text.UTF8Encoding]::new($false))
    $probe = Invoke-Probe $root 'Validate'; if ($probe.ExitCode -ne 10 -or $probe.Result.metadata_status -ne 'invalid') { throw 'Malformed JSON was not rejected.' }
}

Test-Case 'duplicate JSON key returns exit 10' {
    $root = New-Fixture 'duplicate'
    $bad = '{"protocol_id":"project-relay","protocol_id":"project-relay","schema_version":2,"project_id":"gpt-talk-enhancer","identity_checks":[],"state_ref":"runtime/context/state.json","entry_refs":{}}'
    [IO.File]::WriteAllText((Join-Path $root 'runtime\context\bootstrap.json'), $bad, [Text.UTF8Encoding]::new($false))
    $probe = Invoke-Probe $root 'Validate'; if ($probe.ExitCode -ne 10) { throw 'Duplicate key was not rejected.' }
}

Test-Case 'unknown schema version returns exit 10' {
    $root = New-Fixture 'schema'; $path = Join-Path $root 'runtime\context\bootstrap.json'; $data = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json; $data.schema_version = 3; Write-Utf8Json $path $data
    $probe = Invoke-Probe $root 'Validate'; if ($probe.ExitCode -ne 10) { throw 'Unknown schema version was not rejected.' }
}

Test-Case 'project identity mismatch returns exit 11' {
    $root = New-Fixture 'identity'; Write-Utf8Json (Join-Path $root 'package.json') ([ordered]@{ name = 'different-project' })
    $probe = Invoke-Probe $root 'Validate'; if ($probe.ExitCode -ne 11) { throw 'Project identity mismatch was not rejected.' }
}

Test-Case 'reference traversal returns exit 12' {
    $root = New-Fixture 'traversal'; $path = Join-Path $root 'runtime\context\bootstrap.json'; $data = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json; $data.state_ref = '../outside.json'; Write-Utf8Json $path $data
    $probe = Invoke-Probe $root 'Validate'; if ($probe.ExitCode -ne 12) { throw 'Traversal reference was not rejected.' }
}

Test-Case 'bootstrap size limit returns exit 10' {
    $root = New-Fixture 'size'; $probe = Invoke-Probe $root 'Validate' 10; if ($probe.ExitCode -ne 10) { throw 'Oversized Bootstrap was not rejected.' }
}

Test-Case 'restore does not change fixture files' {
    $root = New-Fixture 'readonly'
    $before = Get-ChildItem -LiteralPath $root -File -Recurse | Where-Object { $_.FullName -notmatch '[\\/]\.git[\\/]' } | ForEach-Object { "$($_.FullName.Substring($root.Length))=$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" } | Sort-Object
    $null = Invoke-Probe $root 'Restore'
    $after = Get-ChildItem -LiteralPath $root -File -Recurse | Where-Object { $_.FullName -notmatch '[\\/]\.git[\\/]' } | ForEach-Object { "$($_.FullName.Substring($root.Length))=$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" } | Sort-Object
    if (Compare-Object $before $after) { throw 'Restore changed fixture content.' }
}

try {
    $linkRoot = New-Fixture 'reparse'; $target = Join-Path $runRoot 'outside-target'; $null = New-Item -ItemType Directory -Path $target
    $link = Join-Path $linkRoot 'linked'; $null = New-Item -ItemType SymbolicLink -Path $link -Target $target -ErrorAction Stop
    $bootstrapPath = Join-Path $linkRoot 'runtime\context\bootstrap.json'; $data = Get-Content -LiteralPath $bootstrapPath -Raw | ConvertFrom-Json; $data.state_ref = 'linked/state.json'; Write-Utf8Json $bootstrapPath $data
    $probe = Invoke-Probe $linkRoot 'Validate'
    if ($probe.ExitCode -eq 12) { Add-TestResult 'reparse-point escape returns exit 12' PASS 'Observed expected behavior.' } else { Add-TestResult 'reparse-point escape returns exit 12' FAIL "Unexpected exit code $($probe.ExitCode)." }
} catch {
    Add-TestResult 'reparse-point escape returns exit 12' BLOCKED "The host could not create the isolated symbolic-link fixture: $($_.Exception.Message)"
}

$passCount = @($results | Where-Object Status -eq PASS).Count
$failCount = @($results | Where-Object Status -eq FAIL).Count
$blockedCount = @($results | Where-Object Status -eq BLOCKED).Count
$results | ForEach-Object { "{0}: {1} - {2}" -f $_.Status, $_.Name, $_.Detail }
"SUMMARY: PASS=$passCount FAIL=$failCount BLOCKED=$blockedCount"
"FIXTURES: $runRoot"
if ($failCount -gt 0) { exit 1 }
exit 0
