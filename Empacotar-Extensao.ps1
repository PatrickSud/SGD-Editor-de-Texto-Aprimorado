param(
    [Parameter(Mandatory = $true)][string]$SrcDir,
    [string]$OutDir = "C:\Claude\Versões"
)

$ErrorActionPreference = 'Stop'

try {
    $manifestPath = Join-Path $SrcDir 'manifest.json'
    if (-not (Test-Path $manifestPath)) {
        throw "manifest.json nao encontrado em $SrcDir"
    }

    Write-Host "Lendo versao do manifest.json..." -ForegroundColor Cyan
    $manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
    $version = $manifest.version
    if ([string]::IsNullOrWhiteSpace($version)) {
        throw "Campo 'version' nao encontrado ou vazio no manifest.json"
    }
    Write-Host "Versao detectada: $version" -ForegroundColor Green

    if (-not (Test-Path $OutDir)) {
        New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    }

    $zipName = "Versão $version.zip"
    $zipPath = Join-Path $OutDir $zipName

    if (Test-Path $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    Write-Host "Copiando arquivos (ignorando itens de desenvolvimento)..." -ForegroundColor Cyan

    $exclude = @(
        '.git', '.github', '.vscode', '.cursor', 'node_modules',
        'README.md', 'CODING_STYLE_RULES.md',
        'rename-project.js', 'rename-iagente-to-plug.js', 'rename-plug-to-iaplug.js',
        'gist-forms-config-correct.json', '.gitignore', '.git-credentials',
        'Thumbs.db', 'desktop.ini',
        'Empacotar-Extensao.bat', 'Empacotar-Extensao.ps1'
    )

    $tempDir = Join-Path $env:TEMP ("sgd_pkg_" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tempDir | Out-Null

    Get-ChildItem -LiteralPath $SrcDir -Force |
        Where-Object { $exclude -notcontains $_.Name } |
        Copy-Item -Destination $tempDir -Recurse -Force

    Write-Host "Compactando..." -ForegroundColor Cyan
    Compress-Archive -Path (Join-Path $tempDir '*') -DestinationPath $zipPath -Force

    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue

    if (-not (Test-Path $zipPath)) {
        throw "O arquivo zip nao foi criado em $zipPath"
    }

    Write-Host ""
    Write-Host "Pacote criado com sucesso:" -ForegroundColor Green
    Write-Host $zipPath -ForegroundColor Green
    exit 0
}
catch {
    Write-Host ""
    Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
