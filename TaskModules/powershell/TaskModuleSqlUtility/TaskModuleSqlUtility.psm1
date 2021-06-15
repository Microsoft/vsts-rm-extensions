[CmdletBinding()]
param(
    [ValidateNotNull()]
    [Parameter()]
    [hashtable]$ModuleParameters = @{ })

if ($host.Name -ne 'ConsoleHost') {
    Write-Warning "TaskModuleSqlUtility is designed for use with powershell.exe (ConsoleHost). Output may be different when used with other hosts."
}

# Private module variables.
[bool]$script:nonInteractive = "$($ModuleParameters['NonInteractive'])" -eq 'true'
Write-Verbose "NonInteractive: $script:nonInteractive"

# Import/export functions.
. "$PSScriptRoot\SqlPackageOnTargetMachines.ps1"
. "$PSScriptRoot\SqlQueryOnTargetMachines.ps1"

Export-ModuleMember -Function @(
        'Invoke-SqlQueryDeployment',
        'Invoke-DacpacDeployment'
    )

# Special internal exception type to control the flow. Not currently intended
# for public usage and subject to change. If the type has already
# been loaded once, then it is not loaded again.

#Write-Verbose "Adding exceptions types."

# calling add-type will throw a system.invalidoperationexception if the environment variables size has grown beyond 64k

#Add-Type -WarningAction SilentlyContinue -Debug:$false -TypeDefinition @'
#namespace TaskModuleSqlUtility
#{
#    public class TerminationException : System.Exception
#    {
#        public TerminationException(System.String message) : base(message) { }
#    }
#}
#'@
