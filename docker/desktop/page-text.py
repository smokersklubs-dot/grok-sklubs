#!/usr/bin/env python3
"""Prints the address, title and visible text of the browser's front tab as JSON."""
import json, sys, urllib.request
from websocket import create_connection

try:
    tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5))
except Exception:
    print(json.dumps({"error": "The browser is not open. Open a page first."})); sys.exit(0)
pages = [t for t in tabs if t.get("type") == "page" and not t.get("url", "").startswith("devtools:")]
if not pages:
    print(json.dumps({"error": "No page is open in the browser."})); sys.exit(0)
tab = pages[0]
ws = create_connection(tab["webSocketDebuggerUrl"], timeout=15, origin="http://127.0.0.1:9222")
ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": "document.body ? document.body.innerText : ''", "returnByValue": True}}))
text = ""
while True:
    msg = json.loads(ws.recv())
    if msg.get("id") == 1:
        text = msg.get("result", {}).get("result", {}).get("value", "") or ""
        break
ws.close()
print(json.dumps({"url": tab.get("url", ""), "title": tab.get("title", ""), "text": text}))
