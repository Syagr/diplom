# AutoAssist+ attachment smoke test (PowerShell)
$ErrorActionPreference = 'Stop'

function Write-Ok($m) { Write-Host "[OK] $m" }
function Extract-ETag([string]$text) {
  if (-not $text) { return $null }
  foreach ($l in ($text -split "`r?`n")) {
    if ($l.TrimStart().ToLower().StartsWith('etag:')) {
      return ($l.Split(':',2)[1]).Trim()
    }
  }
  return $null
}

# 0) Health
try {
  $health = Invoke-RestMethod http://127.0.0.1:3000/healthz -ErrorAction Stop
} catch {
  Write-Host "ERROR: cannot reach API /healthz: $_"; exit 1
}
if (-not $health.ok) { Write-Host "ERROR: API health not OK"; exit 1 }
Write-Ok "API /healthz"

# 1) Login (пытаемся /api/auth/login и /auth/login)
$body    = @{ email='admin@example.com'; password='admin123' } | ConvertTo-Json
$headers = @{ 'Content-Type' = 'application/json' }
$auth = $null; $apiBase = $null
foreach ($base in @('http://127.0.0.1:3000/api','http://127.0.0.1:3000')) {
  try {
    $auth = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -Headers $headers -Body $body -ErrorAction Stop
    if ($auth) { $apiBase = $base; break }
  } catch {}
}
if (-not $auth) { Write-Host "ERROR: login failed"; exit 2 }

# токен может называться accessToken / token / access
$token = $auth.accessToken; if (-not $token) { $token = $auth.token }
if (-not $token) { $token = $auth.access }
if (-not $token) {
  Write-Host "ERROR: login response has no token: $(($auth | ConvertTo-Json -Depth 6))"
  exit 2
}
$authz = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
Write-Ok "Login (base=$apiBase)"

# 2) Presign
# Note: schema expects orderId, fileName, contentType from AllowedContentTypes, size, and optional kind
# Use a safe allowed contentType (application/pdf) and a sample orderId=1
$req = @{ orderId = 1; fileName = 'test.txt'; contentType = 'application/pdf'; size = 16; kind = 'doc' } | ConvertTo-Json
$presign = $null
foreach ($p in @('/attachments/presign-upload','/api/attachments/presign-upload')) {
  try {
    $presign = Invoke-RestMethod -Uri ("http://127.0.0.1:3000" + $p) -Method Post -Headers $authz -Body $req -ErrorAction Stop
    if ($presign) { break }
  } catch {}
}
if (-not $presign) { Write-Host "ERROR: presign-upload failed"; exit 3 }
Write-Ok ("Presign -> " + $presign.url)

# 3) Тестовый файл
$tempFile = Join-Path $env:TEMP 'aa-test.txt'
Set-Content -Path $tempFile -Value 'hello autoassist!' -NoNewline
Write-Host "File: $tempFile"

# 4) Upload
# Support two presign shapes:
# - object with putUrl (presigned PUT) -> perform PUT upload
# - object with url + fields (form POST) -> perform form upload (legacy)
$etag = $null
if ($presign.putUrl) {
  Write-Host "Uploading (PUT) to: $($presign.putUrl)"
  # Host PUT
  $resp = & curl.exe -s -i -X PUT -H "Content-Type: $($presign.contentType)" --data-binary "@$tempFile" "$($presign.putUrl)"
  if (-not $resp) { Write-Host "ERROR: curl PUT upload failed"; exit 4 }
  $etag = Extract-ETag $resp
  Write-Ok ("Upload (PUT) ETag=" + $etag)
} elseif ($presign.url -and $presign.fields) {
  if ($presign.url -match '127\.0\.0\.1|localhost|12002') {
    # Host form upload
    $curlArgs = @()
    $presign.fields.PSObject.Properties | ForEach-Object { $curlArgs += '-F'; $curlArgs += ('{0}={1}' -f $_.Name,$_.Value) }
    $curlArgs += '-F'; $curlArgs += "file=@$tempFile"
    Write-Host "Uploading (host, form) to: $($presign.url)"
    $resp = & curl.exe -s -i $presign.url @curlArgs
    if (-not $resp) { Write-Host "ERROR: curl upload failed (host)"; exit 4 }
    $etag = Extract-ETag $resp
    Write-Ok ("Upload (host) ETag=" + $etag)
  } else {
    # docker form upload
    $hostCopy = Join-Path 'C:\IT\projects\diplom\autoassist\infra\compose' 'aa-test.txt'
    Copy-Item $tempFile $hostCopy -Force
    $fieldsArgs = @()
    $presign.fields.PSObject.Properties | ForEach-Object { $fieldsArgs += '-F'; $fieldsArgs += ('{0}={1}' -f $_.Name,$_.Value) }
    $fieldsString = ($fieldsArgs -join ' ')
    $cmd = "curl -s -i '$($presign.url)' $fieldsString -F 'file=@/tmp/aa-test.txt'"
    $dockerArgs = @(
      'run','--rm','--network','compose_autoassist-network',
      '-v', "${hostCopy}:/tmp/aa-test.txt",
      'curlimages/curl:8.10.1','sh','-lc', $cmd
    )
    $resp = & docker @dockerArgs
    if (-not $resp) { Write-Host 'ERROR: curl upload failed (docker)'; exit 5 }
    $etag = Extract-ETag $resp
    Write-Ok ("Upload (docker) ETag=" + $etag)
  }
} else {
  Write-Host 'ERROR: unknown presign response shape' ; Write-Host (ConvertTo-Json $presign -Depth 6) ; exit 4
}
if (-not $etag) { Write-Warning 'ETag not found — continuing without it'; $etag = '""' }

# 5) Complete
$attachmentId = $presign.attachmentId
if (-not $attachmentId) { $attachmentId = $presign.id }
if (-not $attachmentId) { Write-Host "ERROR: presign response missing id (neither 'attachmentId' nor 'id' present)"; exit 6 }
$completeBody = @{ etag = $etag } | ConvertTo-Json
$complete = $null
foreach ($path in @("/attachments/$attachmentId/complete","/api/attachments/$attachmentId/complete")) {
  try {
    $complete = Invoke-RestMethod -Uri ("http://127.0.0.1:3000" + $path) -Method Post -Headers $authz -Body $completeBody -ErrorAction Stop
    if ($complete) { break }
  } catch {}
}
if (-not $complete) { Write-Host 'ERROR: complete failed'; exit 7 }
Write-Ok 'Complete'

# 6) MinIO — список в бакете
$ls = & docker run --rm --network compose_autoassist-network --entrypoint sh minio/mc -c "/usr/bin/mc alias set myminio http://minio:9000 minioadmin minioadmin123 && /usr/bin/mc ls myminio/attachments || true"
Write-Host 'MinIO ls:'; Write-Host $ls
Write-Host "`n=== DONE ==="
Write-Host 'Open MinIO UI:  http://localhost:12003   (minioadmin / minioadmin123)'
