/** L184 « sondages »: a poll in a chat or a group (polls.ts). Wire type shared with the web app. */
export interface PollVote { /** "user:<id>" or "bot:<id>" */ by: string; name: string; choices: number[]; reason?: string }
export interface PollCard {
  type: "poll"; pollId: string; question: string; options: string[]; multi: boolean;
  status: "open" | "closed"; votes: PollVote[]; createdBy: string;
}
