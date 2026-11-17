import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/chat.css";
import "./styles/panels.css";
import "./styles/today.css";

// The service worker only makes the app shell launch offline; it never touches /api/ requests.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

const root = document.getElementById("root");
// Development only: the state gallery (?dev=gallery, web/src/dev/Gallery.tsx). `import.meta.env.DEV` is false in a
// production build, so this branch and the gallery's code are left out of it (npm run check:bundle -w web checks).
if (root && import.meta.env.DEV && new URLSearchParams(location.search).get("dev") === "gallery") {
  void import("./dev/Gallery").then((m) => m.mountGallery(root));
} else if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
