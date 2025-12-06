Param(
    [string]$BackupDir = "",
    [string]$ComposeFile = "c:/IT/projects/diplom/autoassist/infra/compose/docker-compose.yml",
    [switch]$RestoreVolumes,
    [switch]$LoadImages,
    [switch]$RestoreRedis,
    [switch]$PgLogicalRestore
)

function Prompt-Confirm([string]$msg) {
    $r = Read-Host "$msg [y/N]"
    return $r -match '^[yY]'
}

if (-not $BackupDir -or -not (Test-Path $BackupDir)) {
    # pick latest backup dir
    $parent = Split-Path $ComposeFile -Parent
    $searchRoot = 'C:\IT\projects'
    $latest = Get-ChildItem -Path $searchRoot -Directory -Filter 'autoassist_backup_*' | Sort-Object Name -Descending | Select-Object -First 1
    if ($latest) { $BackupDir = $latest.FullName }
    else { Write-Error "No backup directory provided and no autoassist_backup_* found under $searchRoot."; exit 1 }
}

Write-Output "Using backup directory: $BackupDir"

# Confirm destructive actions
if (-not (Prompt-Confirm "This operation may overwrite existing Docker volumes and images. Continue?")) { Write-Output "Aborted by user."; exit 0 }

# Stop compose to avoid conflicts
Write-Output "Stopping compose services..."
docker compose -f $ComposeFile down

# Restore docker images
if ($LoadImages) {
    Write-Output "Loading docker images from backup..."
    Get-ChildItem -Path $BackupDir -Filter '*.tar' -File | ForEach-Object {
        Write-Output "Loading image: $($_.FullName)"
        docker load -i "$($_.FullName)"
    }
}

# Restore volumes from tar.gz files
if ($RestoreVolumes) {
    Write-Output "Restoring docker volumes from archive files..."
    $tarFiles = Get-ChildItem -Path $BackupDir -Filter '*_*.tar.gz' -File
    foreach ($f in $tarFiles) {
        # derive volume name from filename (strip timestamp suffix)
        $base = $f.BaseName -replace '_\d{8}_\d{6}$',''
        $volName = $base
        Write-Output "About to restore $($f.Name) into volume '$volName'"
        if (-not (docker volume ls --format '{{.Name}}' | Select-String -Pattern "^$volName$")) {
            Write-Output "Volume '$volName' does not exist. Creating..."
            docker volume create $volName | Out-Null
        }
        if (Prompt-Confirm "Overwrite contents of volume '$volName' from $($f.Name)? This will delete existing data." ) {
            docker run --rm -v ${volName}:/volume -v ${BackupDir}:/backup busybox sh -c "tar xzf /backup/$($f.Name) -C /volume"
            Write-Output "Restored $($f.Name) -> volume $volName"
        } else { Write-Output "Skipped $($f.Name)" }
    }
}

# Restore Redis RDB if present
if ($RestoreRedis) {
    $rdb = Get-ChildItem -Path $BackupDir -Filter 'redis_dump_*.rdb' -File | Select-Object -First 1
    if ($rdb) {
        $redisName = (docker ps --format '{{.Names}}' | Where-Object { $_ -match 'redis' } | Select-Object -First 1)
        if (-not $redisName) { Write-Error "Redis container not found. Ensure a redis container is available in compose." }
        else {
            Write-Output "Stopping redis container: $redisName"
            docker stop $redisName
            Write-Output "Copying RDB file into redis container and starting..."
            docker cp "$($rdb.FullName)" "$($redisName):/data/dump.rdb"
            docker start $redisName
            Write-Output "Redis restored from $($rdb.Name)"
        }
    } else { Write-Output "No redis_dump_*.rdb found in backup." }
}

# Optional logical pg_restore path: find .dump files and restore into DB
if ($PgLogicalRestore) {
    $dump = Get-ChildItem -Path $BackupDir -Filter 'autoassist_*.dump' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $dump) { Write-Output "No logical dump file found (autoassist_*.dump). Skipping pg_restore." }
    else {
        Write-Output "Found dump: $($dump.FullName)"
        # ask user for target container and DB credentials
        $pgContainer = Read-Host "Postgres container name to restore into (example: compose-db-1)"
        if (-not $pgContainer) { Write-Error "No container name provided. Aborting pg_restore step." }
        else {
            $dbName = Read-Host "Target database name (example: autoassist_db)"
            $dbUser = Read-Host "DB user (example: postgres)"
            $dbPass = Read-Host "DB password (will be used for restore)" -AsSecureString
            $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPass)
            $plainPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)

            # copy dump into container
            docker cp "$($dump.FullName)" "$pgContainer:/tmp/restore.dump"
            Write-Output "Running pg_restore inside container (will restore into $dbName)"
            docker exec -e PGPASSWORD=$plainPass $pgContainer pg_restore -U $dbUser -d $dbName -v /tmp/restore.dump
            # clear password from memory variables
            $plainPass = $null
            [System.GC]::Collect()
            Write-Output "pg_restore finished (check logs)."
        }
    }
}

# Copy back compose/env files (non-destructive)
Write-Output "Copying docker-compose and env files from backup to compose directory (no overwrite of existing files without prompt)."
$composeDir = Split-Path $ComposeFile
Get-ChildItem -Path $BackupDir -Include 'docker-compose.yml','*.env*' -File | ForEach-Object {
    $dest = Join-Path $composeDir $_.Name
    if (Test-Path $dest) {
        if (Prompt-Confirm "File $dest exists. Overwrite from backup?" ) { Copy-Item -Path $_.FullName -Destination $dest -Force }
        else { Write-Output "Skipped overwriting $dest" }
    } else { Copy-Item -Path $_.FullName -Destination $dest }
}

Write-Output "Bringing compose services up..."
docker compose -f $ComposeFile up -d

Write-Output "Restore complete. Verify services and data manually (logs, database content)."

exit 0
