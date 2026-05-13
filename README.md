# AZ Visual Subnet Designer

A browser-based tool for designing and visualising Azure platform networks — multiple VNets, subnets, address spaces, and regions — with no installation required.

**[Live Demo →](https://davidjhole.github.io/az-visual-subnet/)**

![AZ Visual Subnet Designer](https://img.shields.io/badge/Azure-Subnet%20Designer-0078d4?logo=microsoftazure&logoColor=white)

## Features

- **Multi-VNet platform view** — design an entire Azure landing zone with multiple VNets and address spaces
- **Visual subnet splitting and joining** — divide subnets into smaller blocks or merge adjacent ones
- **Proportional overview bar** — see your entire platform address space at a glance, with free gaps highlighted
- **Overlap detection** — instant warnings when VNets or subnets overlap
- **Utilisation bars** — see how much of each VNet's address space is allocated
- **Azure preset subnets** — quick-add well-known subnets (AzureFirewallSubnet, GatewaySubnet, AzureBastionSubnet, etc.)
- **Import / Export JSON** — save and restore your designs
- **Copy as Markdown** — paste a formatted table into docs, wikis, or PRs
- **Copy for Word** — copies a styled HTML table that pastes correctly into Microsoft Word
- **Undo** — step back through changes
- **Local storage persistence** — your design is saved automatically in the browser
- **Import directly from Azure** — use the included PowerShell script to export your real VNets and subnets

## Usage

### Option 1: Use the live site

Open [https://davidjhole.github.io/az-visual-subnet/](https://davidjhole.github.io/az-visual-subnet/) — no installation needed.

### Option 2: Run locally

Clone the repo and open `index.html` directly in a browser:

```bash
git clone https://github.com/davidjhole/az-visual-subnet.git
cd az-visual-subnet
open index.html   # macOS
# or just open index.html in your browser
```

No build step, no dependencies, no server required.

## Import from Azure

Use the included PowerShell script to export your real Azure VNets and subnets into the tool's JSON format.

**Download the script**

- If you cloned the repo, the script is already at `export-azure.ps1` in the root.
- If you're using the live site, click the **export-azure.ps1** download link in the Help & Troubleshooting section at the bottom of the page.

**Run the script**

```powershell
# Requires Azure CLI (az login) or Az PowerShell module

# Export all VNets across all subscriptions
.\export-azure.ps1

# Export from a specific subscription
.\export-azure.ps1 -SubscriptionId "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Export from a specific resource group
.\export-azure.ps1 -SubscriptionId "xxxxxxxx" -ResourceGroup "rg-hub-uksouth"
```

Then use the **Import JSON** button in the tool to load the exported file.

## Copying to Microsoft Word

The **Copy for Word** button copies a rich-formatted HTML table that pastes with full styling (coloured headers, styled cells, utilisation data) into Microsoft Word.

If the table pastes as plain text instead of a formatted table, check your Word paste settings:

1. In Word, go to **File → Options → Advanced**
2. Scroll down to **"Cut, copy, and paste"**
3. Set **"Pasting from other programs"** to **"Keep Source Formatting"** or **"Merge Formatting"**
4. Click OK and try pasting again

**Quick fix:** Right-click where you want to paste and choose the _"Keep Source Formatting"_ paste option (clipboard icon with paintbrush), or use **Paste Special → HTML Format**.

## Tech Stack

- Vanilla HTML, CSS, and JavaScript — no frameworks, no build tools
- Single-page app using an IIFE pattern
- Works in any modern browser

## Contributing

Issues and PRs welcome. If you change the `copyHTML()` function, read [COPYHTML-REFERENCE.md](COPYHTML-REFERENCE.md) first — it documents the only tested approach that works with Microsoft Word.

## Licence

MIT
