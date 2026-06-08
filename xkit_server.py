#!/usr/bin/env python3
"""
AF3x Input Generator — xkit conversion server
==============================================
Converts any pyXLMS-supported crosslink format (pLink, MeroX, XlinkX, …)
to xiVIEW CSV, which the web importer can read directly.

Usage
-----
    python xkit_server.py              # port 5174
    python xkit_server.py --port 8765

Then open the AF3x Input Generator, upload a pLink / MeroX / XlinkX / …
file, choose the engine and crosslinker, and click "Convert".

Supported engines
-----------------
Native (xkit): xiNET, xiVIEW
pyXLMS:        Custom, MaxQuant, MaxLynx, MeroX, MS Annika, mzIdentML,
               pLink, Scout, xiSearch/xiFDR, XlinkX

Requirements
------------
    pip install flask
    # xkit must be importable (activate the conda env that has it)

CORS is wide-open so the static web UI can call this regardless of how it
is served (GitHub Pages, local http.server, file:// …).
"""

import argparse
import io
import os
import sys
import tempfile

try:
    from flask import Flask, jsonify, make_response, request
except ImportError:
    print("ERROR: flask is required.  Run: pip install flask")
    sys.exit(1)

try:
    from xkit.parsers import get_engines, read
except ImportError:
    print("ERROR: xkit is not importable.")
    print("       Activate the conda environment that has xkit installed,")
    print("       or add its parent directory to PYTHONPATH.")
    sys.exit(1)

app = Flask(__name__)

# ─── CORS ─────────────────────────────────────────────────────────────────────

def _cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response

@app.after_request
def after_request(response):
    return _cors(response)

@app.route("/health", methods=["GET", "OPTIONS"])
def health():
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    return jsonify({"status": "ok", "engines": get_engines()})

# ─── Conversion endpoint ───────────────────────────────────────────────────────

@app.route("/convert", methods=["POST", "OPTIONS"])
def convert():
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))

    file = request.files.get("file")
    engine = (request.form.get("engine") or "").strip()
    crosslinker = (request.form.get("crosslinker") or "").strip()

    if not file:
        return jsonify({"error": "No file uploaded"}), 400
    if not engine:
        return jsonify({"error": "engine parameter is required"}), 400
    if not crosslinker:
        return jsonify({"error": "crosslinker parameter is required"}), 400

    suffix = os.path.splitext(file.filename)[1] or ".csv"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name

        xlinks = read(tmp_path, engine=engine, crosslinker=crosslinker)
        df = xlinks.export_to("xiview")

        buf = io.StringIO()
        df.to_csv(buf, index=False)
        return jsonify({"csv": buf.getvalue(), "n_crosslinks": len(df)})

    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="xkit conversion server for AF3x Input Generator")
    parser.add_argument("--port", type=int, default=5174, help="Port to listen on (default: 5174)")
    args = parser.parse_args()

    engines = get_engines()
    print(f"\n  xkit conversion server  →  http://localhost:{args.port}")
    print(f"  Supported engines: {', '.join(engines)}\n")
    app.run(port=args.port, debug=False, threaded=True)
