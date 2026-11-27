#!/usr/bin/env python3
"""Prints the address, title and visible text of the bot's active browser tab as JSON.
With "--eval <expression>": prints the address, title and the expression's value (as "target") instead of the text.
The server itself uses its own browser helper (server/src/browser-cdp.ts), which also follows new tabs and dialogs;
this script stays for the bot's own scripts and older servers. The active tab is the one the helper last used
(~/.sklubot/browser-tab.json), else the first page Chrome lists."""
import json, sys, urllib.request
from websocket import create_connection

try:
    tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5))
except Exception:
    print(json.dumps({"error": "The browser is not open. Open a page first."})); sys.exit(0)
pages = [t for t in tabs if t.get("type") == "page" and not t.get("url", "").startswith("devtools:")]
if not pages:
    print(json.dumps({"error": "No page is open in the browser."})); sys.exit(0)
try:
    active = json.load(open("/root/.sklubot/browser-tab.json")).get("active")
except Exception:
    active = None
tab = next((t for t in pages if t.get("id") == active), pages[0])
expression = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--eval" else "document.body ? document.body.innerText : ''"
text = ""
try:
    ws = create_connection(tab["webSocketDebuggerUrl"], timeout=15, origin="http://127.0.0.1:9222")
    ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": expression, "returnByValue": True}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            text = msg.get("result", {}).get("result", {}).get("value", "") or ""
            break
    ws.close()
except Exception:
    # A JavaScript dialog (alert, confirm…) freezes the page: say so instead of a traceback.
    print(json.dumps({"error": "The page did not answer: a dialog or a busy page may be in the way. Look at the screen."})); sys.exit(0)
if expression != "document.body ? document.body.innerText : ''":
    print(json.dumps({"url": tab.get("url", ""), "title": tab.get("title", ""), "target": text if isinstance(text, dict) else None}))
else:
    print(json.dumps({"url": tab.get("url", ""), "title": tab.get("title", ""), "text": text}))
