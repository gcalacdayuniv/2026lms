#!/bin/sh
# Rebuilds tailwind.css from the classes used in index.html and js/*.js.
# Run it after adding or changing any Tailwind class, then upload tailwind.css with the rest.
#   sh tools/build-css.sh          rebuild tailwind.css
#   sh tools/build-css.sh --check  only check that tailwind.css is up to date (exit 1 if not)
set -e
cd "$(dirname "$0")/.."
OUT=tailwind.css
[ "$1" = "--check" ] && OUT=$(mktemp)
npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o "$OUT" --minify
if [ "$1" = "--check" ]; then
    if cmp -s "$OUT" tailwind.css; then echo "tailwind.css is up to date"; rm -f "$OUT"; else echo "tailwind.css is OUT OF DATE: run sh tools/build-css.sh"; rm -f "$OUT"; exit 1; fi
fi
