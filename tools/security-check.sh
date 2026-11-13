#!/usr/bin/env bash
# Quick security check of the deployed Worker.   Usage: ./security-check.sh https://your-worker.example.workers.dev https://your-site.example
# It only sends harmless requests. The login test uses a made-up username, so no real account gets locked.
API="${1:?Give the Worker URL}"; SITE="${2:-https://example.invalid}"
pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass+1)); }
bad() { echo "FAIL  $1"; fail=$((fail+1)); }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

c=$(code "$API/api/exams?lecturerId=x");                      [ "$c" = 401 ] && ok "lecturer route refuses a caller who is not logged in ($c)" || bad "GET /api/exams without a token answered $c (expected 401). Is SESSION_SECRET set?"
c=$(code "$API/api/scan-sessions?courseId=x");                [ "$c" = 401 ] && ok "scan list refuses a caller who is not logged in ($c)" || bad "GET /api/scan-sessions without a token answered $c (expected 401)"
c=$(code -H 'Authorization: Bearer not.a.token' "$API/api/exams?lecturerId=x"); [ "$c" = 401 ] && ok "a forged token is refused ($c)" || bad "forged token answered $c (expected 401)"

o=$(curl -s -D - -o /dev/null -H 'Origin: https://evil.example' "$API/api/programs" | tr -d '\r' | grep -i '^access-control-allow-origin' || true)
case "$o" in *evil.example*|*'*'*) bad "CORS allows other sites: $o";; *) ok "CORS does not allow a foreign site ($o)";; esac
o=$(curl -s -D - -o /dev/null -H "Origin: $SITE" "$API/api/programs" | tr -d '\r' | grep -i '^access-control-allow-origin' || true)
case "$o" in *"$SITE"*) ok "CORS allows your site";; *) bad "CORS does not allow your site ($o). Check ALLOWED_ORIGIN";; esac

u="check-$RANDOM$RANDOM"; last=0
for i in 1 2 3 4 5 6 7; do last=$(code -X POST -H 'Content-Type: application/json' -d "{\"identifier\":\"$u\",\"password\":\"wrong$i\"}" "$API/api/login"); done
[ "$last" = 429 ] && ok "repeated wrong passwords get locked (429)" || bad "7 wrong passwords still answered $last (expected 429)"

echo; echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
