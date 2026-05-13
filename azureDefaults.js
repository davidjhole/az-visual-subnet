/**
 * Azure well-known subnets with recommended minimum sizes.
 * Reference: https://learn.microsoft.com/en-us/azure/architecture/reference-architectures/hybrid-networking/
 */
const AZURE_WELL_KNOWN_SUBNETS = [
    {
        name: "GatewaySubnet",
        recommendedCidr: 27,
        note: "Required for VPN/ExpressRoute gateways. /27 recommended, /28 minimum."
    },
    {
        name: "AzureFirewallSubnet",
        recommendedCidr: 26,
        note: "Must be named exactly 'AzureFirewallSubnet'. /26 required."
    },
    {
        name: "AzureFirewallManagementSubnet",
        recommendedCidr: 26,
        note: "Required for forced tunnelling with Azure Firewall. /26 required."
    },
    {
        name: "AzureBastionSubnet",
        recommendedCidr: 26,
        note: "Must be named exactly 'AzureBastionSubnet'. /26 minimum."
    },
    {
        name: "RouteServerSubnet",
        recommendedCidr: 27,
        note: "Required for Azure Route Server. /27 minimum."
    },
    {
        name: "ApplicationGatewaySubnet",
        recommendedCidr: 24,
        note: "Dedicated subnet for App Gateway. /24 recommended for scaling."
    },
    {
        name: "ApiManagementSubnet",
        recommendedCidr: 27,
        note: "For APIM VNet injection. /27 minimum (premium), /28 for developer."
    },
    {
        name: "AzureContainerAppsSubnet",
        recommendedCidr: 23,
        note: "Container Apps environment. /23 minimum recommended."
    },
    {
        name: "AKSNodeSubnet",
        recommendedCidr: 24,
        note: "AKS node pool subnet. Size depends on max pods x nodes."
    },
    {
        name: "AKSPodSubnet",
        recommendedCidr: 22,
        note: "For Azure CNI overlay or dynamic IP. /22 gives ~1000 pod IPs."
    },
    {
        name: "PrivateEndpointsSubnet",
        recommendedCidr: 24,
        note: "Dedicated subnet for Private Endpoints. Size to your workload."
    },
    {
        name: "AppServiceIntegrationSubnet",
        recommendedCidr: 26,
        note: "For VNet integration with App Service/Functions. /26 minimum."
    },
    {
        name: "AzureSQLManagedInstanceSubnet",
        recommendedCidr: 27,
        note: "SQL MI requires dedicated subnet. /27 minimum (16 instances max)."
    },
    {
        name: "NetAppFilesSubnet",
        recommendedCidr: 28,
        note: "Delegated subnet for Azure NetApp Files. /28 minimum."
    },
    {
        name: "WorkloadSubnet",
        recommendedCidr: 24,
        note: "General purpose workload subnet."
    }
];

/**
 * Azure reserves 5 IPs in every subnet:
 * x.x.x.0   - Network address
 * x.x.x.1   - Default gateway
 * x.x.x.2   - DNS mapping (Azure DNS)
 * x.x.x.3   - DNS mapping (Azure DNS)
 * x.x.x.255 - Broadcast (last IP in the range)
 */
const AZURE_RESERVED_IPS = 5;

/**
 * Azure minimum subnet prefix length
 */
const AZURE_MIN_PREFIX = 29; // /29 = 8 IPs, 3 usable

/**
 * Azure maximum VNet prefix length
 */
const AZURE_MAX_VNET_PREFIX = 8; // /8 is the largest
