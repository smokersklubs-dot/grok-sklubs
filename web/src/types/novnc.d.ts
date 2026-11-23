// The noVNC client ships without type declarations; this covers the part Sklubot uses.
declare module "@novnc/novnc/lib/rfb.js" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { wsProtocols?: string[]; shared?: boolean });
    viewOnly: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    focusOnClick: boolean;
    clipViewport: boolean;
    background: string;
    disconnect(): void;
    focus(): void;
    // L149 (noVNC 1.5 lib/rfb.js, public API in docs/API.md): paste, Ctrl+Alt+Del, keys, capture.
    clipboardPasteFrom(text: string): void;
    sendCtrlAltDel(): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
  }
}
