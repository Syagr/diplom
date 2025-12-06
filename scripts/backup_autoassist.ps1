Param(
    [string]$ComposeFile = "c:/IT/projects/diplom/autoassist/infra/compose/docker-compose.yml",
    [string]$BackupRoot = "C:\IT\projects"
)

$now = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $BackupRoot "autoassist_backup_$now"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

Write-Output "Backup directory: $backupDir"

# Stop compose services to ensure consistency for volume tar backups
Write-Output "Stopping compose services (if running)..."
docker compose -f $ComposeFile stop

# Collect candidate volumes to back up
$allVolumes = docker volume ls --format "{{.Name}}"
$volumes = $allVolumes | Where-Object { $_ -match 'postgres|pgdata|pg_data|db|redis|minio|minio_data|data' } | Sort-Object -Unique

if (-not $volumes) {
    Write-Output "No matching volumes found. Listing all volumes instead."
    $volumes = $allVolumes
}

foreach ($v in $volumes) {
    Write-Output "Backing up volume: $v"
    docker run --rm -v ${v}:/volume -v ${backupDir}:/backup busybox sh -c "tar czf /backup/${v}_$($now).tar.gz -C /volume ."
}

# Save images used by compose
Write-Output "Collecting containers from compose and saving their images..."
$containerIds = docker compose -f $ComposeFile ps -q 2>$null
$images = @()
foreach ($cid in $containerIds) {
    if ($cid) {
        $img = docker inspect --format='{{.Config.Image}}' $cid
        if ($img) { $images += $img }
    }
}
$images = $images | Sort-Object -Unique

foreach ($img in $images) {
    $safeName = ($img -replace '[/:]', '_') + "_$($now).tar"
    $outPath = Join-Path $backupDir $safeName
    Write-Output "Saving image $img -> $outPath"
    docker save -o $outPath $img
}

# Copy compose file and nearby env files
Write-Output "Copying compose and env files..."
Copy-Item -Path $ComposeFile -Destination $backupDir -Force
$composeDir = Split-Path $ComposeFile
Get-ChildItem -Path $composeDir -Filter "*.env*" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName -Destination $backupDir -Force
}

# Attempt to snapshot Redis RDB if redis container exists
$redisCid = docker ps --filter "ancestor=redis" --format "{{.Names}}" | Select-Object -First 1
if (-not $redisCid) { $redisCid = docker ps --format "{{.Names}}" | Where-Object { $_ -match 'redis' } | Select-Object -First 1 }
if ($redisCid) {
    Write-Output "Triggering Redis BGSAVE on container $redisCid"
    docker exec $redisCid redis-cli BGSAVE 2>$null
    Start-Sleep -Seconds 3
    # try to copy dump.rdb from common locations
    $redisPaths = @('/data/dump.rdb','/var/lib/redis/dump.rdb')
    foreach ($p in $redisPaths) {
        $exists = docker exec $redisCid sh -c "[ -f $p ] && echo yes || echo no" 2>$null
        if ($exists -and $exists.Trim() -eq 'yes') {
            $dest = Join-Path $backupDir "redis_dump_$now.rdb"
            docker cp "$($redisCid):$p" $dest
            Write-Output "Copied Redis RDB -> $dest"
            break
        }
    }
}

# Attempt to copy MinIO data (if volume exists, it was tared above). Also attempt mc mirror if mc available
$mcExists = $false
try {
    $mcOut = docker run --rm --entrypoint mc minio/mc --version 2>$null
    if ($mcOut) { $mcExists = $true }
} catch { }
if ($mcExists) {
    Write-Output "mc available in container runtime; skipping mc mirror by default. (MinIO volume already archived if present)"
}

# Start compose services again
Write-Output "Starting compose services back up..."
docker compose -f $ComposeFile start

Write-Output "Backup completed: $backupDir"
Write-Output "Contents:"
Get-ChildItem -Path $backupDir | Select-Object Name,Length | Format-Table -AutoSize

# Exit
exit 0
