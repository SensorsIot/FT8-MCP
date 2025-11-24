# Quick Test Script for WSJT-X MCP Server
# Target System: 10.99.6.171

Write-Host "=== WSJT-X MCP Server - Quick Test ===" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Yellow
$nodeVersion = node --version
if ($nodeVersion) {
    Write-Host "✓ Node.js $nodeVersion installed" -ForegroundColor Green
} else {
    Write-Host "✗ Node.js not found. Please install Node.js 18+" -ForegroundColor Red
    exit 1
}

# Check WSJT-X
Write-Host "Checking WSJT-X..." -ForegroundColor Yellow
$wsjtxPath = "C:\WSJT\wsjtx\bin\wsjtx.exe"
if (Test-Path $wsjtxPath) {
    Write-Host "✓ WSJT-X found at $wsjtxPath" -ForegroundColor Green
} else {
    Write-Host "⚠ WSJT-X not found at default path" -ForegroundColor Yellow
    Write-Host "  Please update path in src/wsjtx/ProcessManager.ts" -ForegroundColor Yellow
}

# Check dependencies
Write-Host "Checking dependencies..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    Write-Host "✓ Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Dependencies installed successfully" -ForegroundColor Green
    } else {
        Write-Host "✗ Failed to install dependencies" -ForegroundColor Red
        exit 1
    }
}

# Build frontend
Write-Host "Building frontend..." -ForegroundColor Yellow
cd frontend
if (-not (Test-Path "dist")) {
    npm run build
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Frontend built successfully" -ForegroundColor Green
    } else {
        Write-Host "✗ Failed to build frontend" -ForegroundColor Red
        cd ..
        exit 1
    }
} else {
    Write-Host "✓ Frontend already built" -ForegroundColor Green
}
cd ..

# Display configuration
Write-Host ""
Write-Host "=== Configuration ===" -ForegroundColor Cyan
$mode = if ($env:WSJTX_MODE) { $env:WSJTX_MODE } else { "STANDARD" }
Write-Host "Operation Mode: $mode" -ForegroundColor White

if ($mode -eq "FLEX") {
    $flexHost = if ($env:FLEX_HOST) { $env:FLEX_HOST } else { "255.255.255.255" }
    Write-Host "FlexRadio Host: $flexHost" -ForegroundColor White
}

# Display URLs
Write-Host ""
Write-Host "=== Access URLs ===" -ForegroundColor Cyan
Write-Host "Web Dashboard: http://10.99.6.171:3000" -ForegroundColor White
Write-Host "Local: http://localhost:3000" -ForegroundColor White

# Start server
Write-Host ""
Write-Host "=== Starting Server ===" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

npm start
