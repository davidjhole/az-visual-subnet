const platform = (function () {

    // --- State ---
    var addressSpace = ''; // Platform supernet CIDR e.g. 10.0.0.0/16
    var vnets = []; // Array of { name, cidr, region, subscriptionName, colour, expanded, subnets[] }
    var undoStack = [];
    var MAX_UNDO = 50;
    var vnetModalMode = null; // 'add' or index
    var subnetModalVnet = null;
    var subnetModalSubnet = null;

    // --- Colours ---
    var VNET_COLOURS = [
        "#4fc3f7", "#81c784", "#ffb74d", "#e57373",
        "#ba68c8", "#4dd0e1", "#aed581", "#ffd54f",
        "#ff8a65", "#f06292", "#7986cb", "#a1887f"
    ];
    var SUBNET_COLOURS = [
        "#b3e5fc", "#c8e6c9", "#ffe0b2", "#ffcdd2",
        "#e1bee7", "#b2ebf2", "#dcedc8", "#fff9c4",
        "#ffccbc", "#f8bbd0", "#c5cae9", "#d7ccc8",
        "#cfd8dc", "#f0f4c3", "#b2dfdb", "#d1c4e9"
    ];
    var vnetColourIdx = 0;
    var subnetColourIdx = 0;

    function nextVnetColour() {
        var c = VNET_COLOURS[vnetColourIdx % VNET_COLOURS.length];
        vnetColourIdx++;
        return c;
    }
    function nextSubnetColour() {
        var c = SUBNET_COLOURS[subnetColourIdx % SUBNET_COLOURS.length];
        subnetColourIdx++;
        return c;
    }

    // --- IP Utilities ---
    function ipToLong(ip) {
        var parts = ip.split('.').map(Number);
        return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    }
    function longToIp(long) {
        return [(long >>> 24) & 255, (long >>> 16) & 255, (long >>> 8) & 255, long & 255].join('.');
    }
    function parseCidr(cidr) {
        var parts = cidr.split('/');
        var ip = parts[0];
        var prefix = parseInt(parts[1], 10);
        var ipLong = ipToLong(ip);
        var mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
        var network = (ipLong & mask) >>> 0;
        var broadcast = (network | (~mask >>> 0)) >>> 0;
        var totalIPs = Math.pow(2, 32 - prefix);
        return { ip: ip, prefix: prefix, mask: mask, network: network, broadcast: broadcast, totalIPs: totalIPs };
    }
    function ipRange(cidr) {
        var p = parseCidr(cidr);
        return longToIp(p.network) + ' \u2013 ' + longToIp(p.broadcast);
    }
    function usableIPs(cidr) {
        var p = parseCidr(cidr);
        if (p.totalIPs <= AZURE_RESERVED_IPS) return 0;
        return p.totalIPs - AZURE_RESERVED_IPS;
    }
    function validateCidr(cidr) {
        var match = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
        if (!match) return false;
        var octets = [match[1], match[2], match[3], match[4]].map(Number);
        if (octets.some(function (o) { return o > 255; })) return false;
        var prefix = parseInt(match[5], 10);
        if (prefix < 0 || prefix > 32) return false;
        var p = parseCidr(cidr);
        if (p.network !== ipToLong(octets.join('.'))) return false;
        return true;
    }
    function rangesOverlap(cidrA, cidrB) {
        var a = parseCidr(cidrA);
        var b = parseCidr(cidrB);
        return a.network <= b.broadcast && b.network <= a.broadcast;
    }

    // --- Address Space ---
    function setAddressSpace(value) {
        var v = value.trim();
        if (v && !validateCidr(v)) { showToast('Invalid address space CIDR'); return; }

        var oldCidr = addressSpace;
        addressSpace = v;
        document.getElementById('addressSpaceInput').value = addressSpace;

        // Rebase VNets when both old and new address spaces are valid and there are VNets to update
        if (oldCidr && v && vnets.length > 0) {
            var oldBase = parseCidr(oldCidr);
            var newBase = parseCidr(v);
            pushUndo();
            vnets = vnets.map(function (vnet) {
                var vp = parseCidr(vnet.cidr);
                var offset = vp.network - oldBase.network; // signed JS number
                var newVnetNetworkNum = newBase.network + offset;
                if (newVnetNetworkNum < 0 || newVnetNetworkNum > 0xFFFFFFFF) return vnet;
                var newVnetNetwork = newVnetNetworkNum >>> 0;
                var newVnetBroadcast = (newVnetNetwork + vp.totalIPs - 1) >>> 0;
                if (newVnetNetwork < newBase.network || newVnetBroadcast > newBase.broadcast) return vnet;
                var newVnetCidr = longToIp(newVnetNetwork) + '/' + vp.prefix;
                var newSubnets = vnet.subnets.map(function (s) {
                    var sp = parseCidr(s.cidr);
                    var subOffset = sp.network - vp.network;
                    var newSubNetwork = (newVnetNetwork + subOffset) >>> 0;
                    return { cidr: longToIp(newSubNetwork) + '/' + sp.prefix, name: s.name, colour: s.colour };
                });
                return Object.assign({}, vnet, { cidr: newVnetCidr, subnets: newSubnets });
            });
        }

        render();
    }

    // --- Undo ---
    function pushUndo() {
        undoStack.push(JSON.parse(JSON.stringify(vnets)));
        if (undoStack.length > MAX_UNDO) undoStack.shift();
    }
    function undo() {
        if (undoStack.length === 0) { showToast("Nothing to undo"); return; }
        vnets = undoStack.pop();
        render();
        showToast("Undone");
    }

    // --- VNet Management ---
    function addVnet() {
        vnetModalMode = 'add';
        document.getElementById('vnetModalTitle').textContent = 'Add VNet';
        document.getElementById('modalVnetName').value = '';
        document.getElementById('modalVnetCidr').value = '';
        document.getElementById('modalVnetRegion').value = '';
        document.getElementById('vnetModal').style.display = 'flex';
        document.getElementById('modalVnetName').focus();
    }

    function editVnet(vIdx) {
        vnetModalMode = vIdx;
        document.getElementById('vnetModalTitle').textContent = 'Edit VNet';
        document.getElementById('modalVnetName').value = vnets[vIdx].name;
        document.getElementById('modalVnetCidr').value = vnets[vIdx].cidr;
        document.getElementById('modalVnetRegion').value = vnets[vIdx].region || '';
        document.getElementById('vnetModal').style.display = 'flex';
        document.getElementById('modalVnetName').focus();
    }

    function saveVnetModal() {
        var name = document.getElementById('modalVnetName').value.trim();
        var cidr = document.getElementById('modalVnetCidr').value.trim();
        var region = document.getElementById('modalVnetRegion').value.trim();

        if (!name) { showToast("VNet name is required"); return; }
        if (!validateCidr(cidr)) { showToast("Invalid CIDR"); return; }

        pushUndo();

        if (vnetModalMode === 'add') {
            var vnet = {
                name: name,
                cidr: cidr,
                region: region,
                colour: nextVnetColour(),
                expanded: true,
                subnets: [{ cidr: cidr, name: '', colour: nextSubnetColour() }]
            };
            vnets.push(vnet);
        } else {
            var idx = vnetModalMode;
            var oldCidr = vnets[idx].cidr;
            vnets[idx].name = name;
            vnets[idx].region = region;
            if (cidr !== oldCidr) {
                var oldRange = parseCidr(oldCidr);
                var newRange = parseCidr(cidr);

                // Rebase subnets: keep sizes, shift to new base address
                var rebased = [];
                var overflow = [];
                vnets[idx].subnets.forEach(function (s) {
                    var sp = parseCidr(s.cidr);
                    var offset = sp.network - oldRange.network;
                    var newNetwork = (newRange.network + offset) >>> 0;
                    var newBroadcast = (newNetwork + sp.totalIPs - 1) >>> 0;
                    var newSubCidr = longToIp(newNetwork) + '/' + sp.prefix;

                    if (newNetwork >= newRange.network && newBroadcast <= newRange.broadcast) {
                        rebased.push({ cidr: newSubCidr, name: s.name, colour: s.colour });
                    } else if (s.name) {
                        overflow.push(s.name + ' (' + s.cidr + ' \u2192 ' + newSubCidr + ')');
                    }
                });

                if (overflow.length > 0) {
                    var msg = overflow.length + ' named subnet(s) do not fit in ' + cidr + ':\n  ' + overflow.join('\n  ') + '\n\nThese subnets will be removed. OK to continue, Cancel to go back.';
                    if (!confirm(msg)) {
                        return; // Don't close modal, let user fix the CIDR
                    }
                }

                vnets[idx].cidr = cidr;
                if (rebased.length > 0) {
                    vnets[idx].subnets = fillGaps(cidr, rebased);
                } else {
                    vnets[idx].subnets = [{ cidr: cidr, name: '', colour: nextSubnetColour() }];
                }
            }
        }

        closeVnetModal();
        render();
    }

    function closeVnetModal() {
        document.getElementById('vnetModal').style.display = 'none';
        vnetModalMode = null;
    }

    function removeVnet(vIdx) {
        if (!confirm("Remove VNet '" + vnets[vIdx].name + "' and all its subnets?")) return;
        pushUndo();
        vnets.splice(vIdx, 1);
        render();
    }

    function toggleExpand(vIdx) {
        vnets[vIdx].expanded = !vnets[vIdx].expanded;
        render();
    }

    // --- Subnet Split / Join ---
    function splitSubnet(vIdx, sIdx) {
        var subnet = vnets[vIdx].subnets[sIdx];
        var p = parseCidr(subnet.cidr);
        var newPrefix = p.prefix + 1;
        if (newPrefix > AZURE_MIN_PREFIX) {
            showToast("Cannot split further \u2014 minimum /" + AZURE_MIN_PREFIX);
            return;
        }
        pushUndo();
        var newSize = Math.pow(2, 32 - newPrefix);
        var first = longToIp(p.network) + '/' + newPrefix;
        var second = longToIp((p.network + newSize) >>> 0) + '/' + newPrefix;
        vnets[vIdx].subnets.splice(sIdx, 1,
            { cidr: first, name: subnet.name, colour: subnet.colour },
            { cidr: second, name: '', colour: nextSubnetColour() }
        );
        render();
    }

    function joinBlock(vIdx, blockNetwork, prefix) {
        var subs = vnets[vIdx].subnets;
        var mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
        var startIdx = -1;
        var count = 0;
        var firstName = '', firstColour = '';
        for (var i = 0; i < subs.length; i++) {
            var sp = parseCidr(subs[i].cidr);
            if (((sp.network & mask) >>> 0) === blockNetwork) {
                if (startIdx === -1) {
                    startIdx = i;
                    firstColour = subs[i].colour;
                }
                if (!firstName && subs[i].name) firstName = subs[i].name;
                count++;
            }
        }
        if (startIdx === -1 || count < 2) return;
        pushUndo();
        var parentCidr = longToIp(blockNetwork) + '/' + prefix;
        vnets[vIdx].subnets.splice(startIdx, count,
            { cidr: parentCidr, name: firstName, colour: firstColour }
        );
        render();
    }

    // --- Subnet Name Modal ---
    function openSubnetModal(vIdx, sIdx) {
        subnetModalVnet = vIdx;
        subnetModalSubnet = sIdx;
        document.getElementById('modalSubnetName').value = vnets[vIdx].subnets[sIdx].name;
        document.getElementById('nameModal').style.display = 'flex';
        document.getElementById('modalSubnetName').focus();
    }
    function saveSubnetModal() {
        if (subnetModalVnet !== null && subnetModalSubnet !== null) {
            pushUndo();
            vnets[subnetModalVnet].subnets[subnetModalSubnet].name = document.getElementById('modalSubnetName').value.trim();
        }
        closeSubnetModal();
        render();
    }
    function closeSubnetModal() {
        document.getElementById('nameModal').style.display = 'none';
        subnetModalVnet = null;
        subnetModalSubnet = null;
    }

    // --- Azure Preset ---
    function populatePresets() {
        var select = document.getElementById('azurePreset');
        while (select.options.length > 1) select.remove(1);
        AZURE_WELL_KNOWN_SUBNETS.forEach(function (s) {
            var opt = document.createElement('option');
            opt.value = JSON.stringify(s);
            opt.textContent = s.name + " (/" + s.recommendedCidr + ") \u2014 " + s.note;
            select.appendChild(opt);
        });
    }

    function addAzurePreset(value) {
        if (!value) return;

        // Find the first expanded VNet
        var vIdx = -1;
        for (var i = 0; i < vnets.length; i++) {
            if (vnets[i].expanded) { vIdx = i; break; }
        }
        if (vIdx === -1) {
            showToast("Expand a VNet first to add a preset subnet into it.");
            document.getElementById('azurePreset').value = '';
            return;
        }

        var preset = JSON.parse(value);
        var desiredSize = Math.pow(2, 32 - preset.recommendedCidr);
        var subs = vnets[vIdx].subnets;

        var targetIdx = -1;
        for (var j = 0; j < subs.length; j++) {
            var p = parseCidr(subs[j].cidr);
            if (!subs[j].name && p.totalIPs >= desiredSize) {
                targetIdx = j;
                break;
            }
        }

        if (targetIdx === -1) {
            showToast("No unnamed subnet large enough in " + vnets[vIdx].name);
            document.getElementById('azurePreset').value = '';
            return;
        }

        pushUndo();
        while (parseCidr(subs[targetIdx].cidr).prefix < preset.recommendedCidr) {
            var sp = parseCidr(subs[targetIdx].cidr);
            var newPrefix = sp.prefix + 1;
            var newSize = Math.pow(2, 32 - newPrefix);
            var first = longToIp(sp.network) + '/' + newPrefix;
            var second = longToIp((sp.network + newSize) >>> 0) + '/' + newPrefix;
            subs.splice(targetIdx, 1,
                { cidr: first, name: subs[targetIdx].name, colour: subs[targetIdx].colour },
                { cidr: second, name: '', colour: nextSubnetColour() }
            );
        }
        subs[targetIdx].name = preset.name;
        render();
        document.getElementById('azurePreset').value = '';
        showToast("Added " + preset.name + " to " + vnets[vIdx].name);
    }

    // --- Export / Import ---
    function exportJSON() {
        var data = { version: 1, exportDate: new Date().toISOString(), source: "Platform Designer", addressSpace: addressSpace, vnets: vnets };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'azure-platform-design.json';
        a.click();
        showToast("Exported");
    }

    function importJSON() {
        document.getElementById('importFile').click();
    }

    function handleImport(event) {
        var file = event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                var data = JSON.parse(e.target.result);

                if (data.vnets && Array.isArray(data.vnets)) {
                    // Platform format
                    pushUndo();
                    addressSpace = data.addressSpace || '';
                    document.getElementById('addressSpaceInput').value = addressSpace;
                    vnets.length = 0; // Clear existing before import
                    data.vnets.forEach(function (v) {
                        // Assign colours if missing
                        v.colour = v.colour || nextVnetColour();
                        v.expanded = v.expanded !== undefined ? v.expanded : false;
                        v.region = v.region || '';
                        v.subscriptionName = v.subscriptionName || '';

                        if (!v.subnets || v.subnets.length === 0) {
                            v.subnets = [{ cidr: v.cidr, name: '', colour: nextSubnetColour() }];
                        } else {
                            v.subnets.forEach(function (s) {
                                s.colour = s.colour || nextSubnetColour();
                            });

                            // Check if there are gaps — fill unallocated space
                            v.subnets = fillGaps(v.cidr, v.subnets);
                        }

                        vnets.push(v);
                    });
                    render();
                    showToast("Imported " + data.vnets.length + " VNet(s)");
                } else if (data.vnetCidr && data.subnets) {
                    // Single VNet format (legacy import support)
                    pushUndo();
                    vnets.length = 0; // Clear existing before import
                    var vnet = {
                        name: 'Imported VNet',
                        cidr: data.vnetCidr,
                        region: '',
                        subscriptionName: '',
                        colour: nextVnetColour(),
                        expanded: true,
                        subnets: data.subnets
                    };
                    vnet.subnets.forEach(function (s) {
                        s.colour = s.colour || nextSubnetColour();
                    });
                    vnets.push(vnet);
                    render();
                    showToast("Imported single VNet");
                } else {
                    throw new Error("Unrecognised format");
                }
            } catch (err) {
                showToast("Import failed: " + err.message);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    }

    function fillGaps(vnetCidr, existingSubnets) {
        // Sort subnets by network address
        var sorted = existingSubnets.slice().sort(function (a, b) {
            return parseCidr(a.cidr).network - parseCidr(b.cidr).network;
        });

        var vnet = parseCidr(vnetCidr);
        var result = [];
        var cursor = vnet.network;

        sorted.forEach(function (s) {
            var sp = parseCidr(s.cidr);
            if (sp.network > cursor) {
                // Fill the gap with appropriately sized blocks
                var gapBlocks = fillRange(cursor, sp.network);
                gapBlocks.forEach(function (gb) { result.push(gb); });
            }
            result.push(s);
            cursor = sp.broadcast + 1;
        });

        // Fill remaining space after last subnet
        if (cursor <= vnet.broadcast) {
            var remaining = fillRange(cursor, vnet.broadcast + 1);
            remaining.forEach(function (rb) { result.push(rb); });
        }

        return result;
    }

    function fillRange(startIP, endIP) {
        var blocks = [];
        var current = startIP;
        while (current < endIP) {
            var maxSize = endIP - current;
            // Find largest power of 2 that fits and aligns
            var prefix = 32;
            for (var p = 1; p <= 32; p++) {
                var size = Math.pow(2, 32 - p);
                if (size <= maxSize && (current % size) === 0) {
                    prefix = p;
                    break;
                }
            }
            blocks.push({
                cidr: longToIp(current) + '/' + prefix,
                name: '',
                colour: nextSubnetColour()
            });
            current = current + Math.pow(2, 32 - prefix);
        }
        return blocks;
    }

    function copyMarkdown() {
        if (vnets.length === 0) { showToast("No VNets"); return; }
        var md = '# AZ Network Design\n\n';
        md += '**Exported:** ' + new Date().toLocaleString() + '\n\n';
        if (addressSpace) {
            var asp = parseCidr(addressSpace);
            var totalVnetIPs = vnets.reduce(function (s, v) { return s + parseCidr(v.cidr).totalIPs; }, 0);
            var freeIPs = asp.totalIPs - totalVnetIPs;
            var allocPct = asp.totalIPs > 0 ? Math.round((totalVnetIPs / asp.totalIPs) * 100) : 0;
            md += '**Platform Address Space:** ' + addressSpace + ' (' + asp.totalIPs.toLocaleString() + ' IPs)  \n';
            md += '**VNet Allocated:** ' + totalVnetIPs.toLocaleString() + ' IPs (' + allocPct + '%) | **Free:** ' + freeIPs.toLocaleString() + ' IPs\n\n';
        }
        vnets.forEach(function (v) {
            var vp = parseCidr(v.cidr);
            var allocatedIPs = v.subnets
                .filter(function (s) { return s.name; })
                .reduce(function (sum, s) { return sum + parseCidr(s.cidr).totalIPs; }, 0);
            var utilPct = vp.totalIPs > 0 ? Math.round((allocatedIPs / vp.totalIPs) * 100) : 0;

            md += "## " + v.name + " (" + v.cidr + ")";
            if (v.region) md += " — " + v.region;
            md += "\n\n";
            md += "**Utilisation:** " + allocatedIPs.toLocaleString() + " / " + vp.totalIPs.toLocaleString() + " IPs allocated (" + utilPct + "%)\n\n";
            md += "| Name | CIDR | Range | Total | Usable |\n";
            md += "|------|------|-------|-------|--------|\n";
            v.subnets.forEach(function (s) {
                var p = parseCidr(s.cidr);
                var label = s.name || '*(Unallocated)*';
                md += "| " + label + " | " + s.cidr + " | " + ipRange(s.cidr) + " | " + p.totalIPs + " | " + usableIPs(s.cidr) + " |\n";
            });
            md += "\n";
        });
        navigator.clipboard.writeText(md).then(function () { showToast("Markdown copied"); });
    }

    function copyHTML() {
        if (vnets.length === 0) { showToast("No VNets"); return; }

        var styles = 'font-family:Calibri,Arial,sans-serif;font-size:10pt;border-collapse:collapse;';
        var thStyle = 'background:#0078d4;color:#fff;padding:6px 10px;border:1px solid #005a9e;text-align:left;font-size:10pt;';
        var tdStyle = 'padding:5px 10px;border:1px solid #ccc;font-size:10pt;';
        var vnetStyle = 'padding:6px 10px;border:1px solid #0078d4;font-size:10pt;font-weight:bold;background:#e8f4fd;';

        var html = '<h1 style="font-family:Calibri,Arial,sans-serif;color:#0078d4;">AZ Network Design</h1>';
        html += '<p style="font-family:Calibri,Arial,sans-serif;font-size:10pt;color:#666;">Exported: ' + new Date().toLocaleString() + '</p>';
        if (addressSpace) {
            var asp = parseCidr(addressSpace);
            var totalVnetIPs = vnets.reduce(function (s, v) { return s + parseCidr(v.cidr).totalIPs; }, 0);
            var freeIPs = asp.totalIPs - totalVnetIPs;
            var allocPct = asp.totalIPs > 0 ? Math.round((totalVnetIPs / asp.totalIPs) * 100) : 0;
            html += '<p style="font-family:Calibri,Arial,sans-serif;font-size:10pt;"><strong>Platform Address Space:</strong> ' + addressSpace + ' (' + asp.totalIPs.toLocaleString() + ' IPs)<br>';
            html += '<strong>VNet Allocated:</strong> ' + totalVnetIPs.toLocaleString() + ' IPs (' + allocPct + '%) | <strong>Free:</strong> ' + freeIPs.toLocaleString() + ' IPs</p>';
        }

        vnets.forEach(function (v) {
            var vp = parseCidr(v.cidr);
            var allocatedIPs = v.subnets
                .filter(function (s) { return s.name; })
                .reduce(function (sum, s) { return sum + parseCidr(s.cidr).totalIPs; }, 0);
            var utilPct = vp.totalIPs > 0 ? Math.round((allocatedIPs / vp.totalIPs) * 100) : 0;

            html += '<h2 style="font-family:Calibri,Arial,sans-serif;color:#0078d4;margin-top:18px;">' + v.name + ' (' + v.cidr + ')';
            if (v.region) html += ' \u2014 ' + v.region;
            html += '</h2>';
            html += '<p style="font-family:Calibri,Arial,sans-serif;font-size:10pt;"><strong>Utilisation:</strong> ' + allocatedIPs.toLocaleString() + ' / ' + vp.totalIPs.toLocaleString() + ' IPs allocated (' + utilPct + '%)</p>';

            html += '<table style="' + styles + '">';
            html += '<tr>';
            ['Name', 'CIDR', 'Range', 'Total IPs', 'Usable (Azure)'].forEach(function (h) {
                html += '<th style="' + thStyle + '">' + h + '</th>';
            });
            html += '</tr>';

            v.subnets.forEach(function (s) {
                var p = parseCidr(s.cidr);
                var label = s.name || 'Unallocated';
                var rowStyle = s.name ? '' : 'color:#999;font-style:italic;';
                var colourDot = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + s.colour + ';margin-right:6px;"></span>';
                html += '<tr>';
                html += '<td style="' + tdStyle + rowStyle + '">' + colourDot + label + '</td>';
                html += '<td style="' + tdStyle + rowStyle + '">' + s.cidr + '</td>';
                html += '<td style="' + tdStyle + rowStyle + '">' + ipRange(s.cidr) + '</td>';
                html += '<td style="' + tdStyle + rowStyle + 'text-align:right;">' + p.totalIPs.toLocaleString() + '</td>';
                html += '<td style="' + tdStyle + rowStyle + 'text-align:right;">' + usableIPs(s.cidr).toLocaleString() + '</td>';
                html += '</tr>';
            });

            // Totals row (named subnets only)
            var totalIPs = v.subnets.filter(function (s) { return s.name; }).reduce(function (sum, s) { return sum + parseCidr(s.cidr).totalIPs; }, 0);
            var totalUsable = v.subnets.filter(function (s) { return s.name; }).reduce(function (sum, s) { return sum + usableIPs(s.cidr); }, 0);
            html += '<tr style="font-weight:bold;background:#f5f5f5;">';
            html += '<td style="' + tdStyle + '" colspan="3">Total (named subnets)</td>';
            html += '<td style="' + tdStyle + 'text-align:right;">' + totalIPs.toLocaleString() + '</td>';
            html += '<td style="' + tdStyle + 'text-align:right;">' + totalUsable.toLocaleString() + '</td>';
            html += '</tr>';

            html += '</table>';
        });

        // Use a hidden rendered div + execCommand to get rich HTML on clipboard
        var container = document.createElement('div');
        container.innerHTML = html;
        container.style.position = 'fixed';
        container.style.left = '-9999px';
        container.style.top = '0';
        container.style.opacity = '0';
        document.body.appendChild(container);

        var range = document.createRange();
        range.selectNodeContents(container);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        try {
            document.execCommand('copy');
            showToast("Copied \u2014 paste into Word");
        } catch (e) {
            // Fallback: open in new window for manual copy
            var w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
            showToast("Opened in new tab \u2014 select all and copy");
        }

        sel.removeAllRanges();
        document.body.removeChild(container);
    }

    function resetAll() {
        if (!confirm("Reset everything?")) return;
        addressSpace = '';
        document.getElementById('addressSpaceInput').value = '';
        vnets = [];
        undoStack = [];
        vnetColourIdx = 0;
        subnetColourIdx = 0;
        render();
        showToast("Reset");
    }

    // --- Overlap Detection ---
    function checkOverlaps() {
        var warnings = [];
        for (var i = 0; i < vnets.length; i++) {
            for (var j = i + 1; j < vnets.length; j++) {
                if (rangesOverlap(vnets[i].cidr, vnets[j].cidr)) {
                    warnings.push(vnets[i].name + " (" + vnets[i].cidr + ") overlaps with " + vnets[j].name + " (" + vnets[j].cidr + ")");
                }
            }
        }
        // Check VNets fit within address space
        if (addressSpace) {
            var asp = parseCidr(addressSpace);
            for (var k = 0; k < vnets.length; k++) {
                var vp = parseCidr(vnets[k].cidr);
                if (vp.network < asp.network || vp.broadcast > asp.broadcast) {
                    warnings.push(vnets[k].name + " (" + vnets[k].cidr + ") is outside address space " + addressSpace);
                }
            }
        }
        return warnings;
    }

    // --- Rendering ---
    function render() {
        renderOverlaps();
        renderPlatformBar();
        renderTable();
        renderSummary();
        saveToLocalStorage();
        // Auto-expand help when there's nothing to show
        var helpDetails = document.querySelector('#helpSection details');
        if (helpDetails) helpDetails.open = (vnets.length === 0);
        // Show rebase warning badge only when there are VNets to rebase
        var rebaseHint = document.getElementById('rebaseHint');
        if (rebaseHint) rebaseHint.style.display = (vnets.length > 0 && addressSpace) ? 'inline-block' : 'none';
    }

    function renderOverlaps() {
        var div = document.getElementById('overlapWarnings');
        var warnings = checkOverlaps();
        if (warnings.length === 0) {
            div.innerHTML = '';
            return;
        }
        div.innerHTML = '<div class="overlap-box">' +
            '<strong>\u26A0\uFE0F Address Space Overlaps Detected:</strong><ul>' +
            warnings.map(function (w) { return '<li>' + w + '</li>'; }).join('') +
            '</ul></div>';
    }

    function renderPlatformBar() {
        var bar = document.getElementById('platformBar');
        bar.innerHTML = '';

        if (!addressSpace) {
            if (vnets.length === 0) {
                bar.innerHTML = '<div class="empty-bar">Set a platform address space and add VNets to start</div>';
            } else {
                // No supernet — just show equal-sized VNet blocks
                vnets.forEach(function (v, vIdx) {
                    var block = document.createElement('div');
                    block.className = 'platform-block';
                    block.style.backgroundColor = v.colour;
                    block.style.flex = '1';
                    block.title = v.name + '\n' + v.cidr + '\n' + (v.region || '');
                    block.textContent = v.name;
                    block.addEventListener('click', function () { toggleExpand(vIdx); });
                    bar.appendChild(block);
                });
            }
            return;
        }

        // With address space — show proportional blocks with free gaps
        var asp = parseCidr(addressSpace);
        var sorted = vnets.slice().sort(function (a, b) {
            return parseCidr(a.cidr).network - parseCidr(b.cidr).network;
        });

        var cursor = asp.network;

        sorted.forEach(function (v) {
            var vp = parseCidr(v.cidr);
            var vIdx = vnets.indexOf(v);

            // Free gap before this VNet
            if (vp.network > cursor) {
                var gapIPs = vp.network - cursor;
                var gapPct = (gapIPs / asp.totalIPs) * 100;
                var gapBlock = document.createElement('div');
                gapBlock.className = 'platform-block platform-free';
                gapBlock.style.flex = gapPct + '';
                gapBlock.title = 'Free: ' + longToIp(cursor) + ' \u2013 ' + longToIp(vp.network - 1) + ' (' + gapIPs.toLocaleString() + ' IPs)';
                gapBlock.textContent = gapIPs >= 256 ? gapIPs.toLocaleString() + ' free' : '';
                bar.appendChild(gapBlock);
            }

            // VNet block
            var pct = (vp.totalIPs / asp.totalIPs) * 100;
            var block = document.createElement('div');
            block.className = 'platform-block';
            block.style.backgroundColor = v.colour;
            block.style.flex = pct + '';
            block.title = v.name + '\n' + v.cidr + '\n' + (v.region || '');
            block.textContent = v.name;
            block.addEventListener('click', function () { toggleExpand(vIdx); });
            bar.appendChild(block);

            cursor = vp.broadcast + 1;
        });

        // Free space after last VNet
        if (cursor <= asp.broadcast) {
            var tailIPs = asp.broadcast - cursor + 1;
            var tailPct = (tailIPs / asp.totalIPs) * 100;
            var tailBlock = document.createElement('div');
            tailBlock.className = 'platform-block platform-free';
            tailBlock.style.flex = tailPct + '';
            tailBlock.title = 'Free: ' + longToIp(cursor) + ' \u2013 ' + longToIp(asp.broadcast) + ' (' + tailIPs.toLocaleString() + ' IPs)';
            tailBlock.textContent = tailIPs >= 256 ? tailIPs.toLocaleString() + ' free' : '';
            bar.appendChild(tailBlock);
        }
    }

    function computeJoinTree(subs, vnetCidr) {
        var vnetPrefix = parseCidr(vnetCidr).prefix;
        var deepestPrefix = vnetPrefix;
        subs.forEach(function (s) {
            var p = parseCidr(s.cidr).prefix;
            if (p > deepestPrefix) deepestPrefix = p;
        });

        var joinColumns = [];
        if (subs.length > 1) {
            for (var jp = deepestPrefix - 1; jp >= vnetPrefix; jp--) {
                joinColumns.push(jp);
            }
        }

        var cellMap = {};
        joinColumns.forEach(function (P) {
            var mask = (0xFFFFFFFF << (32 - P)) >>> 0;
            var groups = [];
            var currentBlockNet = null;
            var currentGroup = null;

            subs.forEach(function (s, row) {
                var sp = parseCidr(s.cidr);
                var blockNet = (sp.network & mask) >>> 0;
                if (blockNet !== currentBlockNet) {
                    if (currentGroup) groups.push(currentGroup);
                    currentBlockNet = blockNet;
                    currentGroup = { blockNet: blockNet, rows: [row] };
                } else {
                    currentGroup.rows.push(row);
                }
            });
            if (currentGroup) groups.push(currentGroup);

            groups.forEach(function (g) {
                if (g.rows.length < 2) return;
                g.rows.forEach(function (row, i) {
                    var type;
                    if (i === 0) type = 'top';
                    else if (i === g.rows.length - 1) type = 'bottom';
                    else type = 'mid';
                    cellMap[row + ',' + P] = { type: type, clickable: true, blockNet: g.blockNet };
                });
            });
        });

        return { joinColumns: joinColumns, cellMap: cellMap };
    }

    // --- Example Data ---
    function loadExample() {
        pushUndo();
        var example = {
            addressSpace: '10.0.0.0/8',
            vnets: [
                {
                    name: 'vnet-connectivity-uksouth',
                    cidr: '10.0.0.0/22',
                    region: 'uksouth',
                    subscriptionName: 'Connectivity',
                    subnets: [
                        { name: 'AzureFirewallSubnet',          cidr: '10.0.0.0/26'  },
                        { name: 'AzureFirewallManagementSubnet',cidr: '10.0.0.64/26' },
                        { name: 'GatewaySubnet',                cidr: '10.0.0.128/27' },
                        { name: 'AzureBastionSubnet',           cidr: '10.0.0.160/26' },
                        { name: 'snet-dns-resolver-inbound',    cidr: '10.0.0.224/28' },
                        { name: 'snet-dns-resolver-outbound',   cidr: '10.0.0.240/28' },
                        { name: 'snet-network-management',      cidr: '10.0.1.0/24'  },
                        { name: 'snet-private-endpoints',       cidr: '10.0.2.0/24'  }
                    ]
                },
                {
                    name: 'vnet-identity-uksouth',
                    cidr: '10.1.0.0/24',
                    region: 'uksouth',
                    subscriptionName: 'Identity',
                    subnets: [
                        { name: 'snet-domain-controllers', cidr: '10.1.0.0/27' },
                        { name: 'snet-private-endpoints',  cidr: '10.1.0.32/27' }
                    ]
                },
                {
                    name: 'vnet-management-uksouth',
                    cidr: '10.2.0.0/24',
                    region: 'uksouth',
                    subscriptionName: 'Management',
                    subnets: [
                        { name: 'snet-monitoring',         cidr: '10.2.0.0/26'  },
                        { name: 'snet-automation',         cidr: '10.2.0.64/26' },
                        { name: 'snet-private-endpoints',  cidr: '10.2.0.128/26' }
                    ]
                },
                {
                    name: 'vnet-alz-corp-01-uksouth',
                    cidr: '10.10.0.0/22',
                    region: 'uksouth',
                    subscriptionName: 'Corp Landing Zone 01',
                    subnets: [
                        { name: 'snet-app-frontend',      cidr: '10.10.0.0/25'  },
                        { name: 'snet-app-backend',       cidr: '10.10.0.128/25' },
                        { name: 'snet-data',              cidr: '10.10.1.0/25'  },
                        { name: 'snet-private-endpoints', cidr: '10.10.1.128/25' }
                    ]
                },
                {
                    name: 'vnet-alz-corp-02-uksouth',
                    cidr: '10.10.4.0/22',
                    region: 'uksouth',
                    subscriptionName: 'Corp Landing Zone 02',
                    subnets: [
                        { name: 'snet-app-frontend',      cidr: '10.10.4.0/25'  },
                        { name: 'snet-app-backend',       cidr: '10.10.4.128/25' },
                        { name: 'snet-private-endpoints', cidr: '10.10.5.0/24'  }
                    ]
                },
                {
                    name: 'vnet-alz-online-01-uksouth',
                    cidr: '10.20.0.0/22',
                    region: 'uksouth',
                    subscriptionName: 'Online Landing Zone 01',
                    subnets: [
                        { name: 'snet-app-gateway',        cidr: '10.20.0.0/25'  },
                        { name: 'snet-app-services',       cidr: '10.20.0.128/25' },
                        { name: 'snet-private-endpoints',  cidr: '10.20.1.0/25'  }
                    ]
                }
            ]
        };

        addressSpace = example.addressSpace;
        document.getElementById('addressSpaceInput').value = addressSpace;
        vnets.length = 0;
        example.vnets.forEach(function (v) {
            v.colour = nextVnetColour();
            v.expanded = false;
            v.additionalCidrs = [];
            v.subnets.forEach(function (s) { s.colour = nextSubnetColour(); });
            v.subnets = fillGaps(v.cidr, v.subnets);
            vnets.push(v);
        });
        render();
        showToast('Example platform loaded');
    }

    function renderTable() {
        var tbody = document.getElementById('platformTableBody');
        tbody.innerHTML = '';

        if (vnets.length === 0) {
            var colspan = 10;
            var emptyRow = document.createElement('tr');
            var emptyTd = document.createElement('td');
            emptyTd.setAttribute('colspan', colspan);
            emptyTd.className = 'empty-state-cell';
            emptyTd.innerHTML =
                '<div class="empty-state">' +
                    '<p class="empty-state-title">No VNets</p>' +
                    '<p class="empty-state-hint">Get started by adding a VNet, importing a JSON file, or loading an example platform.</p>' +
                    '<div class="empty-state-actions">' +
                        '<button class="empty-btn primary" onclick="platform.addVnet()">&#x2795; Add VNet</button>' +
                        '<button class="empty-btn" onclick="platform.importJSON()">&#x1F4E5; Import JSON</button>' +
                        '<button class="empty-btn" onclick="platform.loadExample()">&#x1F9EA; Load Example</button>' +
                    '</div>' +
                '</div>';
            emptyRow.appendChild(emptyTd);
            tbody.appendChild(emptyRow);
            return;
        }

        vnets.forEach(function (vnet, vIdx) {
            // VNet header row
            var vnetRow = document.createElement('tr');
            vnetRow.className = 'vnet-row';

            // Expand toggle
            var tdExpand = document.createElement('td');
            tdExpand.className = 'expand-col';
            var arrow = document.createElement('span');
            arrow.className = 'expand-arrow';
            arrow.textContent = vnet.expanded ? '\u25BC' : '\u25B6';
            arrow.addEventListener('click', function () { toggleExpand(vIdx); });
            tdExpand.appendChild(arrow);
            vnetRow.appendChild(tdExpand);

            // Colour
            var tdColour = document.createElement('td');
            var swatch = document.createElement('span');
            swatch.className = 'colour-swatch';
            swatch.style.backgroundColor = vnet.colour;
            tdColour.appendChild(swatch);
            vnetRow.appendChild(tdColour);

            // Name
            var tdName = document.createElement('td');
            tdName.className = 'vnet-name-cell';
            tdName.textContent = vnet.name;
            tdName.colSpan = 1;
            vnetRow.appendChild(tdName);

            // CIDR
            var tdCidr = document.createElement('td');
            tdCidr.textContent = vnet.cidr;
            vnetRow.appendChild(tdCidr);

            // Range
            var tdRange = document.createElement('td');
            tdRange.textContent = ipRange(vnet.cidr);
            vnetRow.appendChild(tdRange);

            // Total
            var vp = parseCidr(vnet.cidr);
            var tdTotal = document.createElement('td');
            tdTotal.textContent = vp.totalIPs.toLocaleString();
            vnetRow.appendChild(tdTotal);

            // Usable - sum of all subnets (each loses 5 Azure reserved IPs)
            var vUsable = vnet.subnets
                .reduce(function (sum, s) { return sum + usableIPs(s.cidr); }, 0);
            var tdUsable = document.createElement('td');
            tdUsable.textContent = vUsable.toLocaleString();
            vnetRow.appendChild(tdUsable);

            // Utilisation bar
            var tdUtil = document.createElement('td');
            tdUtil.className = 'util-cell';
            var allocatedIPs = vnet.subnets
                .filter(function (s) { return s.name; })
                .reduce(function (sum, s) { return sum + parseCidr(s.cidr).totalIPs; }, 0);
            var utilPct = vp.totalIPs > 0 ? Math.round((allocatedIPs / vp.totalIPs) * 100) : 0;

            var utilBar = document.createElement('div');
            utilBar.className = 'util-bar';
            utilBar.title = allocatedIPs.toLocaleString() + ' / ' + vp.totalIPs.toLocaleString() + ' IPs allocated (' + utilPct + '%)';

            // Build segments from subnets in order
            vnet.subnets.forEach(function (s) {
                var sp = parseCidr(s.cidr);
                var pct = (sp.totalIPs / vp.totalIPs) * 100;
                if (pct < 0.3) pct = 0.3; // min visible width
                var seg = document.createElement('div');
                seg.className = 'util-seg' + (s.name ? ' util-named' : ' util-free');
                seg.style.width = pct + '%';
                if (s.name) {
                    seg.style.backgroundColor = s.colour;
                    seg.title = s.name + ' (' + s.cidr + ')';
                } else {
                    seg.title = 'Unallocated (' + s.cidr + ')';
                }
                utilBar.appendChild(seg);
            });

            tdUtil.appendChild(utilBar);

            var utilLabel = document.createElement('span');
            utilLabel.className = 'util-label';
            utilLabel.textContent = utilPct + '% allocated';
            tdUtil.appendChild(utilLabel);

            vnetRow.appendChild(tdUtil);

            // Region
            var tdRegion = document.createElement('td');
            tdRegion.textContent = vnet.region || '';
            vnetRow.appendChild(tdRegion);

            // Actions
            var tdActions = document.createElement('td');
            tdActions.style.whiteSpace = 'nowrap';

            var editBtn = document.createElement('button');
            editBtn.textContent = '\u270F\uFE0F';
            editBtn.title = 'Edit VNet';
            editBtn.style.padding = '2px 6px';
            editBtn.style.fontSize = '0.75rem';
            editBtn.style.marginRight = '4px';
            (function (idx) { editBtn.addEventListener('click', function () { editVnet(idx); }); })(vIdx);
            tdActions.appendChild(editBtn);

            var delBtn = document.createElement('button');
            delBtn.textContent = '\u2716';
            delBtn.title = 'Remove VNet';
            delBtn.style.padding = '2px 6px';
            delBtn.style.fontSize = '0.75rem';
            delBtn.style.background = '#d83b01';
            delBtn.style.borderColor = '#d83b01';
            (function (idx) { delBtn.addEventListener('click', function () { removeVnet(idx); }); })(vIdx);
            tdActions.appendChild(delBtn);

            vnetRow.appendChild(tdActions);
            tbody.appendChild(vnetRow);

            // Subnet rows (if expanded)
            if (vnet.expanded) {
                var tree = computeJoinTree(vnet.subnets, vnet.cidr);

                vnet.subnets.forEach(function (subnet, sIdx) {
                    var sp = parseCidr(subnet.cidr);
                    var tr = document.createElement('tr');
                    tr.className = 'subnet-row';

                    // Expand col (empty indent)
                    var tdE = document.createElement('td');
                    tdE.className = 'expand-col subnet-indent';
                    tr.appendChild(tdE);

                    // Colour
                    var tdC = document.createElement('td');
                    var sw = document.createElement('span');
                    sw.className = 'colour-swatch';
                    sw.style.backgroundColor = subnet.colour;
                    tdC.appendChild(sw);
                    tr.appendChild(tdC);

                    // Name (clickable)
                    var tdN = document.createElement('td');
                    tdN.className = 'name-cell';
                    var ns = document.createElement('span');
                    ns.className = 'subnet-name' + (subnet.name ? '' : ' unnamed');
                    ns.textContent = subnet.name || '(click to name)';
                    tdN.appendChild(ns);
                    (function (vi, si) { tdN.addEventListener('click', function () { openSubnetModal(vi, si); }); })(vIdx, sIdx);
                    tr.appendChild(tdN);

                    // CIDR
                    var tdCi = document.createElement('td');
                    tdCi.textContent = subnet.cidr;
                    tr.appendChild(tdCi);

                    // Range
                    var tdR = document.createElement('td');
                    tdR.textContent = ipRange(subnet.cidr);
                    tr.appendChild(tdR);

                    // Total
                    var tdT = document.createElement('td');
                    tdT.textContent = sp.totalIPs.toLocaleString();
                    tr.appendChild(tdT);

                    // Usable
                    var tdU = document.createElement('td');
                    var u = usableIPs(subnet.cidr);
                    tdU.textContent = u.toLocaleString();
                    if (u <= 0) tdU.innerHTML += ' <span class="error-badge">Too small</span>';
                    else if (u <= 8) tdU.innerHTML += ' <span class="warning-badge">Small</span>';
                    tr.appendChild(tdU);

                    // Utilisation (empty for subnets)
                    var tdUtilS = document.createElement('td');
                    tr.appendChild(tdUtilS);

                    // Region (empty for subnets)
                    var tdReg = document.createElement('td');
                    tr.appendChild(tdReg);

                    // Divide
                    var tdDiv = document.createElement('td');
                    tdDiv.style.whiteSpace = 'nowrap';
                    if (sp.prefix < AZURE_MIN_PREFIX) {
                        var divLink = document.createElement('a');
                        divLink.href = '#';
                        divLink.className = 'divide-link';
                        divLink.textContent = 'Divide';
                        (function (vi, si) {
                            divLink.addEventListener('click', function (e) { e.preventDefault(); splitSubnet(vi, si); });
                        })(vIdx, sIdx);
                        tdDiv.appendChild(divLink);
                    }
                    tr.appendChild(tdDiv);

                    tbody.appendChild(tr);

                    // Add join cells to the row
                    tree.joinColumns.forEach(function (P) {
                        var joinTd = document.createElement('td');
                        joinTd.className = 'join-cell';
                        var info = tree.cellMap[sIdx + ',' + P];
                        if (info) {
                            var bracket = document.createElement('div');
                            bracket.className = 'join-bracket join-' + info.type;
                            if (info.clickable) {
                                bracket.classList.add('join-clickable');
                                bracket.title = 'Join into /' + P;
                                (function (vi, bn, pf) {
                                    bracket.addEventListener('click', function () { joinBlock(vi, bn, pf); });
                                })(vIdx, info.blockNet, P);
                            }
                            joinTd.appendChild(bracket);
                        }
                        tr.appendChild(joinTd);
                    });
                });
            }
        });
    }

    function renderSummary() {
        var content = document.getElementById('summaryContent');
        if (vnets.length === 0 && !addressSpace) {
            content.innerHTML = '';
            return;
        }

        var totalVnets = vnets.length;
        var totalSubnets = vnets.reduce(function (s, v) { return s + v.subnets.filter(function (x) { return x.name; }).length; }, 0);
        var totalVnetIPs = vnets.reduce(function (s, v) { return s + parseCidr(v.cidr).totalIPs; }, 0);
        var totalUsable = vnets.reduce(function (s, v) {
            return s + v.subnets.filter(function (x) { return x.name; })
                .reduce(function (ss, x) { return ss + usableIPs(x.cidr); }, 0);
        }, 0);
        var overlaps = checkOverlaps().length;

        var html = '';

        // Address space stats
        if (addressSpace) {
            var asp = parseCidr(addressSpace);
            var freeIPs = asp.totalIPs - totalVnetIPs;
            var allocPct = asp.totalIPs > 0 ? Math.round((totalVnetIPs / asp.totalIPs) * 100) : 0;
            html += '<div class="stat"><span class="stat-label">Address Space</span><span class="stat-value">' + addressSpace + ' (' + asp.totalIPs.toLocaleString() + ' IPs)</span></div>';
            html += '<div class="stat"><span class="stat-label">VNet Allocated</span><span class="stat-value">' + totalVnetIPs.toLocaleString() + ' IPs (' + allocPct + '%)</span></div>';
            html += '<div class="stat"><span class="stat-label">Free (for new VNets)</span><span class="stat-value" style="color:' + (freeIPs > 0 ? '#107c10' : '#d83b01') + '">' + freeIPs.toLocaleString() + ' IPs</span></div>';
        }

        html += '<div class="stat"><span class="stat-label">VNets</span><span class="stat-value">' + totalVnets + '</span></div>';
        html += '<div class="stat"><span class="stat-label">Named Subnets</span><span class="stat-value">' + totalSubnets + '</span></div>';
        if (!addressSpace) {
            html += '<div class="stat"><span class="stat-label">Total Address Space</span><span class="stat-value">' + totalVnetIPs.toLocaleString() + ' IPs</span></div>';
        }
        html += '<div class="stat"><span class="stat-label">Total Usable (Azure)</span><span class="stat-value">' + totalUsable.toLocaleString() + '</span></div>';
        if (overlaps > 0) {
            html += '<div class="stat"><span class="stat-label">\u26A0 Overlaps</span><span class="stat-value" style="color:#d83b01">' + overlaps + '</span></div>';
        }

        content.innerHTML = html;
    }

    // --- LocalStorage ---
    function saveToLocalStorage() {
        localStorage.setItem('az-visual-platform', JSON.stringify({ version: 1, addressSpace: addressSpace, vnets: vnets }));
    }
    function loadFromLocalStorage() {
        try {
            var raw = localStorage.getItem('az-visual-platform');
            if (!raw) return false;
            var data = JSON.parse(raw);
            if (!data.vnets) return false;
            addressSpace = data.addressSpace || '';
            vnets = data.vnets;
            vnetColourIdx = vnets.length;
            return true;
        } catch (e) { return false; }
    }

    // --- Toast ---
    function showToast(message) {
        var existing = document.querySelector('.toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 2600);
    }

    // --- Init ---
    function init() {
        populatePresets();

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeVnetModal();
                closeSubnetModal();
            }
            if (e.key === 'Enter') {
                if (document.getElementById('vnetModal').style.display === 'flex') saveVnetModal();
                else if (document.getElementById('nameModal').style.display === 'flex') saveSubnetModal();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                undo();
            }
        });

        if (!loadFromLocalStorage()) {
            vnets = [];
        }
        document.getElementById('addressSpaceInput').value = addressSpace;
        render();
    }

    document.addEventListener('DOMContentLoaded', init);

    return {
        addVnet: addVnet,
        setAddressSpace: setAddressSpace,
        saveVnetModal: saveVnetModal,
        closeVnetModal: closeVnetModal,
        saveSubnetModal: saveSubnetModal,
        closeSubnetModal: closeSubnetModal,
        addAzurePreset: addAzurePreset,
        exportJSON: exportJSON,
        importJSON: importJSON,
        handleImport: handleImport,
        copyMarkdown: copyMarkdown,
        copyHTML: copyHTML,
        resetAll: resetAll,
        undo: undo,
        loadExample: loadExample
    };
})();
