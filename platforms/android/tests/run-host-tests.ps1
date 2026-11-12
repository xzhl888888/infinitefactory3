param(
  [string]$JdkRoot=$env:JAVA_HOME,
  [string]$SdkRoot=$env:ANDROID_HOME,
  [string]$Node=(Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source)
)
$ErrorActionPreference='Stop'
if (-not $JdkRoot -or -not $SdkRoot) { throw '请设置 JAVA_HOME 和 ANDROID_HOME，或传入 -JdkRoot、-SdkRoot。' }
$run=Join-Path ([IO.Path]::GetTempPath()) ('wxgc3-android-host-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $run -Force | Out-Null
$cache=Join-Path ([IO.Path]::GetTempPath()) 'wxgc3-android-test-dependencies'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
$jsonJar=Join-Path $cache 'json-20250517.jar'
if(-not(Test-Path -LiteralPath $jsonJar)){Invoke-WebRequest -Uri 'https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar' -OutFile $jsonJar}
if((Get-FileHash -LiteralPath $jsonJar -Algorithm SHA256).Hash -ne '3EA61B2A06E31EDF1C91134FE9106B0EBB16628BE169F3DB75BC7A2B06B45796'){throw '测试JSON依赖哈希不符。'}
Copy-Item -LiteralPath $jsonJar -Destination (Join-Path $run 'json.jar')
$source=Join-Path (Split-Path -Parent $PSScriptRoot) 'src\com\geometryworkshop\wxgc3'
foreach($file in @('SaveCodec.java','Fault.java','AiClient.java','PrivateFiles.java','ModCodec.java','GameLibrary.java','GameStore.java','SlotStorage.java')){Copy-Item -LiteralPath (Join-Path $source $file) -Destination $run}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ContractTests.java'),(Join-Path $PSScriptRoot 'NetworkTests.java'),(Join-Path $PSScriptRoot 'LibraryTests.java') -Destination $run
function Run([string]$program,[string[]]$arguments){& $program @arguments;if($LASTEXITCODE -ne 0){throw "主机验证失败：$([IO.Path]::GetFileName($program))"}}
$server=$null
Push-Location -LiteralPath $run
try{
  Run $Node @((Join-Path $PSScriptRoot 'contracts.mjs'),'prepare',$run)
  Run (Join-Path $JdkRoot 'bin\javac.exe') @('-encoding','UTF-8','-cp',('json.jar;'+(Join-Path $SdkRoot 'platforms\android-36\android.jar')),'-d','classes','SaveCodec.java','Fault.java','AiClient.java','PrivateFiles.java','ModCodec.java','SlotStorage.java','GameStore.java','GameLibrary.java','ContractTests.java','NetworkTests.java','LibraryTests.java')
  Run (Join-Path $JdkRoot 'bin\java.exe') @('-cp','classes;json.jar','com.geometryworkshop.wxgc3.ContractTests','.')
  Run $Node @((Join-Path $PSScriptRoot 'contracts.mjs'),'verify',$run)
  Run (Join-Path $JdkRoot 'bin\java.exe') @('-cp','classes;json.jar','com.geometryworkshop.wxgc3.LibraryTests','.')
  # 仅用于回环网络测试时现场生成的临时证书。
  Run (Join-Path $JdkRoot 'bin\keytool.exe') @('-genkeypair','-noprompt','-keystore','localhost.p12','-storetype','PKCS12','-storepass','wxgc3-fixture-only','-keypass','wxgc3-fixture-only','-alias','local-fixture','-keyalg','RSA','-keysize','2048','-validity','1','-dname','CN=127.0.0.1','-ext','SAN=IP:127.0.0.1')
  $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$Node;$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.WindowStyle='Hidden';$start.WorkingDirectory=$run;$start.ArgumentList.Add((Join-Path $PSScriptRoot 'https-fixture.mjs'));$start.ArgumentList.Add($run)
  $server=[Diagnostics.Process]::Start($start)
  $deadline=[DateTime]::UtcNow.AddSeconds(10)
  while(-not(Test-Path -LiteralPath (Join-Path $run 'network-port.txt'))){if($server.HasExited -or [DateTime]::UtcNow -gt $deadline){throw '本机HTTPS测试服务未能启动。'};Start-Sleep -Milliseconds 100}
  Run (Join-Path $JdkRoot 'bin\java.exe') @('-cp','classes;json.jar','com.geometryworkshop.wxgc3.NetworkTests','.')
  Write-Output "HOST_TEST_EVIDENCE: $run"
}finally{if($server -and -not $server.HasExited){$server.Kill();$server.WaitForExit()};if($server){$server.Dispose()};Pop-Location}
