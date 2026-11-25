export type RootStack = {
  Main: undefined;
  Chat: { botId: string };
  Details: { botId: string };
  /** The bot's screen: watch, or take control (control: true, e.g. from a takeover card). */
  Computer: { botId: string; control?: boolean };
  /** « Chantier »: read, approve, decide, stop (screens/Chantiers.tsx). */
  Chantiers: undefined;
  /** L184 « Tableau de bord et chiffres »: pinned views and the account's numbers (screens/Dashboard.tsx). */
  Dashboard: undefined;
};
