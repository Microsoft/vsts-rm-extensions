Write-Verbose "Entering script AppCmdOnTargetMachines.ps1"
$AppCmdRegKey = "HKLM:\SOFTWARE\Microsoft\InetStp"

function Get-AppCmdLocation
{
    param(
        [string][Parameter(Mandatory=$true)]$regKeyPath
    )

    $appCmdNotFoundError = "Cannot find appcmd.exe location. Verify IIS is configured on $env:ComputerName and try operation again."
    $appCmdMinVersionError = "Version of IIS is less than 7.0 on machine $env:ComputerName. Minimum version of IIS required is 7.0"

    if(-not (Test-Path -Path $regKeyPath))
    {
        throw $appCmdNotFoundError
    }

    $regKey = Get-ItemProperty -Path $regKeyPath
    $path = $regKey.InstallPath
    $version = $regKey.MajorVersion

    if($version -le 6.0)
    {
        throw $appCmdMinVersionError
    }

    if( -not (Test-Path $path))
    {
        throw $appCmdNotFoundError
    }

    return (Join-Path $path appcmd.exe), $version
}

function Test-WebsiteExist
{
    param(
        [string] $siteName
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $appCmdArgs = [string]::Format(' list site /name:"{0}"',$siteName)
    $command = "`"$appCmdPath`" $appCmdArgs"
    Write-Verbose "Checking website exists. Running command : $command"

    $website = Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs

    if($null -ne $website -and $website -like "*`"$siteName`"*")
    {
        Write-Verbose "Website (`"$siteName`") already exists"
        return $true
    }

    Write-Verbose "Website (`"$siteName`") does not exist"
    return $false
}

function Test-BindingExist
{
    param(
        [string]$siteName,
        [string]$protocol,
        [string]$ipAddress,
        [string]$port,
        [string]$hostname
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $appCmdArgs = ' list sites'
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Checking binding exists for website (`"$siteName`"). Running command : $command"

    $sites = Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs

    $binding = [string]::Format("{0}/{1}:{2}:{3},", $protocol, $ipAddress, $port, $hostname)

    $isBindingExists = $false

    foreach($site in $sites)
    {
        $site = $site.ToLower()
        if($site.Contains($siteName.ToLower()) -and $site.Contains($binding.ToLower()))
        {
            Write-Verbose "Binding ($protocol / $ipAddress : $port : $hostname) already exists for the current website (`"$siteName`")."
            $isBindingExists = $true
        }
        elseif($site.Contains($binding.ToLower()))
        {
            throw "Binding ($protocol / $ipAddress : $port : $hostname) already exists for a different website (`"$site`"), change the port and retry the operation."
        }
    }

    Write-Verbose "Does binding ($protocol / $ipAddress : $port : $hostname) exist for website (`"$siteName`") is : $isBindingExists"
    return $isBindingExists
}

function Test-AppPoolExist
{
    param(
        [string]$appPoolName
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $appCmdArgs = [string]::Format(' list apppool /name:"{0}"',$appPoolName)
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Checking application pool exists. Running command : $command"

    $appPool = Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs

    $appPoolName = $appPoolName.Replace('`', '``').Replace('"', '`"').Replace('$', '`$')
    if($null -ne $appPool -and $appPool -like "*`"$appPoolName`"*")
    {
        Write-Verbose "Application Pool (`"$appPoolName`") already exists"
        return $true
    }

    Write-Verbose "Application Pool (`"$appPoolName`") does not exists"
    return $false
}

function Enable-SNI
{
    param(
        [string]$siteName,
        [string]$sni,
        [string]$ipAddress,
        [string]$port,
        [string]$hostname
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey

    if( -not ($sni -eq "true" -and $iisVersion -ge 8 -and -not [string]::IsNullOrWhiteSpace($hostname)))
    {
        Write-Verbose "Not enabling SNI : sni : $sni, iisVersion : $iisVersion, hostname : $hostname. Possible Reasons: `n 1. IIS Version is less than 8 `n 2. HostName input is not provided `n 3. SNI input is set to false"
        return
    }

    if($ipAddress -eq "All Unassigned")
    {
        $ipAddress = "*"
    }

    $appCmdArgs = [string]::Format(' set site /site.name:"{0}" /bindings.[protocol=''https'',bindingInformation=''{1}:{2}:{3}''].sslFlags:"1"',$siteName, $ipAddress, $port, $hostname)
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Enabling SNI by setting SslFlags=1 for binding. Running command : $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
}

function Add-SslCert
{
    param(
        [string]$port,
        [string]$certhash,
        [string]$hostname,
        [string]$sni,
        [int]$iisVersion,
        [string]$ipAddress
    )

    if([string]::IsNullOrWhiteSpace($certhash))
    {
        Write-Verbose "CertHash is empty. Returning"
        return
    }

    if($ipAddress -eq "All Unassigned" -or $ipAddress -eq "*")
    {
        $ipAddress = "0.0.0.0"
    }

    $result = $null
    $isItSameBinding = $false
    $addCertCmd = [string]::Empty

    #SNI is supported IIS 8 and above. To enable SNI hostnameport option should be used
    if($sni -eq "true" -and $iisVersion -ge 8 -and -not [string]::IsNullOrWhiteSpace($hostname))
    {
        $showCertCmd = [string]::Format("http show sslcert hostnameport={0}:{1}", $hostname, $port)
        Write-Verbose "Checking if SslCert binding is already present. Running command : netsh $showCertCmd"

        $result = Invoke-VstsTool -Filename "netsh" -Arguments $showCertCmd
        $isItSameBinding = $result.Get(4).Contains([string]::Format("{0}:{1}", $hostname, $port))

        $addCertCmd = [string]::Format("http add sslcert hostnameport={0}:{1} certhash={2} appid={{{3}}} certstorename=MY", $hostname, $port, $certhash, [System.Guid]::NewGuid().toString())
    }
    else
    {
        $showCertCmd = [string]::Format("http show sslcert ipport={0}:{1}", $ipAddress, $port)
        Write-Verbose "Checking if SslCert binding is already present. Running command : netsh $showCertCmd"

        $result = Invoke-VstsTool -Filename "netsh" -Arguments $showCertCmd
        $isItSameBinding = $result.Get(4).Contains([string]::Format("{0}:{1}", $ipAddress, $port))

        $addCertCmd = [string]::Format("http add sslcert ipport={0}:{1} certhash={2} appid={{{3}}} certstorename=MY", $ipAddress, $port, $certhash, [System.Guid]::NewGuid().toString())
    }

    $isItSameCert = $result.Get(5).ToLower().Contains($certhash.ToLower())

    if($isItSameBinding -and $isItSameCert)
    {
        Write-Verbose "SSL cert binding is already present. Returning"
        return
    }

    Write-Verbose "Setting SslCert for website."
    Invoke-VstsTool -Filename "netsh" -Arguments $addCertCmd -RequireExitCodeZero
}

function Add-Website
{
    param(
        [string]$siteName,
        [string]$physicalPath
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $appCmdArgs = [string]::Format(' add site /name:"{0}" /physicalPath:"{1}"',$siteName, $physicalPath)
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Creating website. Running command : $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
}

function Add-AppPool
{
    param(
        [string]$appPoolName
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $appCmdArgs = [string]::Format(' add apppool /name:"{0}"', $appPoolName)
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Creating application Pool. Running command : $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
}

function Invoke-AdditionalCommand
{
    param(
        [string]$additionalCommands
    )

    $appCmdCommands = $additionalCommands.Trim('"').Split([System.Environment]::NewLine, [System.StringSplitOptions]::RemoveEmptyEntries)
    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey

    foreach($appCmdCommand in $appCmdCommands)
    {
        if(-not [string]::IsNullOrWhiteSpace($appCmdCommand.Trim(' ')))
        {
            $command = "`"$appCmdPath`" $appCmdCommand"

            Write-Verbose "Running additional command. $command"
            Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdCommand -RequireExitCodeZero
        }
    }
}

function Add-WebsiteBindings {
    param (
        [string] $siteName,
        [Object[]] $bindings
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey

    foreach ($binding in $bindings) {
        $appCmdArgs = [string]::Format(' set site /site.name:"{0}"', $siteName)

        if($binding.ipAddress -eq "All Unassigned") {
            $binding.ipAddress = "*"
        }

        $isBindingExists = Test-BindingExist -siteName $siteName -protocol $binding.protocol -ipAddress $binding.ipAddress -port $binding.port -hostname $binding.hostname

        if($isBindingExists -eq $false)
        {
            $appCmdArgs = [string]::Format("{0} /+bindings.[protocol='{1}',bindingInformation='{2}:{3}:{4}']", $appCmdArgs, $binding.protocol, $binding.ipAddress, $binding.port, $binding.hostname)
            $command = "`"$appCmdPath`" $appCmdArgs"

            Write-Verbose "Updating website bindings. Running command : $command"
            Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
        }

        if($binding.protocol -eq "https") {
            Add-SslCert -ipAddress $binding.ipAddress -port $binding.port -certhash $binding.sslThumbPrint -hostname $binding.hostName -sni $binding.sniFlag -iisVersion $iisVersion
            Enable-SNI -siteName $siteName -sni $binding.sniFlag -ipAddress $binding.ipAddress -port $binding.port -hostname $binding.hostName
        }
    }
}

function Update-Website
{
    param(
        [string]$siteName,
        [string]$appPoolName,
        [string]$physicalPath,
        [string]$authType,
        [System.Management.Automation.PSCredential] $websitePhysicalPathAuthCredentials
    )

    $appCmdArgs = [string]::Format(' set site /site.name:"{0}"', $siteName)

    if(-not [string]::IsNullOrWhiteSpace($appPoolName))
    {
        $appCmdArgs = [string]::Format('{0} -applicationDefaults.applicationPool:"{1}"', $appCmdArgs, $appPoolName)
    }

    if(-not [string]::IsNullOrWhiteSpace($physicalPath))
    {
        $tmpPhysicalPath = $physicalPath.Replace("%SystemDrive%", "$env:SystemDrive")
        Write-Verbose "Checking website physical path exists $tmpPhysicalPath"
        if(!(Test-Path -Path $tmpPhysicalPath))
        {
            Write-Verbose "Creating website physical path $tmpPhysicalPath"
            New-Item -ItemType Directory -Path $tmpPhysicalPath
        }
        $appCmdArgs = [string]::Format("{0} -[path='/'].[path='/'].physicalPath:`"{1}`"", $appCmdArgs, $physicalPath)
    }

    if($authType -eq "WebsiteWindowsAuth")
    {
        $userName = $websitePhysicalPathAuthCredentials.userName
        $password = $websitePhysicalPathAuthCredentials.GetNetworkCredential().password

        if(-not [string]::IsNullOrWhiteSpace($userName))
        {
            $appCmdArgs = [string]::Format("{0} -[path='/'].[path='/'].userName:`"{1}`"", $appCmdArgs, $userName)
        }

        if(-not [string]::IsNullOrWhiteSpace($password))
        {
            $appCmdArgs = [string]::Format("{0} -[path='/'].[path='/'].password:`"{1}`"", $appCmdArgs, $password)
        }
    }
    else
    {
        $appCmdArgs = [string]::Format("{0} -[path='/'].[path='/'].userName:{1} -[path='/'].[path='/'].password:{2}", $appCmdArgs, $null, $null)
    }


    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Updating website properties. Running command : $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
}

function Update-AppPool
{
    param(
        [string]$appPoolName,
        [string]$clrVersion,
        [string]$pipeLineMode,
        [string]$identity,
        [System.Management.Automation.PSCredential] $appPoolCredentials
    )

    $appCmdArgs = [string]::Format(' set apppool /apppool.name:"{0}"', $appPoolName)

    if($clrVersion -ieq "No Managed Code")
    {
        $appCmdArgs = [string]::Format('{0} -managedRuntimeVersion:', $appCmdArgs)
    }
    elseif(-not [string]::IsNullOrWhiteSpace($clrVersion))
    {
        $appCmdArgs = [string]::Format('{0} -managedRuntimeVersion:{1}', $appCmdArgs, $clrVersion)
    }

    if(-not [string]::IsNullOrWhiteSpace($pipeLineMode))
    {
        $appCmdArgs = [string]::Format('{0} -managedPipelineMode:{1}', $appCmdArgs, $pipeLineMode)
    }

    if($identity -eq "SpecificUser" -and $appPoolCredentials)
    {
        $userName = $appPoolCredentials.UserName
        $password = $appPoolCredentials.GetNetworkCredential().password

        $appCmdArgs = [string]::Format('{0} -processModel.identityType:SpecificUser', $appCmdArgs)
        if (-not [string]::IsNullOrWhiteSpace($userName)) {
            $appCmdArgs = [string]::Format('{0} -processModel.userName:"{1}"',`
                                $appCmdArgs, $userName)
        }
        if (-not [string]::IsNullOrWhiteSpace($password)) {
            $appCmdArgs = [string]::Format('{0} -processModel.password:"{1}"',`
                                $appCmdArgs, $password)
        }
    }
    else
    {
        $appCmdArgs = [string]::Format('{0} -processModel.identityType:{1}', $appCmdArgs, $identity)
    }

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Updating application pool properties. Running command : $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
}

function Add-And-Update-Website
{
    param(
        [string]$siteName,
        [string]$appPoolName,
        [string]$physicalPath,
        [string]$authType,
        [System.Management.Automation.PSCredential] $websitePhysicalPathAuthCredentials
    )

    $doesWebsiteExists = Test-WebsiteExist -siteName $siteName

    if( -not $doesWebsiteExists)
    {
        Add-Website -siteName $siteName -physicalPath $physicalPath
    }

    Update-Website -siteName $siteName -appPoolName $appPoolName -physicalPath $physicalPath -authType $authType -websitePhysicalPathAuthCredentials $websitePhysicalPathAuthCredentials
}

function Add-And-Update-AppPool
{
    param(
        [string]$appPoolName,
        [string]$clrVersion,
        [string]$pipeLineMode,
        [string]$identity,
        [System.Management.Automation.PSCredential] $appPoolCredentials
    )

    $doesAppPoolExists = Test-AppPoolExist -appPoolName $appPoolName

    if(-not $doesAppPoolExists)
    {
        Add-AppPool -appPoolName $appPoolName
    }

    Update-AppPool -appPoolName $appPoolName -clrVersion $clrVersion -pipeLineMode $pipeLineMode -identity $identity -appPoolCredentials $appPoolCredentials
}

function Test-ApplicationExist {

    param(
        [string] [Parameter(Mandatory=$true)] $applicationName
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $appCmdArgs = [string]::Format(' list app "{0}"', $applicationName)
    $command = "`"$appCmdPath`" $appCmdArgs"
    Write-Verbose "Checking application exists. Running command : $command"

    $application = Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs

    if($null -ne $application -and $application -like "*`"$applicationName`"*")
    {
        Write-Verbose "Application (`"$applicationName`") already exists"
        return $true
    }

    Write-Verbose "Application (`"$applicationName`") does not exist"
    return $false
}

function Add-Application
{
    param(
        [string] [Parameter(Mandatory=$true)] $siteName,
        [string] [Parameter(Mandatory=$true)] $virtualPath,
        [string] [Parameter(Mandatory=$true)] $physicalPath
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $appCmdArgs = [string]::Format(' add app /site.name:"{0}" /path:"{1}" /physicalPath:"{2}"',$siteName, $virtualPath, $physicalPath)
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Creating web application. Running command : $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
}

function Update-Application
{
    param (
        [string] [Parameter(Mandatory=$true)] $applicationName,
        [string] $physicalPath,
        [string] $applicationPool,
        [string] $physicalPathAuthentication,
        [System.Management.Automation.PSCredential] $physicalPathAuthenticationCredentials
    )

    $appCmdArgs = [string]::Format(' set app /app.name:"{0}"', $applicationName)

    if(-not [string]::IsNullOrWhiteSpace($applicationPool))
    {
        $appCmdArgs = [string]::Format('{0} -applicationPool:"{1}"', $appCmdArgs, $applicationPool)
    }

    if(-not [string]::IsNullOrWhiteSpace($physicalPath))
    {
        $tmpPhysicalPath = $physicalPath.Replace("%SystemDrive%", "$env:SystemDrive")
        Write-Verbose "Checking application physical path exists $tmpPhysicalPath"
        if(!(Test-Path -Path $tmpPhysicalPath))
        {
            Write-Verbose "Creating application physical path $tmpPhysicalPath"
            New-Item -ItemType Directory -Path $tmpPhysicalPath
        }
        $appCmdArgs = [string]::Format("{0} -[path='/'].physicalPath:`"{1}`"", $appCmdArgs, $physicalPath)
    }

    if($physicalPathAuthentication -eq "ApplicationWindowsAuth")
    {
        $userName = $physicalPathAuthenticationCredentials.userName
        $password = $physicalPathAuthenticationCredentials.GetNetworkCredential().password

        if(-not [string]::IsNullOrWhiteSpace($userName))
        {
            $appCmdArgs = [string]::Format("{0} -[path='/'].userName:`"{1}`"", $appCmdArgs, $userName)
        }

        if(-not [string]::IsNullOrWhiteSpace($password))
        {
            $appCmdArgs = [string]::Format("{0} -[path='/'].password:`"{1}`"", $appCmdArgs, $password)
        }
    }
    else
    {
        $appCmdArgs = [string]::Format("{0} -[path='/'].userName:{1} -[path='/'].password:{2}", $appCmdArgs, $null, $null)
    }

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Updating application properties. Running command : $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
}

function Add-And-Update-Application
{
    param (
        [string] [Parameter(Mandatory=$true)] $siteName,
        [string] [Parameter(Mandatory=$true)] $virtualPath,
        [string] [Parameter(Mandatory=$true)] $physicalPath,
        [string] $applicationPool,
        [string] $physicalPathAuthentication,
        [System.Management.Automation.PSCredential] $physicalPathAuthenticationCredentials
    )

    $applicationName = "$siteName$virtualPath"
    $applicationExist = Test-ApplicationExist -applicationName $applicationName

    if( -not $applicationExist)
    {
        Add-Application -siteName $siteName -virtualPath $virtualPath -physicalPath $physicalPath
    }

    Update-Application -applicationName $applicationName -physicalPath $physicalPath -applicationPool $applicationPool -physicalPathAuthentication $physicalPathAuthentication -physicalPathAuthenticationCredentials $physicalPathAuthenticationCredentials
}

function Test-VirtualDirectoryExist
{
    param(
        [string] [Parameter(Mandatory=$true)] $virtualDirectoryName
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $appCmdArgs = [string]::Format(' list vdir -vdir.name:"{0}"', $virtualDirectoryName)
    $command = "`"$appCmdPath`" $appCmdArgs"
    Write-Verbose "Checking virtual directory exists. Running command : $command"

    $virtualDirectory = Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs

    if($null -ne $virtualDirectory -and $virtualDirectory -like "*`"$virtualDirectoryName`"*")
    {
        Write-Verbose "virtualDirectory = $virtualDirectory"
        Write-Verbose "Virtual Directory (`"$virtualDirectoryName`") already exists"
        return $true
    }

    Write-Verbose "Virtual Directory (`"$virtualDirectoryName`") does not exist"
    return $false
}

function Add-VirtualDirectory
{
    param(
        [string] [Parameter(Mandatory=$true)] $applicationName,
        [string] [Parameter(Mandatory=$true)] $virtualPath,
        [string] [Parameter(Mandatory=$true)] $physicalPath
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $appCmdArgs = [string]::Format(' add vdir /app.name:"{0}" /path:"{1}" /physicalPath:"{2}"',$applicationName, $virtualPath, $physicalPath)
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Creating virtual directory. Running command : $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
}

function Update-VirtualDirectory
{
    param (
        [string] [Parameter(Mandatory=$true)] $virtualDirectoryName,
        [string] $physicalPath,
        [string] $physicalPathAuthentication,
        [System.Management.Automation.PSCredential] $physicalPathAuthenticationCredentials
    )

    $appCmdArgs = [string]::Format(' set vdir /vdir.name:"{0}"', $virtualDirectoryName)

    if(-not [string]::IsNullOrWhiteSpace($physicalPath))
    {
        $tmpPhysicalPath = $physicalPath.Replace("%SystemDrive%", "$env:SystemDrive")
        Write-Verbose "Checking virtual directory physical path exists $tmpPhysicalPath"
        if(!(Test-Path -Path $tmpPhysicalPath -Credential $physicalPathAuthenticationCredentials))
        {
            Write-Verbose "Creating virtual directory physical path $tmpPhysicalPath"
            New-Item -ItemType Directory -Path $tmpPhysicalPath
        }
        $appCmdArgs = [string]::Format("{0} -physicalPath:`"{1}`"", $appCmdArgs, $physicalPath)
    }

    if($physicalPathAuthentication -ieq "VDWindowsAuth")
    {
        $userName = $physicalPathAuthenticationCredentials.userName
        $password = $physicalPathAuthenticationCredentials.GetNetworkCredential().password

        if(-not [string]::IsNullOrWhiteSpace($userName))
        {
            $appCmdArgs = [string]::Format("{0} -userName:`"{1}`"", $appCmdArgs, $userName)
        }

        if(-not [string]::IsNullOrWhiteSpace($password))
        {
            $appCmdArgs = [string]::Format("{0} -password:`"{1}`"", $appCmdArgs, $password)
        }
    }
    else
    {
        $appCmdArgs = [string]::Format("{0} -userName:{1} -password:{2}", $appCmdArgs, $null, $null)
    }

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Updating virtual directory properties. Running command : $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
}

function Add-And-Update-VirtualDirectory
{
    param (
        [string] [Parameter(Mandatory=$true)] $siteName,
        [string] [Parameter(Mandatory=$true)] $virtualPath,
        [string] [Parameter(Mandatory=$true)] $physicalPath,
        [string] $physicalPathAuthentication,
        [System.Management.Automation.PSCredential] $physicalPathAuthenticationCredentials
    )

    $splittedVirtualPath = $virtualPath.Split("/")
    $applicationName = "$siteName/"
    $virtualDirectoryName = "$siteName$virtualPath"
    if($splittedVirtualPath.Count -gt 2)
    {
        $app = $splittedVirtualPath[1]
        if (Test-ApplicationExist -applicationName "$siteName/$app") {
            $applicationName = "$siteName/$app"
            $virtualPath = $virtualPath.Substring("/$app".Length)
            $virtualDirectoryName = "$applicationName$virtualPath"
        }
    }

    Write-Verbose "applicationName = $applicationName"
    Write-Verbose "virtualDirectoryName = $virtualDirectoryName"
    $virtualDirectoryExist = Test-VirtualDirectoryExist -virtualDirectoryName $virtualDirectoryName

    if(-not $virtualDirectoryExist)
    {
        Add-VirtualDirectory -applicationName $applicationName -virtualPath $virtualPath -physicalPath $physicalPath
    }

    Update-VirtualDirectory -virtualDirectoryName $virtualDirectoryName -physicalPath $physicalPath -physicalPathAuthentication $physicalPathAuthentication -physicalPathAuthenticationCredentials $physicalPathAuthenticationCredentials
}

function Start-Stop-Website {
    param (
        [string][Parameter(Mandatory=$true)] $sitename,
        [string][Parameter(Mandatory=$true)] $action
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $appCmdArgs = [string]::Format('{0} site /site.name:"{1}"', $action, $siteName)
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Performing action '$action' on website '$sitename'. Running command $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
}

function Start-Stop-Recycle-ApplicationPool {
    param (
        [string][Parameter(Mandatory=$true)] $appPoolName,
        [string][Parameter(Mandatory=$true)] $action
    )

    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey
    $appCmdArgs = [string]::Format('{0} apppool /apppool.name:"{1}"', $action, $appPoolName)
    $command = "`"$appCmdPath`" $appCmdArgs"

    Write-Verbose "Performing action '$action' on application pool '$appPoolName'. Running command $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
}

function Set-WebsiteAuthentication {
    param (
        [string]$anonymousAuthentication,
        [string]$basicAuthentication,
        [string]$windowsAuthentication,
        [string]$websiteName
    )

    Write-Verbose "Configuring website authentication"
    $appCmdPath, $iisVersion = Get-AppCmdLocation -regKeyPath $AppCmdRegKey

    $appCmdArgs = [string]::Format('set config "{0}" /section:anonymousAuthentication /enabled:{1} /commit:apphost', $websiteName, $anonymousAuthentication)
    $command = "`"$appCmdPath`" $appCmdArgs"
    Write-Verbose "Setting anonymous authentication for website '$websiteName' to $anonymousAuthentication."
    Write-Verbose "Running command $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero

    $appCmdArgs = [string]::Format('set config "{0}" /section:basicAuthentication /enabled:{1} /commit:apphost', $websiteName, $basicAuthentication)
    $command = "`"$appCmdPath`" $appCmdArgs"
    Write-Verbose "Setting basic authentication for website '$websiteName' to $basicAuthentication."
    Write-Verbose "Running command $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero

    $appCmdArgs = [string]::Format('set config "{0}" /section:windowsAuthentication /enabled:{1} /commit:apphost', $websiteName, $windowsAuthentication)
    $command = "`"$appCmdPath`" $appCmdArgs"
    Write-Verbose "Setting windows authentication for website '$websiteName' to $windowsAuthentication."
    Write-Verbose "Running command $command"
    Invoke-VstsTool -Filename $appCmdPath -Arguments $appCmdArgs -RequireExitCodeZero
}

function Invoke-Main
{
    param (
        [string]$ActionIISWebsite,
        [string]$ActionIISApplicationPool,

        [string]$CreateApplication,
        [string]$CreateVirtualDirectory,

        [string]$VirtualPath,

        [string]$WebsiteName,
        [string]$PhysicalPath,
        [string]$PhysicalPathAuth,
        [System.Management.Automation.PSCredential] $PhysicalPathAuthCredentials,

        [string]$AddBinding,
        [Object[]]$Bindings,

        [string]$AppPoolName,
        [string]$DotNetVersion,
        [string]$PipeLineMode,
        [string]$AppPoolIdentity,
        [System.Management.Automation.PSCredential] $AppPoolCredentials,

        [string]$ConfigureAuthentication,
        [string]$AnonymousAuthentication,
        [string]$BasicAuthentication,
        [string]$WindowsAuthentication,

        [string]$AppCmdCommands
    )

    Write-Verbose "Entering Invoke-Main function"

    Write-Verbose "ActionIISWebsite = $ActionIISWebsite"
    Write-Verbose "ActionIISApplicationPool = $ActionIISApplicationPool"

    Write-Verbose "CreateApplication = $CreateApplication"
    Write-Verbose "CreateVirtualDirectory = $CreateVirtualDirectory"

    Write-Verbose "VirtualPath = $VirtualPath"

    Write-Verbose "WebsiteName = $WebsiteName"
    Write-Verbose "PhysicalPath = $PhysicalPath"
    Write-Verbose "PhysicalPathAuth = $PhysicalPathAuth"
    Write-Verbose "AddBinding = $AddBinding"

    Write-Verbose "AppPoolName = $AppPoolName"
    Write-Verbose "DotNetVersion = $DotNetVersion"
    Write-Verbose "PipeLineMode = $PipeLineMode"
    Write-Verbose "AppPoolIdentity = $AppPoolIdentity"

    Write-Verbose "ConfigureAuthentication = $ConfigureAuthentication"
    Write-Verbose "AnonymousAuthentication = $AnonymousAuthentication"
    Write-Verbose "BasicAuthentication = $BasicAuthentication"
    Write-Verbose "WindowsAuthentication = $WindowsAuthentication"

    Write-Verbose "AppCmdCommands = $AppCmdCommands"

    switch ($ActionIISApplicationPool)
    {
        "CreateOrUpdateAppPool"
        {
            Add-And-Update-AppPool -appPoolName $AppPoolName -clrVersion $DotNetVersion -pipeLineMode $PipeLineMode -identity $AppPoolIdentity -appPoolCredentials $AppPoolCredentials
        }

        "StartAppPool"
        {
            Start-Stop-Recycle-ApplicationPool -appPoolName $AppPoolName -action "start"
        }

        "StopAppPool"
        {
            Start-Stop-Recycle-ApplicationPool -appPoolName $AppPoolName -action "stop"
        }

        "RecycleAppPool"
        {
            Start-Stop-Recycle-ApplicationPool -appPoolName $AppPoolName -action "recycle"
        }
    }

    switch ($ActionIISWebsite)
    {
        "CreateOrUpdateWebsite"
        {
            Add-And-Update-Website -siteName $WebsiteName -appPoolName $AppPoolName -physicalPath $PhysicalPath -authType $PhysicalPathAuth -websitePhysicalPathAuthCredentials $PhysicalPathAuthCredentials

            if($AddBinding -eq "true")
            {
                Add-WebsiteBindings -siteName $WebsiteName -bindings $Bindings
            }

            if($ConfigureAuthentication -ieq "true")
            {
                Set-WebsiteAuthentication -anonymousAuthentication $AnonymousAuthentication -basicAuthentication $BasicAuthentication -windowsAuthentication $WindowsAuthentication -websiteName $WebsiteName
            }
        }

        "StartWebsite"
        {
            Start-Stop-Website -sitename $WebsiteName -action "start"
        }

        "StopWebsite"
        {
            Start-Stop-Website -sitename $WebsiteName -action "stop"
        }
    }

    if($CreateApplication -eq "true")
    {
        Add-And-Update-Application -siteName $WebsiteName -virtualPath $VirtualPath -physicalPath $physicalPath -applicationPool $AppPoolName -physicalPathAuthentication $PhysicalPathAuth -physicalPathAuthenticationCredentials $PhysicalPathAuthCredentials
    }

    if($CreateVirtualDirectory -eq "true")
    {
        Add-And-Update-VirtualDirectory -siteName $WebsiteName -virtualPath $VirtualPath -physicalPath $physicalPath -physicalPathAuthentication $PhysicalPathAuth -physicalPathAuthenticationCredentials $PhysicalPathAuthCredentials
    }

    Invoke-AdditionalCommand -additionalCommands $AppCmdCommands
    Write-Verbose "Exiting Execute-Main function"
}