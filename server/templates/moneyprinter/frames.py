"""Draw the existing studio canvas in a disposable headless Chromium profile."""
import base64
import json
import subprocess
import time
import urllib.request

import websocket


class StudioCanvas:
    def __init__(self, folder, javascript, story, width, height, media):
        self.request_id = 0
        self.socket = None
        self.browser = subprocess.Popen([
            "chromium", "--headless", "--no-sandbox", "--disable-dev-shm-usage",
            "--disable-background-networking", "--disable-gpu", "--remote-debugging-port=0",
            "--remote-allow-origins=*", "--user-data-dir=" + str(folder), "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            port_file = folder / "DevToolsActivePort"
            for _ in range(160):
                if port_file.is_file():
                    break
                if self.browser.poll() is not None:
                    raise RuntimeError("Chromium failed to start")
                time.sleep(.1)
            port = int(port_file.read_text().splitlines()[0])
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=8) as response:
                page = next(tab for tab in json.load(response) if tab["type"] == "page")
            self.socket = websocket.create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=30)
            module = "data:text/javascript;base64," + base64.b64encode(javascript.encode()).decode()
            self.js("import(" + json.dumps(module) + ").then(m => { window.timeline = m })")
            self.js("window.story=" + json.dumps(story) + ";window.assets=new Map();" +
                    "window.canvas=document.createElement('canvas');canvas.width=" + str(width) +
                    ";canvas.height=" + str(height) + ";document.body.append(canvas)")
            for key, path in media.items():
                self.js("document.querySelector('input')?.remove();document.body.append(Object.assign(document.createElement('input'),{type:'file'}))")
                document = self.call("DOM.getDocument")["root"]["nodeId"]
                node = self.call("DOM.querySelector", nodeId=document, selector="input")["nodeId"]
                self.call("DOM.setFileInputFiles", nodeId=node, files=[str(path)])
                self.js("""(async key => {
                    const isVideo = /\.(mp4|webm|mov)$/i.test(key);
                    const el = isVideo ? document.createElement('video') : new Image();
                    const ready = new Promise((resolve,reject) => {
                       el.addEventListener(isVideo ? 'loadeddata' : 'load',resolve,{once:true});
                       el.addEventListener('error',reject,{once:true});
                    });
                    el.src=URL.createObjectURL(document.querySelector('input').files[0]);
                    await ready; assets.set(key,el);
                })(""" + json.dumps(key) + ")")
        except BaseException:
            self.close()
            raise

    def call(self, method, **params):
        self.request_id += 1
        self.socket.send(json.dumps({"id": self.request_id, "method": method, "params": params}))
        while True:
            result = json.loads(self.socket.recv())
            if result.get("id") == self.request_id:
                if "error" in result:
                    raise RuntimeError("Chromium command failed: " + method)
                return result["result"]

    def js(self, expression):
        response = self.call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in response:
            raise ValueError("The studio could not draw the project media")
        return response["result"].get("value")

    def frame(self, t):
        jpeg = self.js("""(async t => {
            const {scene,local}=timeline.locate(story,t), el=assets.get(scene.media);
            if(el instanceof HTMLVideoElement) {
                const pos=Math.min(local,Math.max(0,el.duration-.04));
                if(Math.abs(pos-el.currentTime)>.005) {
                    const done=new Promise(resolve=>el.addEventListener('seeked',resolve,{once:true}));
                    el.currentTime=pos; await done;
                }
            }
            timeline.drawFrame(canvas,story,assets,t);
            return canvas.toDataURL('image/jpeg', .93).split(',')[1];
        })(""" + str(t) + ")")
        return base64.b64decode(jpeg, validate=True)

    def close(self):
        if self.socket:
            self.socket.close()
        self.browser.terminate()
        try:
            self.browser.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.browser.kill()
            self.browser.wait()
