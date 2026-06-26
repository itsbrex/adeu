# FILE: scripts/setup-hooks.ps1
$ErrorActionPreference = 'Stop'

# Find the repository root
$RepoRoot = git rev-parse --show-toplevel
if (-not $RepoRoot) {
    Write-Error "Failed to find git repository root. Are you running this inside the repository?"
    exit 1
}

# Navigate to the root to ensure the config applies to the correct repository
Set-Location $RepoRoot

# Point git to the version-controlled hooks directory
git config core.hooksPath .githooks

Write-Host "[OK] git hooks enabled (core.hooksPath = .githooks)" -ForegroundColor Green
Write-Host "     Staged code will now be auto-formatted and checked on commit."