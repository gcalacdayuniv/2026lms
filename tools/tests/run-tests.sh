#!/bin/sh
# One command that checks the project before you upload:
#   sh tools/tests/run-tests.sh          syntax + Worker lint + Worker tests + tailwind.css up to date
#   sh tools/tests/run-tests.sh --phone  also opens the app in a phone-sized browser (needs: npm i playwright, then npx playwright install chromium)
# Needs Node 22 or newer. Stops at the first failure.
set -e
cd "$(dirname "$0")/../.."
echo "== 1/4 JavaScript syntax"
for f in js/*.js worker/*.js sw.js tailwind.config.js; do node --check "$f" 2>/dev/null || node --input-type=module --check < "$f" || { echo "syntax error in $f"; exit 1; }; done
echo "== 2/4 Worker lint (undefined names)"
npx --yes eslint@9 -c tools/tests/eslint.config.mjs worker
echo "== 3/4 Worker tests"
node tools/tests/worker.test.mjs
echo "== 4/4 tailwind.css up to date"
sh tools/build-css.sh --check
if [ "$1" = "--phone" ]; then echo "== phone check"; node tools/tests/phone-check.cjs; fi
echo "ALL CHECKS PASSED"
