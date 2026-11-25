#!/usr/bin/env bash
# Serve a copy of the site wired to dev/mock_neon.py, with a small sample quiz.
# Open http://localhost:8000/host.html (PIN 2512) and http://localhost:8000/ (password snowball).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dev/_site && mkdir -p dev/_site
cp -r index.html host.html builder.html css js dev/_site/
sed -i.bak -E 's|connectionString: "postgresql://quiz_web:[^"]*"|connectionString: "postgresql://quiz_web:webpass@localhost/neondb", endpoint: "http://127.0.0.1:8790/sql"|' dev/_site/js/config.js && rm dev/_site/js/config.js.bak
cp dev/sample_questions.js dev/_site/js/questions.js
echo "Serving test site on http://localhost:8000/  (Ctrl+C to stop)"
cd dev/_site && python3 -m http.server 8000
