/**
 * L140 « Commenter une page »: the small comment layer the chat's page preview asks for (`?sklubot-comment=1` on the
 * page's address, pageroutes.ts), and the check of what it sends back. Our own code (idea: Plannotator / Timon T75
 * « annoter une page »; no code reused).
 *
 * HOW IT STAYS SAFE. The page keeps running in its sandbox (opaque origin, the page CSP of pagefiles.ts): the layer is a
 * plain inline script added to the page's HTML, with the page's own rights and nothing more. It does nothing until the
 * app (its parent window, and only it) turns « comment mode » on with a postMessage; then a click is not passed to the
 * page: the layer outlines the element and posts back a short description of it (a CSS path, its tag, its first words,
 * the selected text). The app checks that the message comes from that very iframe (event.source) and re-checks every
 * field with `parsePagePick` — the page's own scripts could post the same message, which at worst pre-fills a remark
 * the owner still reads, edits and sends himself. Nothing is sent to the bot without the owner's click.
 */

/** Query parameter that asks the page route for the layer. */
export const PAGE_COMMENT_PARAM = "sklubot-comment";
/** Message types (page → app, app → page). */
export const PAGE_PICK = "sklubot-page-pick";
export const PAGE_READY = "sklubot-page-ready";
export const PAGE_MODE = "sklubot-comment-mode";
/** Longest fields kept (characters). */
export const PICK_LIMITS = { path: 300, tag: 20, text: 300, selection: 600 } as const;

/** The layer itself (plain ES5, no dependency, ~2 kB). Runs inside the page's sandbox. */
export const PAGE_COMMENT_LAYER = `(function(){
if(window.__sklubotComment)return;window.__sklubotComment=1;
var on=false,box=null,P=window.parent;
function mark(el){if(!box){box=document.createElement("div");box.setAttribute("data-sklubot-layer","");box.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #e11d48;border-radius:4px;background:rgba(225,29,72,.10);display:none";document.documentElement.appendChild(box);}
if(!el||el===document.documentElement||el===document.body){box.style.display="none";return;}var r=el.getBoundingClientRect();box.style.display="block";box.style.left=(r.left-2)+"px";box.style.top=(r.top-2)+"px";box.style.width=(r.width+4)+"px";box.style.height=(r.height+4)+"px";}
function path(el){var parts=[];while(el&&el.nodeType===1&&el!==document.documentElement&&parts.length<6){var s=el.tagName.toLowerCase();if(el.id&&/^[A-Za-z][\\w-]{0,40}$/.test(el.id)){parts.unshift(s+"#"+el.id);break;}var p=el.parentElement;if(p){var same=[],k=p.children;for(var i=0;i<k.length;i++)if(k[i].tagName===el.tagName)same.push(k[i]);if(same.length>1)s+=":nth-of-type("+(same.indexOf(el)+1)+")";}parts.unshift(s);el=p;}return parts.join(" > ");}
function words(el){return String(el.innerText||el.textContent||el.getAttribute("alt")||el.getAttribute("aria-label")||el.getAttribute("title")||"").replace(/\\s+/g," ").trim().slice(0,300);}
window.addEventListener("message",function(e){if(e.source!==P)return;var d=e.data;if(d&&d.type==="${PAGE_MODE}"){on=!!d.on;document.documentElement.style.cursor=on?"crosshair":"";if(!on)mark(null);}},false);
document.addEventListener("mousemove",function(e){if(on)mark(e.target);},true);
document.addEventListener("click",function(e){if(!on)return;e.preventDefault();e.stopPropagation();var el=e.target;if(!el||el.nodeType!==1)return;mark(el);
P.postMessage({type:"${PAGE_PICK}",v:1,path:path(el),tag:el.tagName.toLowerCase(),text:words(el),selection:String(window.getSelection?window.getSelection():"").slice(0,600)},"*");},true);
P.postMessage({type:"${PAGE_READY}",v:1},"*");
})();`;

/** The page's HTML with the layer added just before its last </body> (or at the end when there is none). */
export function withCommentLayer(html: string): string {
  const tag = `<script data-sklubot-layer>${PAGE_COMMENT_LAYER}</script>`;
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at < 0 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}

/** What the owner picked on the page, once checked. */
export interface PagePick { path: string; tag: string; text: string; selection: string }

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A message from the layer, checked field by field; null when it is not one (wrong type, no path, odd tag). */
export function parsePagePick(data: unknown): PagePick | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type !== PAGE_PICK || d.v !== 1) return null;
  const path = clean(d.path, PICK_LIMITS.path);
  const tag = clean(d.tag, PICK_LIMITS.tag).toLowerCase();
  if (!path || !/^[a-z][a-z0-9-]{0,19}$/.test(tag)) return null;
  // A CSS path made by the layer: tags, ids, :nth-of-type(n) and " > " only.
  if (!/^[a-z0-9#:()_\- >]+$/i.test(path)) return null;
  return { path, tag, text: clean(d.text, PICK_LIMITS.text), selection: clean(d.selection, PICK_LIMITS.selection) };
}
