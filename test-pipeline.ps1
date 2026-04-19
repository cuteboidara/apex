# APEX V2 — AMT TESTING PIPELINE (PowerShell Windows)
# Run: ./test-pipeline.ps1 backtest|paper|live|report

param(
    [Parameter(Position = 0)]
    [string]$Action = "menu"
)

$ProjectRoot = "C:\Users\daram\apex"
$LogsDir = "$ProjectRoot\logs"
$ResultsDir = "$ProjectRoot\test-results"

# Create directories
@($LogsDir, $ResultsDir) | ForEach-Object {
    if (-not (Test-Path $_)) { New-Item -ItemType Directory -Path $_ -Force | Out-Null }
}

function Write-Info { param([string]$Message); Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" -ForegroundColor Blue }
function Write-Success { param([string]$Message); Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ✓ $Message" -ForegroundColor Green }
function Write-ErrorMsg { param([string]$Message); Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ✗ $Message" -ForegroundColor Red }

function Invoke-Backtest {
    Write-Info "═══════════════════════════════════════════════════════════"
    Write-Info "PHASE 1: BACKTEST (2024-01-01 to 2024-12-31)"
    Write-Info "═══════════════════════════════════════════════════════════"
    
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $BacktestLog = "$LogsDir\backtest-$timestamp.log"
    
    Write-Info "Backtest log: $BacktestLog"
    Write-Info "Running: npm run backtest"
    Write-Info ""
    
    Push-Location $ProjectRoot
    
    $env:BACKTEST_START_DATE = "2024-01-01"
    $env:BACKTEST_END_DATE = "2024-12-31"
    $env:RESULTS_DIR = $ResultsDir
    
    try {
        npm run backtest 2>&1 | Tee-Object -FilePath $BacktestLog
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Backtest complete!"
            Write-Info "Log: $BacktestLog"
        } else {
            Write-ErrorMsg "Backtest failed. Check log."
        }
    } finally {
        Pop-Location
    }
}

# Check npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-ErrorMsg "npm not found. Install Node.js first."
    exit 1
}

Write-Info "APEX V2 — Auction Market Theory Trading System"
Write-Info "Project: $ProjectRoot"
Write-Info ""

switch ($Action.ToLower()) {
    "backtest" { Invoke-Backtest }
    default { 
        Write-Info "Usage: ./test-pipeline.ps1 backtest"
        Write-Info "Running backtest now..."
        Invoke-Backtest
    }
}
