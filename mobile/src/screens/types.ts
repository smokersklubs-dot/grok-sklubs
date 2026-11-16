export type RootStack = {
  Main: undefined;
  Chat: { botId: string };
  Details: { botId: string };
  /** The bot's screen: watch, or take control (control: true, e.g. from a takeover card). */
  Computer: { botId: string; control?: boolean };
};
