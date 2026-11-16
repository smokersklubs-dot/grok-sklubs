// SK-P0-03 in hosted mode: the same isolation suite, route by route, with HOSTED_MODE=1 — so the hosted routes
// (administration, "Mon abonnement", plans, plan invitations, payment webhooks) are walked with real data behind them:
// A, the owner, is an operator; B and V are customers who must get 404 on every administration route.
process.env.HOSTED_MODE = "1";
await import("./isolation.test.ts");
