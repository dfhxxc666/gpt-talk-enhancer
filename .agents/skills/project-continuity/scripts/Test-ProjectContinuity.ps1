[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,

    [ValidateSet('Probe', 'Validate', 'Restore')]
    [string]$Mode = 'Restore',

    [string]$BootstrapRelativePath = 'runtime/context/bootstrap.json',

    [ValidateRange(1, [int]::MaxValue)]
    [int]$MaxBootstrapBytes = 8192,

    [ValidateRange(1, [int]::MaxValue)]
    [int]$MaxStateBytes = 32768
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$result = [ordered]@{
    protocol_id      = 'project-relay-probe'
    schema_version   = 2
    mode             = $Mode
    project_root     = $null
    observed_at      = [DateTimeOffset]::Now.ToString('o')
    git              = $null
    metadata_status  = 'unassessed'
    checkpoint_state = 'unassessed'
    freshness        = 'unassessed'
    warnings         = [System.Collections.Generic.List[object]]::new()
    errors           = [System.Collections.Generic.List[object]]::new()
}

function Add-Diagnostic {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Warning', 'Error')][string]$Kind,
        [Parameter(Mandatory = $true)][string]$Code,
        [Parameter(Mandatory = $true)][string]$Message,
        [AllowNull()][string]$RelativePath
    )
    $entry = [ordered]@{ code = $Code; message = $Message; relative_path = $RelativePath }
    if ($Kind -eq 'Warning') { $result.warnings.Add($entry) } else { $result.errors.Add($entry) }
}

function Complete-Result {
    param([int]$ExitCode)
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 30 -Compress))
    exit $ExitCode
}

function Invoke-CapturedProcess {
    param([string]$FilePath, [string[]]$ArgumentList)
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    foreach ($argument in $ArgumentList) { $null = $startInfo.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $null = $process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr }
}

function Invoke-RelayGit {
    param([string[]]$Arguments)
    $base = @('-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', '-c', 'diff.external=', '-c', 'diff.trustExitCode=false', '--no-optional-locks', '-C', $script:resolvedRoot)
    return Invoke-CapturedProcess -FilePath $script:gitPath -ArgumentList ($base + $Arguments)
}

function Get-FullRelativePath {
    param([string]$RelativePath, [string]$Code = 'REFERENCE_OUTSIDE_PROJECT')
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or [IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -match '^[a-zA-Z][a-zA-Z0-9+.-]*:') {
        throw [InvalidOperationException]::new("$Code|Reference must be a non-empty repository-relative path: $RelativePath")
    }
    $candidate = [IO.Path]::GetFullPath((Join-Path $script:resolvedRoot $RelativePath))
    $rootPrefix = $script:resolvedRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw [InvalidOperationException]::new("$Code|Reference escapes the selected project: $RelativePath")
    }
    $current = $script:resolvedRoot
    foreach ($part in ($RelativePath -split '[\\/]')) {
        if ([string]::IsNullOrWhiteSpace($part) -or $part -eq '.') { continue }
        $current = Join-Path $current $part
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw [InvalidOperationException]::new("REPARSE_POINT_NOT_ALLOWED|Reference crosses a reparse point: $RelativePath")
            }
        }
    }
    return $candidate
}

