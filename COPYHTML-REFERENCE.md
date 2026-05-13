# Copy for Word (copyHTML) — Working Implementation Reference

**DO NOT CHANGE THE COPY MECHANISM IN `copyHTML()` WITHOUT READING THIS FIRST.**

## What Works

The **only** approach that successfully copies rich formatted HTML to the clipboard (so it pastes as styled tables into Word) is:

```javascript
// 1. Create a hidden div (NOT contentEditable, NOT an iframe)
var container = document.createElement("div");
container.innerHTML = html;
container.style.position = "fixed";
container.style.left = "-9999px";
container.style.top = "0";
container.style.opacity = "0";
document.body.appendChild(container);

// 2. Select the rendered content using Range + Selection API
var range = document.createRange();
range.selectNodeContents(container);
var sel = window.getSelection();
sel.removeAllRanges();
sel.addRange(range);

// 3. Use execCommand('copy') — NOT the Clipboard API
try {
  document.execCommand("copy");
  showToast("Copied — paste into Word");
} catch (e) {
  var w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  showToast("Opened in new tab — select all and copy");
}

// 4. Clean up
sel.removeAllRanges();
document.body.removeChild(container);
```

## Critical Rules

1. **Use a plain `div`** — do NOT set `contentEditable = 'true'`
2. **Position off-screen** with `left: '-9999px'` and `opacity: '0'`
3. **Do NOT use `position: absolute`** — use `position: fixed`
4. **Do NOT use the Clipboard API** (`navigator.clipboard.write` / `ClipboardItem`) — it strips formatting
5. **Do NOT use an iframe** — `execCommand` fails inside iframes
6. **Do NOT set `width/height: 100%`** or `zIndex` tricks — keep it simple and off-screen
7. **Always use `document.execCommand('copy')`** — this is the only method that preserves rich HTML

## Approaches That FAILED

| Approach                                                 | Result                                        |
| -------------------------------------------------------- | --------------------------------------------- |
| `ClipboardItem` with `text/html` blob                    | Word pastes as plain text                     |
| `contentEditable = 'true'` div                           | Word pastes as plain text                     |
| iframe-based copy                                        | `execCommand` fails, falls back to new window |
| `position: absolute; left: -9999px`                      | Inconsistent results                          |
| Full-size div with `opacity: 0.01; zIndex: -1`           | Word pastes as plain text                     |
| `navigator.clipboard.write()` with stripped `text/plain` | Word pastes as plain text                     |

## Date Confirmed Working

**18 March 2026** — tested by pasting into Microsoft Word, tables render with blue headers, styled cells, colour dots, and totals rows.
