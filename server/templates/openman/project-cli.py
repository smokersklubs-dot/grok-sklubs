#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Organic Intelligence, Inc.
# Adapted from nickvasilescu/openman 12ea5bdd, src/lib/generators/helper-program.ts.
# Offline project inspection and slide bundling. See LICENSE-OpenMan.txt and NOTICE-OpenMan.txt.
import base64
import glob
import gzip
import json
import mimetypes
import os
import re
import sys

def out(obj):
    sys.stdout.write(json.dumps(obj))
    sys.stdout.flush()

def read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def inside(folder, rel):
    p = os.path.realpath(os.path.join(folder, rel))
    root = os.path.realpath(folder)
    return p if (p == root or p.startswith(root + os.sep)) else None

def mtime(p):
    try:
        return int(os.path.getmtime(p) * 1000)
    except Exception:
        return 0

def state(folder):
    marker = read_json(os.path.join(folder, ".openman", "generator.json"))
    res = {"folder": folder, "marker": marker}
    kind = (marker or {}).get("kind")
    if kind == "slides":
        deck_path = os.path.join(folder, "slides", "deck.json")
        res["deck"] = read_json(deck_path)
        stamps = [mtime(deck_path)] + [mtime(p) for p in glob.glob(os.path.join(folder, "slides", "*.html"))] + [mtime(os.path.join(folder, "slides", "theme.css"))]
        res["updatedAt"] = max(stamps) if stamps else 0
        res["exports"] = exports(folder)
    elif kind == "data":
        res["analysis"] = read_json(os.path.join(folder, "analysis", "analysis.json"))
    elif kind == "research":
        res["plan"] = read_json(os.path.join(folder, "research", "plan.json"))
        res["progress"] = read_json(os.path.join(folder, "research", "progress.json"))
        res["result"] = read_json(os.path.join(folder, "research", "research.json"))
        done, failed = [], []
        for p in sorted(glob.glob(os.path.join(folder, "research", "items", "*.json"))):
            item = read_json(p)
            iid = os.path.splitext(os.path.basename(p))[0]
            if isinstance(item, dict) and item.get("status") == "failed":
                failed.append(iid)
            elif item is not None:
                done.append(iid)
        res["done"], res["failed"] = done, failed
    elif kind == "audio":
        res["audio"] = read_json(os.path.join(folder, "audio", "audio.json"))
    elif kind == "image":
        res["images"] = read_json(os.path.join(folder, "images", "images.json"))
    elif kind == "video":
        res["video"] = read_json(os.path.join(folder, "video", "video.json"))
    out(res)

def exports(folder):
    found = {}
    d = os.path.join(folder, "slides", "exports")
    for fmt, ext in (("pdf", ".pdf"), ("pptx", ".pptx"), ("html", ".html")):
        hits = sorted(glob.glob(os.path.join(d, "*" + ext)), key=mtime)
        if hits:
            found[fmt] = os.path.relpath(hits[-1], folder)
    return found

# ---------------------------------------------------------------- compose

LINK = re.compile(r"<link\b[^>]*>", re.I)
SRC = re.compile(r"""(\bsrc\s*=\s*)(["'])([^"']+)\2""", re.I)
URL = re.compile(r"""url\(\s*(["']?)([^)"']+)\1\s*\)""", re.I)

def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode())

def local(base, ref, root):
    if re.match(r"^(?:[a-z]+:|//|#|data:)", ref, re.I):
        return None
    ref = ref.split("#")[0].split("?")[0]
    p = os.path.realpath(os.path.join(base, ref))
    r = os.path.realpath(root)
    return p if p.startswith(r + os.sep) and os.path.isfile(p) else None

def inline_css(css, base, root):
    def sub(m):
        p = local(base, m.group(2), root)
        return "url(%s)" % data_uri(p) if p else m.group(0)
    return URL.sub(sub, css)

def compose(folder, file):
    root = folder
    slides = os.path.join(folder, "slides")
    p = inside(slides, file)
    if not p or not os.path.isfile(p):
        return "<!doctype html><html><body style='margin:0;display:flex;align-items:center;justify-content:center;height:720px;font:24px sans-serif;color:#888;background:#111'>Slide not written yet</body></html>"
    base = os.path.dirname(p)
    doc = open(p, encoding="utf-8", errors="replace").read()
    def link_sub(m):
        tag = m.group(0)
        if not re.search(r"""rel\s*=\s*["']?stylesheet""", tag, re.I):
            return tag
        h = re.search(r"""href\s*=\s*(["'])([^"']+)\1""", tag, re.I)
        lp = local(base, h.group(2), root) if h else None
        if not lp:
            return tag
        css = open(lp, encoding="utf-8", errors="replace").read()
        return "<style>%s</style>" % inline_css(css, os.path.dirname(lp), root)
    doc = LINK.sub(link_sub, doc)
    def src_sub(m):
        sp = local(base, m.group(3), root)
        return "%s%s%s%s" % (m.group(1), m.group(2), data_uri(sp) if sp else m.group(3), m.group(2))
    doc = SRC.sub(src_sub, doc)
    doc = re.sub(r"(<style\b[^>]*>)(.*?)(</style>)", lambda m: m.group(1) + inline_css(m.group(2), base, root) + m.group(3), doc, flags=re.S | re.I)
    doc = re.sub(r"""(style\s*=\s*")([^"]*)(")""", lambda m: m.group(1) + inline_css(m.group(2), base, root) + m.group(3), doc, flags=re.I)
    return doc

def deck_bundle(folder, dest):
    deck = read_json(os.path.join(folder, "slides", "deck.json"))
    if not isinstance(deck, dict):
        return out({"ok": False, "error": "no deck yet"})
    docs = [compose(folder, s.get("file", "")) for s in deck.get("slides", [])]
    stamps = [mtime(os.path.join(folder, "slides", "deck.json"))] + [mtime(p) for p in glob.glob(os.path.join(folder, "slides", "*.html"))]
    body = json.dumps({"deck": deck, "html": docs, "exports": exports(folder), "updatedAt": max(stamps)})
    with gzip.open(dest, "wb") as f:
        f.write(body.encode("utf-8"))
    out({"ok": True, "path": dest, "size": os.path.getsize(dest)})


if __name__ == "__main__":
    project = os.path.dirname(os.path.realpath(__file__))
    if sys.argv[1:] == ["state"]:
        state(project)
    elif sys.argv[1:] == ["bundle"]:
        deck = read_json(os.path.join(project, "slides", "deck.json"))
        slides = (deck or {}).get("slides")
        if not isinstance(slides, list) or not slides:
            sys.exit("No slide deck to bundle.")
        for slide in slides:
            path = inside(os.path.join(project, "slides"), slide["file"])
            if not path or not os.path.isfile(path):
                sys.exit("A slide file is missing.")
        dest = os.path.join(project, "slides", "deck.json.gz")
        deck_bundle(project, dest)
    else:
        sys.exit("Usage: python3 openman.py state|bundle")
