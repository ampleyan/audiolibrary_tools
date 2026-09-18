import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

CONFIG = "/config/config.yaml"


def build_import_args(path, nowrite, artist, title):
    args = ["import", "--singletons", "--quiet-fallback=asis"]
    if artist:
        args.extend(["--set", f"artist={artist}"])
    if title:
        args.extend(["--set", f"title={title}"])
    if nowrite:
        args.append("--nowrite")
    args.append(path)
    return args


def beet(*args):
    result = subprocess.run(
        ["beet", "--config", CONFIG, *args],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0, result.stdout + result.stderr


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != "/import":
            self.send_json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        path = body.get("path", "").strip()
        if not path or not os.path.exists(path):
            self.send_json(400, {"error": f"path not found: {path}"})
            return
        artist = body.get("artist", "").strip()
        title = body.get("title", "").strip()
        ok, output = beet(*build_import_args(path, body.get("nowrite"), artist, title))
        paths = []
        if ok and artist and title:
            listed, listing = beet("ls", "-p", f"artist:{artist}", f"title:{title}")
            if listed:
                paths = [line.strip() for line in listing.splitlines() if line.strip()]
        self.send_json(200 if ok else 500, {"ok": ok, "output": output.strip(), "paths": paths})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8337))
    print(f"beets server listening on :{port}", flush=True)
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
