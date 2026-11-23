/** L178 « Document partagé »: what the server and the web app exchange (server/src/livedoc.ts). */
export interface LiveDocInfo { id: string; title: string; revision: number; /** Bots it is shared with. */ bots: string[]; chars: number; createdAt: number; updatedAt: number }
export interface LiveDocFull extends LiveDocInfo { text: string }
/** One change of the history: who, when, how many characters added / removed, undone or not. */
export interface LiveDocChange { revision: number; author: string; authorKind: "owner" | "bot"; at: number; plus: number; minus: number; undone: boolean; undoes: number | null }
/** Sent on GET /api/events to the owner's open pages after each change. */
export interface LiveDocEvent { type: "livedoc"; docId: string; revision: number; op: (number | string)[]; author: string; authorKind: "owner" | "bot"; clientId?: string }
