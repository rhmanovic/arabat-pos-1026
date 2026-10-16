#!/bin/bash
# Opens the Arabat register on a Mac till with silent receipt printing (OPERATIONS.md §10).
#
# A web page cannot skip Chrome's print dialog; Chrome started with --kiosk-printing sends
# every window.print() straight to the default printer. A separate Chrome profile is used so
# the flag applies even while the everyday Chrome is open (sign in to the POS once in it).
#
# Usage: double-click (or `bash arabat-pos-till.command`). Override with
#   POS_URL=https://… PRINTER=… bash arabat-pos-till.command
set -euo pipefail

POS_URL="${POS_URL:-https://www.arabatapp.com/pos/}"
PRINTER="${PRINTER:-Printer_POS_80C}"
PROFILE="$HOME/Library/Application Support/ArabatPOS-Chrome"

if lpstat -p "$PRINTER" >/dev/null 2>&1; then
  # The receipt printer becomes the default printer of this Mac user.
  lpoptions -d "$PRINTER" >/dev/null
else
  echo "Printer $PRINTER not found; receipts will go to the current default printer."
fi

open -na "Google Chrome" --args \
  --user-data-dir="$PROFILE" \
  --kiosk-printing \
  --no-first-run \
  --app="$POS_URL"
