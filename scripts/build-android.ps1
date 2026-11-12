param(
    [string]$JdkRoot = $env:JAVA_HOME,
    [string]$SdkRoot = $env:ANDROID_HOME,
    [string]$Node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source),
    [string]$OutputDirectory,
    [string]$SigningDirectory = (Join-Path $env:LOCALAPPDATA 'InfiniteFactory3-Build\signing'),
    [ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ExpectedSignerSha256,
    [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
if (-not $JdkRoot -or -not $SdkRoot) { throw '请设置 JAVA_HOME 和 ANDROID_HOME，或传入 -JdkRoot、-SdkRoot。' }
$project = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw 'package.json版本必须是数字major.minor.patch。' }
$versionCode = [int]$Matches[1] * 1000000 + [int]$Matches[2] * 1000 + [int]$Matches[3]
if ($versionCode -lt 1 -or $versionCode -gt 2100000000) { throw '安卓versionCode超出可用范围。' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $project 'dist/android' }
$project = [IO.Path]::GetFullPath($project)
$SigningDirectory = [IO.Path]::GetFullPath($SigningDirectory)
if ($SigningDirectory.StartsWith($project + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '签名私钥目录必须在项目外。' }
$buildTools = Join-Path $SdkRoot 'build-tools\36.0.0'
$androidJar = Join-Path $SdkRoot 'platforms\android-36\android.jar'
$java = Join-Path $JdkRoot 'bin\java.exe'
$javac = Join-Path $JdkRoot 'bin\javac.exe'
$jar = Join-Path $JdkRoot 'bin\jar.exe'
$keytool = Join-Path $JdkRoot 'bin\keytool.exe'
$aapt = Join-Path $buildTools 'aapt2.exe'
$zipalign = Join-Path $buildTools 'zipalign.exe'
$d8 = Join-Path $buildTools 'lib\d8.jar'
$lambdaStubs = Join-Path $buildTools 'core-lambda-stubs.jar'
$signer = Join-Path $buildTools 'lib\apksigner.jar'
foreach ($path in @($java,$javac,$jar,$keytool,$Node,$aapt,$zipalign,$d8,$signer,$androidJar,$lambdaStubs)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "缺少构建工具：$path" } }
function Run-Tool([string]$Exe, [string[]]$Arguments) {
    # SDK的Windows原生工具不接受中文绝对路径；使用临时工作目录，参数使用相对路径。
    $nativeSdk = [IO.Path]::GetFileName($Exe) -in @('aapt2.exe','zipalign.exe','javac.exe')
    if ($nativeSdk) { Push-Location -LiteralPath $build }
    try { & $Exe @Arguments; if ($LASTEXITCODE -ne 0) { throw "构建命令失败：$([IO.Path]::GetFileName($Exe)) ($LASTEXITCODE)" } }
    finally { if ($nativeSdk) { Pop-Location } }
}
if (-not $SkipWebBuild) { Run-Tool $Node @((Join-Path $project 'scripts\build-web.mjs')) }
$web = Join-Path $project '.build\web'
if (-not (Test-Path -LiteralPath (Join-Path $web 'index.html'))) { throw '缺少正式前端，请先构建。' }
$build = Join-Path ([IO.Path]::GetTempPath()) ('wxgc3-android-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
foreach ($folder in @($build,(Join-Path $build 'assets'),(Join-Path $build 'res\drawable'),(Join-Path $build 'generated'),(Join-Path $build 'classes'),(Join-Path $build 'dex'),$OutputDirectory)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
Copy-Item -LiteralPath $web -Destination (Join-Path $build 'assets\web') -Recurse
Copy-Item -LiteralPath (Join-Path $project 'platforms\android\res\xml') -Destination (Join-Path $build 'res\xml') -Recurse
Copy-Item -LiteralPath (Join-Path $project 'assets\app-icon.png') -Destination (Join-Path $build 'res\drawable\app_icon.png')
Copy-Item -LiteralPath (Join-Path $project 'platforms\android\AndroidManifest.xml') -Destination (Join-Path $build 'AndroidManifest.xml')
[xml]$manifest = Get-Content -LiteralPath (Join-Path $build 'AndroidManifest.xml') -Raw
$applicationId = $manifest.DocumentElement.GetAttribute('package')
[void]$manifest.DocumentElement.SetAttribute('versionName','http://schemas.android.com/apk/res/android',$version)
[void]$manifest.DocumentElement.SetAttribute('versionCode','http://schemas.android.com/apk/res/android',[string]$versionCode)
$manifest.Save((Join-Path $build 'AndroidManifest.xml'))
Copy-Item -LiteralPath (Join-Path $project 'platforms\android\src') -Destination (Join-Path $build 'src') -Recurse
$catalogScript = @'
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
const c=await import(pathToFileURL(process.argv[1]).href);
const p=await import(new URL('../ai/prompt.js',pathToFileURL(process.argv[1])).href);
fs.writeFileSync(process.argv[2],JSON.stringify({bases:c.BASE_CARDS,categories:c.CATEGORIES,limits:c.CARD_LIMITS,preferences:c.DEFAULT_PREFERENCES,appearance:c.APPEARANCE_IDS,ai:c.DEFAULT_AI_CONFIG,prompt:{default:p.DEFAULT_SYNTHESIS_PROMPT,outputRules:p.SYNTHESIS_OUTPUT_RULES,limit:p.SYNTHESIS_PROMPT_LIMIT}}));
'@
Run-Tool $Node @('--input-type=module','-e',$catalogScript,(Join-Path $project 'src\content\catalog.js'),(Join-Path $build 'assets\native-catalog.json'))
Run-Tool $aapt @('compile','--dir','res','-o','resources.zip')
Run-Tool $aapt @('link','-I',$androidJar,'--manifest','AndroidManifest.xml','--java','generated','--min-sdk-version','26','--target-sdk-version','36','-o','unsigned.apk','resources.zip')
$sources = @(Get-ChildItem -LiteralPath (Join-Path $build 'src'),(Join-Path $build 'generated') -Recurse -File -Filter '*.java' | ForEach-Object { '"' + [IO.Path]::GetRelativePath($build,$_.FullName).Replace('\','/') + '"' })
$sourceList = Join-Path $build 'sources.txt'
[IO.File]::WriteAllLines($sourceList,$sources,[Text.UTF8Encoding]::new($false))
Run-Tool $javac @('-encoding','UTF-8','-source','8','-target','8','-bootclasspath',($androidJar+';'+$lambdaStubs),'-d','classes','@sources.txt')
Run-Tool $jar @('--create','--file',(Join-Path $build 'classes.jar'),'-C',(Join-Path $build 'classes'),'.')
Run-Tool $java @('-cp',$d8,'com.android.tools.r8.D8','--lib',$androidJar,'--min-api','26','--output',(Join-Path $build 'dex'),(Join-Path $build 'classes.jar'))
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open((Join-Path $build 'unsigned.apk'),[IO.Compression.ZipArchiveMode]::Update)
try {
    foreach ($dexFile in Get-ChildItem -LiteralPath (Join-Path $build 'dex') -Filter '*.dex' -File) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$dexFile.FullName,$dexFile.Name,[IO.Compression.CompressionLevel]::Optimal) | Out-Null }
    # SDK36 Windows aapt2的-A会把嵌套路径写成反斜杠；显式以ZIP标准正斜杠归档，AssetManager才能找到页面。
    foreach ($assetFile in Get-ChildItem -LiteralPath (Join-Path $build 'assets') -Recurse -File) {
        $entryName = 'assets/' + [IO.Path]::GetRelativePath((Join-Path $build 'assets'),$assetFile.FullName).Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$assetFile.FullName,$entryName,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $zip.Dispose() }
Run-Tool $zipalign @('-p','-f','4','unsigned.apk','aligned.apk')

# 签名文件置于工程外，密码通过文件传给签名工具。
New-Item -ItemType Directory -Path $SigningDirectory -Force | Out-Null
$acl = Get-Acl -LiteralPath $SigningDirectory
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$allowedSids = @($owner.Value,'S-1-5-18')
$extraRules = @($acl.Access | Where-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowedSids -or $_.AccessControlType -ne 'Allow' })
if (-not $acl.AreAccessRulesProtected -or $extraRules.Count -gt 0) {
    $acl = [IO.FileSystemAclExtensions]::GetAccessControl([IO.DirectoryInfo]::new($SigningDirectory),[Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
    $propagate = [Security.AccessControl.PropagationFlags]::None
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner,'FullControl',$inherit,$propagate,'Allow'))
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-18'),'FullControl',$inherit,$propagate,'Allow'))
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($SigningDirectory),$acl)
}
$keystore = Join-Path $SigningDirectory 'wxgc3-candidate.p12'
$passwordFile = Join-Path $SigningDirectory 'keystore-password.txt'
if (-not (Test-Path -LiteralPath $keystore)) {
    # 指定旧证书时，缺失私钥不能默默变成一次新签名。
    if ($ExpectedSignerSha256) { throw '未找到原签名，请指定原签名目录。' }
    if (-not (Test-Path -LiteralPath $passwordFile)) { $random=[byte[]]::new(32);[Security.Cryptography.RandomNumberGenerator]::Fill($random);[IO.File]::WriteAllText($passwordFile,[Convert]::ToHexString($random),[Text.UTF8Encoding]::new($false));[Array]::Clear($random,0,$random.Length) }
    Run-Tool $keytool @('-genkeypair','-noprompt','-keystore',$keystore,'-storetype','PKCS12','-storepass:file',$passwordFile,'-keypass:file',$passwordFile,'-alias','wxgc3-candidate','-keyalg','RSA','-keysize','3072','-validity','3650','-dname','CN=Infinite Factory 3 Local Build')
}
if (-not (Test-Path -LiteralPath $passwordFile)) { throw '现有签名缺少密码文件，停止而不替换签名。' }
$apk = Join-Path $OutputDirectory ('无限工厂3-'+$version+'-Android.apk')
Run-Tool $java @('-jar',$signer,'sign','--ks',$keystore,'--ks-key-alias','wxgc3-candidate','--ks-pass',('file:'+$passwordFile),'--out',(Join-Path $build 'signed.apk'),(Join-Path $build 'aligned.apk'))
Run-Tool $zipalign @('-c','4','signed.apk')
$verify = & $java '-jar' $signer 'verify' '--verbose' '--print-certs' (Join-Path $build 'signed.apk')
if ($LASTEXITCODE -ne 0) { throw 'APK签名验证失败。' }
if ($ExpectedSignerSha256 -and -not ($verify -contains "Signer #1 certificate SHA-256 digest: $($ExpectedSignerSha256.ToLowerInvariant())")) { throw '签名与此前发布的 APK 不一致，已停止交付。' }
Copy-Item -LiteralPath (Join-Path $build 'signed.apk') -Destination $apk
$packaged = [IO.Compression.ZipFile]::OpenRead($apk)
$webFiles = @(Get-ChildItem -LiteralPath $web -Recurse -File)
$assetFiles = @(Get-ChildItem -LiteralPath (Join-Path $build 'assets') -Recurse -File)
try {
    if (@($packaged.Entries | Where-Object { $_.FullName.Contains('\') }).Count -gt 0) { throw 'APK包含错误的路径分隔符。' }
    foreach ($webFile in $webFiles) {
        $entryName = 'assets/web/' + [IO.Path]::GetRelativePath($web,$webFile.FullName).Replace('\','/')
        $entry = $packaged.GetEntry($entryName)
        if (-not $entry) { throw "APK缺少前端文件：$entryName" }
        $stream = $entry.Open()
        try { $packedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
        if ($packedHash -ne (Get-FileHash -LiteralPath $webFile.FullName -Algorithm SHA256).Hash) { throw "APK前端文件不一致：$entryName" }
    }
    foreach ($assetFile in $assetFiles) {
        $entryName = 'assets/' + [IO.Path]::GetRelativePath((Join-Path $build 'assets'),$assetFile.FullName).Replace('\','/')
        $entry = $packaged.GetEntry($entryName)
        if (-not $entry) { throw "APK缺少资源文件：$entryName" }
        $stream = $entry.Open()
        try { $packedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
        if ($packedHash -ne (Get-FileHash -LiteralPath $assetFile.FullName -Algorithm SHA256).Hash) { throw "APK资源文件不一致：$entryName" }
    }
    if (-not $packaged.GetEntry('res/drawable/app_icon.png') -or -not $packaged.GetEntry('resources.arsc')) { throw 'APK缺少应用图标或资源表。' }
    if (@($packaged.Entries.FullName | Where-Object { $_ -match 'tests/|development|\.p12$|password|\.jks$|\.env$' }).Count -gt 0) { throw 'APK混入开发或私密文件。' }
} finally { $packaged.Dispose() }
$verify | Set-Content -LiteralPath (Join-Path $OutputDirectory ([IO.Path]::GetFileNameWithoutExtension($apk)+'.signature.txt')) -Encoding utf8
$hash=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output "APK: $apk"
Write-Output "SHA256: $hash"
