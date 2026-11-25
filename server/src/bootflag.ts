/**
 * L161 « démarrage sur disque en panne »: what the real server's entry point (datalockboot.ts) leaves for diskboot.ts,
 * which runs when the database module loads. Tests and the command-line tools leave it empty: no disk gate, no lock.
 */
export const boot: { takeLock: (() => void) | null } = { takeLock: null };
