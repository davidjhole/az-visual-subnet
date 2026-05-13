<#
.SYNOPSIS
    Export Azure VNets and Subnets to JSON for the Azure Visual Subnet Calculator.

.DESCRIPTION
    Queries your Azure environment for all VNets (or a specific subscription/resource group)
    and exports them in the JSON format expected by the platform view.

    Requires: Azure CLI (az) logged in, or Az PowerShell module.

.PARAMETER SubscriptionId
    Optional. Limit export to a specific subscription.

.PARAMETER ResourceGroup
    Optional. Limit export to a specific resource group.

.PARAMETER OutputFile
    Output JSON file path. Defaults to azure-platform-export.json.

.EXAMPLE
    # Export all VNets across all subscriptions
    .\export-azure.ps1

    # Export from a specific subscription
    .\export-azure.ps1 -SubscriptionId "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

    # Export from a specific resource group
    .\export-azure.ps1 -SubscriptionId "xxxxxxxx" -ResourceGroup "rg-hub-uksouth"
#>

param(
    [string]$SubscriptionId,
    [string]$ResourceGroup,
    [string]$OutputFile = "azure-platform-export.json"
)

$ErrorActionPreference = "Stop"

# Check az cli is available and logged in
try {
    $null = az account show 2>&1
}
catch {
    Write-Error "Azure CLI not logged in. Run 'az login' first."
    exit 1
}

Write-Host "Exporting Azure VNets and Subnets..." -ForegroundColor Cyan

# Determine subscriptions to query
if ($SubscriptionId) {
    $subscriptions = @(@{ id = $SubscriptionId; name = (az account show --subscription $SubscriptionId --query "name" -o tsv) })
}
else {
    $subscriptions = az account list --query "[?state=='Enabled'].{id:id, name:name}" -o json | ConvertFrom-Json
}

$allVnets = @()

foreach ($sub in $subscriptions) {
    Write-Host "  Subscription: $($sub.name) ($($sub.id))" -ForegroundColor Yellow

    # Build az command
    $azArgs = @("network", "vnet", "list", "--subscription", $sub.id)
    if ($ResourceGroup) {
        $azArgs += @("--resource-group", $ResourceGroup)
    }
    $azArgs += @("-o", "json")

    $vnetsRaw = & az @azArgs 2>$null
    if (-not $vnetsRaw) { continue }

    # Join output into a single string to avoid ConvertFrom-Json pipeline quirks
    $vnetsJson = ($vnetsRaw) -join "`n"
    $vnets = $vnetsJson | ConvertFrom-Json

    foreach ($vnet in $vnets) {
        Write-Host "    VNet: $($vnet.name) [$($vnet.addressSpace.addressPrefixes -join ', ')]" -ForegroundColor Green

        # Get the primary address space (first prefix)
        $primaryCidr = $vnet.addressSpace.addressPrefixes[0]
        $additionalCidrs = @()
        if ($vnet.addressSpace.addressPrefixes.Count -gt 1) {
            $additionalCidrs = $vnet.addressSpace.addressPrefixes[1..($vnet.addressSpace.addressPrefixes.Count - 1)]
        }

        # Extract resource group from ID
        $rgName = ($vnet.id -split "/resourceGroups/")[1] -split "/" | Select-Object -First 1

        # Build subnets array
        $subnetList = @()
        foreach ($subnet in $vnet.subnets) {
            # Azure API versions vary: newer ones use addressPrefixes (array),
            # older ones use addressPrefix (string). Try both, prefer the array.
            $subnetCidr = $null

            # Try addressPrefixes array first (newer API, always populated)
            if ($subnet.addressPrefixes) {
                $subnetCidr = [string]($subnet.addressPrefixes[0])
            }

            # Fall back to addressPrefix string (older API)
            if ([string]::IsNullOrWhiteSpace($subnetCidr) -and $subnet.addressPrefix) {
                $subnetCidr = [string]$subnet.addressPrefix
            }

            # Final guard
            if ([string]::IsNullOrWhiteSpace($subnetCidr)) { $subnetCidr = "" }

            $subnetObj = @{
                name   = $subnet.name
                cidr   = $subnetCidr
                colour = ""
            }

            $subnetList += $subnetObj
            Write-Host "      Subnet: $($subnet.name) [$subnetCidr]" -ForegroundColor Gray
        }

        $vnetObj = @{
            name             = $vnet.name
            cidr             = $primaryCidr
            additionalCidrs  = $additionalCidrs
            region           = $vnet.location
            resourceGroup    = $rgName
            subscriptionName = $sub.name
            subscriptionId   = $sub.id
            subnets          = $subnetList
        }

        $allVnets += $vnetObj
    }
}

# Build output
$output = @{
    version    = 1
    exportDate = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    source     = "Azure Export"
    vnets      = $allVnets
}

$json = $output | ConvertTo-Json -Depth 10
$json | Out-File -FilePath $OutputFile -Encoding utf8

Write-Host ""
Write-Host "Exported $($allVnets.Count) VNet(s) to $OutputFile" -ForegroundColor Cyan
Write-Host "Open platform.html and import this file." -ForegroundColor Cyan
