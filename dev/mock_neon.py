#!/usr/bin/env python3
"""Local stand-in for Neon's SQL-over-HTTP endpoint, for testing without touching LMK TESTING.

The quiz pages POST {"query", "params"} to https://<host>/sql with a
Neon-Connection-String header. This does the same against a local Postgres,
by running psql as the user named in that connection string.

  1. Local Postgres with the schema:
       createdb neondb
       psql -d neondb -c "create role quiz_web login password 'webpass'"
       psql -d neondb -f neon/schema.sql
       psql -d neondb -c "select quiz.setup('lmk26','snowball','2512')"
  2. python3 dev/mock_neon.py            (listens on http://127.0.0.1:8790/sql)
  3. dev/serve_test_site.sh              (serves a copy of the site wired to it)

Env: PGHOST (default localhost), PGPORT (5432), PGDATABASE (neondb), MOCK_PORT (8790).
"""
import json, os, re, subprocess, urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

PG = ["-h", os.environ.get("PGHOST", "localhost"), "-p", os.environ.get("PGPORT", "5432"), "-d", os.environ.get("PGDATABASE", "neondb")]

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        # like Neon: custom Neon-* headers allowed, Content-Type is NOT (the pages must not send it)
        self.send_header("Access-Control-Allow-Headers", "Neon-Connection-String, Neon-Raw-Text-Output, Neon-Array-Mode")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        cs = urllib.parse.urlparse(self.headers.get("Neon-Connection-String", "").replace("postgresql:", "http:"))
        q, params = body["query"], body.get("params", [])
        args = ["psql", *PG, "-U", cs.username, "-tA", "-v", "ON_ERROR_STOP=1"]
        def sub(m):
            i = int(m.group(1)) - 1
            if params[i] is None: return "NULL"
            args.extend(["-v", f"p{i}={params[i]}"]); return f":'p{i}'"
        sql = re.sub(r"\$(\d+)", sub, q)
        r = subprocess.run(args, input=sql + ";", capture_output=True, text=True, env={**os.environ, "PGPASSWORD": cs.password or ""})
        if r.returncode:
            msg = [l for l in r.stderr.splitlines() if l.startswith("ERROR:")]
            out = json.dumps({"message": (msg[0] if msg else r.stderr).replace("ERROR:  ", "")}).encode(); self.send_response(400)
        else:
            out = json.dumps({"fields": [{"name": "r"}], "rows": [[r.stdout.rstrip("\n")]]}).encode(); self.send_response(200)
        self.cors(); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(out)

port = int(os.environ.get("MOCK_PORT", "8790"))
print(f"mock Neon on http://127.0.0.1:{port}/sql")
ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