function Assert-JsonObjectKeys {
    param([System.Text.Json.JsonElement]$Element, [string[]]$Allowed, [string[]]$Required, [string]$Location)
    if ($Element.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { throw "SCHEMA_TYPE|$Location must be an object" }
    $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($property in $Element.EnumerateObject()) {
        if (-not $seen.Add($property.Name)) { throw "DUPLICATE_KEY|Duplicate property '$($property.Name)' at $Location" }
        if ($Allowed -notcontains $property.Name) { throw "UNKNOWN_FIELD|Unknown property '$($property.Name)' at $Location" }
    }
    foreach ($name in $Required) { if (-not $seen.Contains($name)) { throw "MISSING_FIELD|Missing property '$name' at $Location" } }
}

function Assert-NoDuplicateKeys {
    param([System.Text.Json.JsonElement]$Element, [string]$Location = '$')
    if ($Element.ValueKind -eq [System.Text.Json.JsonValueKind]::Object) {
        $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($property in $Element.EnumerateObject()) {
            if (-not $seen.Add($property.Name)) { throw "DUPLICATE_KEY|Duplicate property '$($property.Name)' at $Location" }
            Assert-NoDuplicateKeys -Element $property.Value -Location "$Location.$($property.Name)"
        }
    } elseif ($Element.ValueKind -eq [System.Text.Json.JsonValueKind]::Array) {
        $index = 0
        foreach ($item in $Element.EnumerateArray()) { Assert-NoDuplicateKeys -Element $item -Location "$Location[$index]"; $index++ }
    }
}

function Read-StrictJson {
    param([string]$Path, [int]$MaximumBytes, [string]$RelativePath)
    $file = Get-Item -LiteralPath $Path -Force
    if ($file.Length -gt $MaximumBytes) { throw "FILE_TOO_LARGE|$RelativePath exceeds $MaximumBytes bytes" }
    $bytes = [IO.File]::ReadAllBytes($Path)
    $options = [System.Text.Json.JsonDocumentOptions]::new()
    $options.AllowTrailingCommas = $false
    $options.CommentHandling = [System.Text.Json.JsonCommentHandling]::Disallow
    try { $document = [System.Text.Json.JsonDocument]::Parse([ReadOnlyMemory[byte]]$bytes, $options) }
    catch { throw "JSON_SYNTAX|Invalid JSON in ${RelativePath}: $($_.Exception.Message)" }
    Assert-NoDuplicateKeys -Element $document.RootElement
    return $document
}

function Assert-StringArray {
    param([System.Text.Json.JsonElement]$Element, [string]$Location, [switch]$NonEmpty)
    if ($Element.ValueKind -ne [System.Text.Json.JsonValueKind]::Array) { throw "SCHEMA_TYPE|$Location must be an array" }
    if ($NonEmpty -and $Element.GetArrayLength() -eq 0) { throw "SCHEMA_VALUE|$Location must not be empty" }
    foreach ($item in $Element.EnumerateArray()) { if ($item.ValueKind -ne [System.Text.Json.JsonValueKind]::String) { throw "SCHEMA_TYPE|$Location items must be strings" } }
}

function Assert-RelativeFileReference {
    param([string]$RelativePath, [bool]$MustExist = $true)
    $fullPath = Get-FullRelativePath -RelativePath $RelativePath
    if ($MustExist -and -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "MISSING_REFERENCE|Referenced file does not exist: $RelativePath" }
    return $fullPath
}

function Get-JsonString {
    param([System.Text.Json.JsonElement]$Object, [string]$Name, [bool]$AllowNull = $false)
    $value = $Object.GetProperty($Name)
    if ($AllowNull -and $value.ValueKind -eq [System.Text.Json.JsonValueKind]::Null) { return $null }
    if ($value.ValueKind -ne [System.Text.Json.JsonValueKind]::String) { throw "SCHEMA_TYPE|$Name must be a string" }
    return $value.GetString()
}

function Convert-RepoPath {
    param([string]$Path)
    return ($Path.Trim() -replace '\\','/')
}

function Get-LiveChangePaths {
    $paths = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $tracked = Invoke-RelayGit @('diff','--name-only','HEAD','--')
    if ($tracked.ExitCode -ne 0) { throw 'GIT_DIFF_FAILED|Could not inspect changed tracked paths.' }
    foreach ($line in ($tracked.Stdout -split "`r?`n")) { if (-not [string]::IsNullOrWhiteSpace($line)) { $null = $paths.Add((Convert-RepoPath $line)) } }
    $untracked = Invoke-RelayGit @('ls-files','--others','--exclude-standard')
    if ($untracked.ExitCode -ne 0) { throw 'GIT_STATUS_FAILED|Could not inspect untracked paths.' }
    foreach ($line in ($untracked.Stdout -split "`r?`n")) { if (-not [string]::IsNullOrWhiteSpace($line)) { $null = $paths.Add((Convert-RepoPath $line)) } }
    return @($paths | Sort-Object)
}

function Get-CommitCarrierInfo {
    param([string]$Commit)
    $parentsProbe = Invoke-RelayGit @('rev-list','--parents','-n','1',$Commit)
    if ($parentsProbe.ExitCode -ne 0) { throw 'GIT_PROBE_FAILED|Could not inspect checkpoint commit parents.' }
    $parts = @($parentsProbe.Stdout.Trim() -split '\s+')
    $parent = if ($parts.Count -eq 2) { $parts[1] } else { $null }
    $pathProbe = Invoke-RelayGit @('diff-tree','--no-commit-id','--name-only','-r',$Commit)
    if ($pathProbe.ExitCode -ne 0) { throw 'GIT_DIFF_FAILED|Could not inspect checkpoint commit paths.' }
    $paths = @($pathProbe.Stdout -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { Convert-RepoPath $_ } | Sort-Object -Unique)
    return [pscustomobject]@{ SingleParent = ($parts.Count -eq 2); Parent = $parent; Paths = $paths }
}

function Test-PathSetEqual {
    param([string[]]$Left, [string[]]$Right)
    $leftSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $rightSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($item in @($Left)) { $null = $leftSet.Add((Convert-RepoPath $item)) }
    foreach ($item in @($Right)) { $null = $rightSet.Add((Convert-RepoPath $item)) }
    return $leftSet.SetEquals($rightSet)
}

function Get-ContentCheckDigest {
    param([string]$Algorithm, [string]$RelativePath)
    $fullPath = Assert-RelativeFileReference $RelativePath
    if ($Algorithm -eq 'sha256') {
        return (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    if ($Algorithm -eq 'git-blob-oid') {
        $probe = Invoke-RelayGit @('hash-object', "--path=$RelativePath", $fullPath)
        if ($probe.ExitCode -ne 0) { throw 'GIT_CONTENT_HASH_FAILED|Could not compute Git-canonical content identity.' }
        $oid = $probe.Stdout.Trim()
        if ($oid -notmatch '^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$') { throw 'GIT_CONTENT_HASH_FAILED|Git returned an invalid blob object id.' }
        return $oid.ToLowerInvariant()
    }
    throw 'SCHEMA_VALUE|Unsupported content check algorithm'
}

function Test-StateSchema {
    param([System.Text.Json.JsonElement]$State)
    $keys = @('protocol_id','schema_version','project_id','revision','observed_at','checkpoint','observation','current_task','open_items','verification','relevant_refs','handoff_ref')
    Assert-JsonObjectKeys $State $keys $keys '$state'
    if ((Get-JsonString $State 'protocol_id') -ne 'project-relay') { throw 'PROTOCOL_MISMATCH|state protocol_id must be project-relay' }
    if ($State.GetProperty('schema_version').ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or $State.GetProperty('schema_version').GetInt32() -ne 2) { throw 'UNSUPPORTED_SCHEMA|state schema_version must be 2' }
    if ((Get-JsonString $State 'project_id') -ne 'gpt-talk-enhancer') { throw 'PROJECT_ID_MISMATCH|state project_id does not match' }
    if ($State.GetProperty('revision').ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or $State.GetProperty('revision').GetInt32() -lt 1) { throw 'SCHEMA_TYPE|revision must be a positive integer' }
    $null = [DateTimeOffset]::Parse((Get-JsonString $State 'observed_at'), [Globalization.CultureInfo]::InvariantCulture)

    $checkpoint = $State.GetProperty('checkpoint')
    $checkpointKeys = @('mode','base_head','target_ref','carrier_paths')
    Assert-JsonObjectKeys $checkpoint $checkpointKeys $checkpointKeys '$state.checkpoint'
    if ((Get-JsonString $checkpoint 'mode') -ne 'carrier_commit') { throw 'SCHEMA_VALUE|checkpoint.mode must be carrier_commit' }
    if ((Get-JsonString $checkpoint 'base_head') -notmatch '^[0-9a-fA-F]{40}$') { throw 'SCHEMA_VALUE|checkpoint.base_head must be a full Git object id' }
    $targetRef = Get-JsonString $checkpoint 'target_ref'
    if ($targetRef -notmatch '^refs/heads/[A-Za-z0-9._/-]+$' -or $targetRef.Contains('..') -or $targetRef.Contains('//')) { throw 'SCHEMA_VALUE|checkpoint.target_ref must be a safe local branch ref' }
    Assert-StringArray $checkpoint.GetProperty('carrier_paths') '$state.checkpoint.carrier_paths' -NonEmpty
    $carrierSeen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($item in $checkpoint.GetProperty('carrier_paths').EnumerateArray()) {
        $value = Convert-RepoPath $item.GetString()
        $null = Assert-RelativeFileReference $value
        if (-not $carrierSeen.Add($value)) { throw 'SCHEMA_VALUE|checkpoint.carrier_paths must not contain duplicates' }
    }

    $observation = $State.GetProperty('observation')
    $observationKeys = @('dirty','change_summary','relevant_paths','content_checks','probe_notes')
    Assert-JsonObjectKeys $observation $observationKeys $observationKeys '$state.observation'
    $dirtyValue = $observation.GetProperty('dirty')
    if ($dirtyValue.ValueKind -notin @([System.Text.Json.JsonValueKind]::True,[System.Text.Json.JsonValueKind]::False,[System.Text.Json.JsonValueKind]::String) -or ($dirtyValue.ValueKind -eq [System.Text.Json.JsonValueKind]::String -and $dirtyValue.GetString() -ne 'unknown')) { throw 'SCHEMA_TYPE|dirty must be true, false, or unknown' }
    $summary = $observation.GetProperty('change_summary')
    Assert-JsonObjectKeys $summary @('staged','unstaged','untracked') @('staged','unstaged','untracked') '$state.observation.change_summary'
    foreach ($name in @('staged','unstaged','untracked')) { if ($summary.GetProperty($name).ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or $summary.GetProperty($name).GetInt32() -lt 0) { throw "SCHEMA_TYPE|$name must be a non-negative integer" } }
    foreach ($name in @('relevant_paths','probe_notes')) { Assert-StringArray $observation.GetProperty($name) "`$state.observation.$name" }
    foreach ($pathItem in $observation.GetProperty('relevant_paths').EnumerateArray()) { $null = Assert-RelativeFileReference $pathItem.GetString() }
    $checks = $observation.GetProperty('content_checks')
    if ($checks.ValueKind -ne [System.Text.Json.JsonValueKind]::Array) { throw 'SCHEMA_TYPE|content_checks must be an array' }
    foreach ($check in $checks.EnumerateArray()) {
        Assert-JsonObjectKeys $check @('path','algorithm','digest') @('path','algorithm','digest') '$state.observation.content_checks[]'
        $path = Get-JsonString $check 'path'; $null = Assert-RelativeFileReference $path
        $algorithm = Get-JsonString $check 'algorithm'
        $digest = Get-JsonString $check 'digest'
        if ($algorithm -eq 'sha256') {
            if ($digest -notmatch '^[0-9a-fA-F]{64}$') { throw 'SCHEMA_VALUE|sha256 content check digest must be 64 hex characters' }
        } elseif ($algorithm -eq 'git-blob-oid') {
            if ($digest -notmatch '^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$') { throw 'SCHEMA_VALUE|git-blob-oid digest must match the repository object format' }
        } else {
            throw 'SCHEMA_VALUE|Unsupported content check algorithm'
        }
    }

    $task = $State.GetProperty('current_task')
    if ($task.ValueKind -ne [System.Text.Json.JsonValueKind]::Null) {
        Assert-JsonObjectKeys $task @('goal','status','scope','source','authorization_note') @('goal','status','scope','source','authorization_note') '$state.current_task'
        if ([string]::IsNullOrWhiteSpace((Get-JsonString $task 'goal'))) { throw 'SCHEMA_VALUE|current_task.goal must not be empty' }
        if (@('active','paused','completed') -notcontains (Get-JsonString $task 'status')) { throw 'SCHEMA_VALUE|Invalid current_task status' }
        Assert-StringArray $task.GetProperty('scope') '$state.current_task.scope'
        $source = $task.GetProperty('source')
        Assert-JsonObjectKeys $source @('kind','reference','note') @('kind','reference','note') '$state.current_task.source'
        if (@('current_user_request','caller_supplied_handoff') -notcontains (Get-JsonString $source 'kind')) { throw 'SCHEMA_VALUE|Invalid current_task source kind' }
        $reference = $source.GetProperty('reference'); if ($reference.ValueKind -notin @([System.Text.Json.JsonValueKind]::String,[System.Text.Json.JsonValueKind]::Null)) { throw 'SCHEMA_TYPE|source.reference must be string or null' }
        if ([string]::IsNullOrWhiteSpace((Get-JsonString $source 'note'))) { throw 'SCHEMA_VALUE|source.note must not be empty' }
        $authorization = $task.GetProperty('authorization_note'); if ($authorization.ValueKind -notin @([System.Text.Json.JsonValueKind]::String,[System.Text.Json.JsonValueKind]::Null)) { throw 'SCHEMA_TYPE|authorization_note must be string or null' }
    }

    $openItems = $State.GetProperty('open_items'); if ($openItems.ValueKind -ne [System.Text.Json.JsonValueKind]::Array) { throw 'SCHEMA_TYPE|open_items must be an array' }
    foreach ($item in $openItems.EnumerateArray()) {
        Assert-JsonObjectKeys $item @('id','description','kind','evidence_refs','blocker') @('id','description','kind','evidence_refs','blocker') '$state.open_items[]'
        $null = Get-JsonString $item 'id'; $null = Get-JsonString $item 'description'
        if (@('unresolved_fact','pending_validation','suggestion') -notcontains (Get-JsonString $item 'kind')) { throw 'SCHEMA_VALUE|Invalid open item kind' }
        Assert-StringArray $item.GetProperty('evidence_refs') '$state.open_items[].evidence_refs'
        foreach ($ref in $item.GetProperty('evidence_refs').EnumerateArray()) { $null = Assert-RelativeFileReference $ref.GetString() }
        if ($item.GetProperty('blocker').ValueKind -notin @([System.Text.Json.JsonValueKind]::True,[System.Text.Json.JsonValueKind]::False)) { throw 'SCHEMA_TYPE|blocker must be boolean' }
    }

    $verification = $State.GetProperty('verification'); if ($verification.ValueKind -ne [System.Text.Json.JsonValueKind]::Array) { throw 'SCHEMA_TYPE|verification must be an array' }
    foreach ($item in $verification.EnumerateArray()) {
        Assert-JsonObjectKeys $item @('claim','kind','status','observed_at','scope','evidence_ref','limitations') @('claim','kind','status','observed_at','scope','evidence_ref','limitations') '$state.verification[]'
        $null = Get-JsonString $item 'claim'
        if (@('test','build','runtime','inspection','document_claim') -notcontains (Get-JsonString $item 'kind')) { throw 'SCHEMA_VALUE|Invalid verification kind' }
        if (@('passed','failed','not_run','blocked','historical') -notcontains (Get-JsonString $item 'status')) { throw 'SCHEMA_VALUE|Invalid verification status' }
        $null = [DateTimeOffset]::Parse((Get-JsonString $item 'observed_at'), [Globalization.CultureInfo]::InvariantCulture)
        Assert-StringArray $item.GetProperty('scope') '$state.verification[].scope'; Assert-StringArray $item.GetProperty('limitations') '$state.verification[].limitations'
        $evidence = $item.GetProperty('evidence_ref'); if ($evidence.ValueKind -eq [System.Text.Json.JsonValueKind]::String) { $null = Assert-RelativeFileReference $evidence.GetString() } elseif ($evidence.ValueKind -ne [System.Text.Json.JsonValueKind]::Null) { throw 'SCHEMA_TYPE|evidence_ref must be string or null' }
    }

    Assert-StringArray $State.GetProperty('relevant_refs') '$state.relevant_refs'
    foreach ($ref in $State.GetProperty('relevant_refs').EnumerateArray()) { $null = Assert-RelativeFileReference $ref.GetString() }
    $handoff = $State.GetProperty('handoff_ref'); if ($handoff.ValueKind -eq [System.Text.Json.JsonValueKind]::String) { $null = Assert-RelativeFileReference $handoff.GetString() } elseif ($handoff.ValueKind -ne [System.Text.Json.JsonValueKind]::Null) { throw 'SCHEMA_TYPE|handoff_ref must be string or null' }
}

try {
    if ($PSVersionTable.PSVersion.Major -lt 7 -or -not ('System.Text.Json.JsonDocument' -as [type])) {
        Add-Diagnostic Error 'RUNTIME_UNAVAILABLE' 'PowerShell 7 and System.Text.Json are required.' $null
        Complete-Result 21
    }

    $script:resolvedRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $script:resolvedRoot -PathType Container)) { throw 'PROJECT_ROOT_MISSING|Selected project root does not exist' }
    $rootItem = Get-Item -LiteralPath $script:resolvedRoot -Force
    if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_POINT_NOT_ALLOWED|Selected project root is a reparse point' }
    $result.project_root = $script:resolvedRoot

    $git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $git) { Add-Diagnostic Error 'GIT_UNAVAILABLE' 'Git executable is not available.' $null; Complete-Result 21 }
    $script:gitPath = $git.Source

    $rootProbe = Invoke-RelayGit @('rev-parse','--show-toplevel')
    if ($rootProbe.ExitCode -ne 0) { Add-Diagnostic Error 'GIT_PROBE_FAILED' 'The selected directory is not an accessible Git worktree.' $null; Complete-Result 20 }
    $gitRoot = [IO.Path]::GetFullPath($rootProbe.Stdout.Trim()).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    if (-not $gitRoot.Equals($script:resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) { Add-Diagnostic Error 'PROJECT_ROOT_MISMATCH' 'The selected directory is not the root of its Git worktree.' $null; Complete-Result 11 }

    $commonProbe = Invoke-RelayGit @('rev-parse','--git-common-dir')
    if ($commonProbe.ExitCode -ne 0) { Add-Diagnostic Error 'GIT_PROBE_FAILED' 'Could not determine the Git common directory.' $null; Complete-Result 20 }
    $commonRaw = $commonProbe.Stdout.Trim()
    $commonDir = if ([IO.Path]::IsPathRooted($commonRaw)) { [IO.Path]::GetFullPath($commonRaw) } else { [IO.Path]::GetFullPath((Join-Path $script:resolvedRoot $commonRaw)) }

    $headProbe = Invoke-RelayGit @('rev-parse','--verify','HEAD')
    if ($headProbe.ExitCode -eq 0) { $headState = 'valid'; $head = $headProbe.Stdout.Trim() } else { $headState = 'unborn'; $head = $null }
    $branchProbe = Invoke-RelayGit @('symbolic-ref','--quiet','--short','HEAD')
    if ($branchProbe.ExitCode -eq 0) { $branchState = 'attached'; $branch = $branchProbe.Stdout.Trim() }
    elseif ($headState -eq 'valid') { $branchState = 'detached'; $branch = $null }
    else { $branchState = 'attached'; $branch = (Invoke-RelayGit @('symbolic-ref','--short','HEAD')).Stdout.Trim() }

    $statusProbe = Invoke-RelayGit @('status','--porcelain=v1','-z','--untracked-files=all')
    if ($statusProbe.ExitCode -ne 0) { Add-Diagnostic Error 'GIT_STATUS_FAILED' 'Could not inspect the working tree.' $null; Complete-Result 20 }
    $staged = 0; $unstaged = 0; $untracked = 0
    foreach ($record in ($statusProbe.Stdout -split "`0")) {
        if ($record.Length -lt 3 -or $record[2] -ne ' ') { continue }
        $x = $record[0]; $y = $record[1]
        if ($x -eq '?' -and $y -eq '?') { $untracked++; continue }
        if ($x -ne ' ') { $staged++ }
        if ($y -ne ' ') { $unstaged++ }
    }
    $dirty = ($staged + $unstaged + $untracked) -gt 0
    $result.git = [ordered]@{
        root = $gitRoot; common_dir = $commonDir; head_state = $headState; head = $head
        branch_state = $branchState; branch = $branch; dirty = $dirty
        change_summary = [ordered]@{ staged = $staged; unstaged = $unstaged; untracked = $untracked }
    }

    if ($Mode -eq 'Probe') { Complete-Result 0 }

    $bootstrapPath = Get-FullRelativePath -RelativePath $BootstrapRelativePath
    if (-not (Test-Path -LiteralPath $bootstrapPath -PathType Leaf)) {
        $result.metadata_status = 'missing'
        Add-Diagnostic Warning 'BOOTSTRAP_MISSING' 'Project Relay Bootstrap is missing.' $BootstrapRelativePath
        Complete-Result 2
    }

    $bootstrapDocument = Read-StrictJson $bootstrapPath $MaxBootstrapBytes $BootstrapRelativePath
    try {
        $bootstrap = $bootstrapDocument.RootElement
        $bootstrapKeys = @('protocol_id','schema_version','project_id','identity_checks','state_ref','entry_refs')
        Assert-JsonObjectKeys $bootstrap $bootstrapKeys $bootstrapKeys '$bootstrap'
        if ((Get-JsonString $bootstrap 'protocol_id') -ne 'project-relay') { throw 'PROTOCOL_MISMATCH|bootstrap protocol_id must be project-relay' }
        if ($bootstrap.GetProperty('schema_version').ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or $bootstrap.GetProperty('schema_version').GetInt32() -ne 2) { throw 'UNSUPPORTED_SCHEMA|bootstrap schema_version must be 2' }
        if ((Get-JsonString $bootstrap 'project_id') -ne 'gpt-talk-enhancer') { throw 'PROJECT_ID_MISMATCH|bootstrap project_id does not match' }

        $identityChecks = $bootstrap.GetProperty('identity_checks')
        if ($identityChecks.ValueKind -ne [System.Text.Json.JsonValueKind]::Array -or $identityChecks.GetArrayLength() -lt 1) { throw 'SCHEMA_TYPE|identity_checks must be a non-empty array' }
        foreach ($check in $identityChecks.EnumerateArray()) {
            Assert-JsonObjectKeys $check @('path','json_pointer','expected') @('path','json_pointer','expected') '$bootstrap.identity_checks[]'
            $identityPath = Get-JsonString $check 'path'; $identityFullPath = Assert-RelativeFileReference $identityPath
            if ((Get-JsonString $check 'json_pointer') -ne '/name') { throw 'UNSUPPORTED_IDENTITY_CHECK|Only /name identity checks are supported in schema 2' }
            $identityDocument = Read-StrictJson $identityFullPath 1048576 $identityPath
            try {
                [System.Text.Json.JsonElement]$identityNameElement = [System.Text.Json.JsonElement]::new()
                if ($identityDocument.RootElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Object -or -not $identityDocument.RootElement.TryGetProperty('name', [ref]$identityNameElement)) { throw 'PROJECT_IDENTITY_MISMATCH|Identity file has no name property' }
                if ($identityNameElement.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $identityNameElement.GetString() -ne (Get-JsonString $check 'expected')) { throw 'PROJECT_IDENTITY_MISMATCH|Project identity check failed' }
            } finally { $identityDocument.Dispose() }
        }

        $entryRefs = $bootstrap.GetProperty('entry_refs')
        if ($entryRefs.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { throw 'SCHEMA_TYPE|entry_refs must be an object' }
        foreach ($entry in $entryRefs.EnumerateObject()) { if ($entry.Value.ValueKind -ne [System.Text.Json.JsonValueKind]::String) { throw 'SCHEMA_TYPE|entry_refs values must be strings' }; $null = Assert-RelativeFileReference $entry.Value.GetString() }

        $stateRelativePath = Get-JsonString $bootstrap 'state_ref'
        $statePath = Assert-RelativeFileReference $stateRelativePath
        $stateDocument = Read-StrictJson $statePath $MaxStateBytes $stateRelativePath
        try { Test-StateSchema $stateDocument.RootElement; $state = $stateDocument.RootElement.Clone() } finally { $stateDocument.Dispose() }
    } finally { $bootstrapDocument.Dispose() }

    $result.metadata_status = 'valid'
    if ($Mode -eq 'Validate') { Complete-Result 0 }

    $checkpoint = $state.GetProperty('checkpoint')
    $baseHead = Get-JsonString $checkpoint 'base_head'
    $carrierPaths = @($checkpoint.GetProperty('carrier_paths').EnumerateArray() | ForEach-Object { Convert-RepoPath $_.GetString() })
    $contentChanged = $false
    $observation = $state.GetProperty('observation')
    foreach ($check in $observation.GetProperty('content_checks').EnumerateArray()) {
        $relativePath = Get-JsonString $check 'path'
        $currentDigest = Get-ContentCheckDigest -Algorithm (Get-JsonString $check 'algorithm') -RelativePath $relativePath
        if (-not $currentDigest.Equals((Get-JsonString $check 'digest'), [StringComparison]::OrdinalIgnoreCase)) { $contentChanged = $true }
    }
    if ($observation.GetProperty('content_checks').GetArrayLength() -eq 0) { Add-Diagnostic Warning 'NO_CONTENT_CHECKS' 'Freshness is limited because state has no content checks.' $stateRelativePath }

    $headChanged = $false; $worktreeChanged = $contentChanged
    if ($headState -ne 'valid') {
        $headChanged = $true
        $result.checkpoint_state = 'stale'
    } elseif ($head -eq $baseHead) {
        $result.checkpoint_state = 'prepared'
        $livePaths = Get-LiveChangePaths
        if (-not (Test-PathSetEqual $livePaths $carrierPaths)) { $worktreeChanged = $true }
    } else {
        $carrier = Get-CommitCarrierInfo $head
        if ($carrier.SingleParent -and $carrier.Parent -eq $baseHead -and (Test-PathSetEqual $carrier.Paths $carrierPaths)) {
            $result.checkpoint_state = 'committed'
            if ($dirty) { $worktreeChanged = $true }
        } else {
            $result.checkpoint_state = 'stale'
            $headChanged = $true
            if ($dirty) { $worktreeChanged = $true }
        }
    }

    $result.freshness = if ($headChanged -and $worktreeChanged) { 'both_changed' } elseif ($headChanged) { 'head_changed' } elseif ($worktreeChanged) { 'worktree_changed' } else { 'matches' }
    if ($result.freshness -ne 'matches') { Add-Diagnostic Warning 'STATE_STALE' 'Saved checkpoint differs from the current repository.' $stateRelativePath; Complete-Result 2 }
    Complete-Result 0
} catch {
    $message = $_.Exception.Message
    $parts = $message -split '\|', 2
    $code = if ($parts.Count -eq 2) { $parts[0] } else { 'INTERNAL_ERROR' }
    $detail = if ($parts.Count -eq 2) { $parts[1] } else { $message }
    Add-Diagnostic Error $code $detail $null
    $result.metadata_status = if ($result.metadata_status -eq 'unassessed') { 'invalid' } else { $result.metadata_status }
    $exitCode = if ($code -in @('PROJECT_ROOT_MISSING','PROJECT_ROOT_MISMATCH','PROJECT_ID_MISMATCH','PROJECT_IDENTITY_MISMATCH')) { 11 } elseif ($code -in @('REFERENCE_OUTSIDE_PROJECT','REPARSE_POINT_NOT_ALLOWED','MISSING_REFERENCE')) { 12 } elseif ($code -like 'GIT_*') { 20 } elseif ($code -eq 'INTERNAL_ERROR') { 22 } else { 10 }
    Complete-Result $exitCode
}
