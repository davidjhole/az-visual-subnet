# Copilot Instructions for az-visual-subnet

## CRITICAL: Before modifying copyHTML()

**ALWAYS read `COPYHTML-REFERENCE.md` in the project root BEFORE making ANY changes to the `copyHTML()` function in `app.js`.**

This file documents the only working approach for copying rich formatted HTML to the clipboard for pasting into Microsoft Word. Multiple alternative approaches were tested and all failed. Do not deviate from the documented pattern.

## Project Overview

- Vanilla HTML/CSS/JS — no build tools, no frameworks
- Open `index.html` directly in a browser
- IIFE pattern: `const platform = (function(){...})()`
- Azure networking subnet designer with split/join, presets, import/export
