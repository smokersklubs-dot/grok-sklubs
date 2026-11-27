import type { ApiEndpoint } from "./shared.js";

/**
 * L175 — ready access paths for official APIs that have no tool server in the catalogue (catalog.ts). A bot proposes one
 * with api_connector_propose and `preset`; everything else stays the API connector's own rules (apiconnectors.ts): the
 * owner reviews the card and types THEIR OWN token there (it goes to the vault, bound to that host only, the bot never sees
 * it), api_get reads freely, api_send (posting, creating, moving) asks like any action, DELETE always asks.
 *
 * Only official APIs, only the endpoints a small business needs, each from the vendor's documentation (cited per entry,
 * read 22 Nov 2026). No scraping, no unofficial client, no third-party relay.
 */
export interface ApiPreset {
  id: string; name: string; baseUrl: string; secret: string; header: string; prefix: string;
  docs: string; tokenHelp: string; endpoints: ApiEndpoint[];
}

export const API_PRESETS: ApiPreset[] = [
  {
    // X API v2 — https://docs.x.com/x-api/introduction ; posts: https://docs.x.com/x-api/posts/create-post (POST /2/tweets),
    // https://docs.x.com/x-api/posts/delete-post, https://docs.x.com/x-api/posts/search-recent-posts ; users:
    // https://docs.x.com/x-api/users/get-my-user (GET /2/users/me), timelines and mentions. Auth: "Authorization: Bearer"
    // with an OAuth 2.0 user access token (posting needs the tweet.write scope).
    id: "x", name: "X", baseUrl: "https://api.x.com/2", secret: "X access token", header: "Authorization", prefix: "Bearer ",
    docs: "https://docs.x.com/x-api/introduction",
    tokenHelp: "In the X developer portal, create a project and app, set up OAuth 2.0 (user authentication) with the scopes tweet.read, users.read, tweet.write and offline.access, then generate a user access token for your account and paste it on the card. Reading and posting use your X API plan.",
    endpoints: [
      { method: "GET", path: "/users/me", description: "Who the token belongs to (id, username)" },
      { method: "GET", path: "/users/{id}/tweets", description: "Recent posts of an account" },
      { method: "GET", path: "/users/{id}/mentions", description: "Recent posts mentioning an account" },
      { method: "GET", path: "/tweets/search/recent", description: "Search posts of the last 7 days (query=…)" },
      { method: "GET", path: "/tweets/{id}", description: "One post" },
      { method: "POST", path: "/tweets", description: "Publish a post or a reply ({\"text\": …, \"reply\": {\"in_reply_to_tweet_id\": …}}): asks the owner" },
      { method: "DELETE", path: "/tweets/{id}", description: "Delete one of the account's posts: always asks" },
    ],
  },
  {
    // Instagram API with Instagram Login — https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/
    // host graph.instagram.com; content publishing https://developers.facebook.com/docs/instagram-platform/content-publishing
    // (POST /<version>/<IG_ID>/media then POST /<version>/<IG_ID>/media_publish with creation_id; examples use v27.0 and
    // "Authorization: Bearer <ACCESS_TOKEN>"; at most 100 API-published posts per 24 hours); comments and insights under
    // the same host.
    id: "instagram", name: "Instagram", baseUrl: "https://graph.instagram.com/v27.0", secret: "Instagram access token", header: "Authorization", prefix: "Bearer ",
    docs: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/",
    tokenHelp: "Needs an Instagram professional account (business or creator). In Meta for Developers, create an app with the Instagram product (API setup with Instagram login), add your account, and generate an access token with instagram_business_basic, instagram_business_content_publish and instagram_business_manage_comments. Paste it on the card. Tokens last about 60 days.",
    endpoints: [
      { method: "GET", path: "/me", description: "The account (fields=user_id,username,account_type,media_count)" },
      { method: "GET", path: "/{id}/media", description: "The account's posts (fields=id,caption,media_type,permalink,timestamp,like_count,comments_count)" },
      { method: "GET", path: "/{id}/comments", description: "Comments of a post" },
      { method: "GET", path: "/{id}/insights", description: "Statistics of a post or the account" },
      { method: "GET", path: "/{id}/content_publishing_limit", description: "How many posts were published by API in the last 24 hours" },
      { method: "POST", path: "/{id}/media", description: "Prepare a post (image_url or video_url, caption): asks the owner" },
      { method: "POST", path: "/{id}/media_publish", description: "Publish a prepared post (creation_id): asks the owner" },
      { method: "POST", path: "/{id}/replies", description: "Reply to a comment (message): asks the owner" },
    ],
  },
  {
    // Trello REST API — https://developer.atlassian.com/cloud/trello/rest/ ; authorization
    // https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/ : the key and token may be sent in the
    // header "Authorization: OAuth oauth_consumer_key=\"{key}\", oauth_token=\"{token}\"" (pasted whole as the secret).
    id: "trello", name: "Trello", baseUrl: "https://api.trello.com/1", secret: "Trello authorization", header: "Authorization", prefix: "",
    docs: "https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/",
    tokenHelp: "Create a Power-Up in Trello's admin page (trello.com/power-ups/admin) to get an API key, then generate a token for your account from the key's page. Paste on the card, in one line: OAuth oauth_consumer_key=\"YOUR_KEY\", oauth_token=\"YOUR_TOKEN\".",
    endpoints: [
      { method: "GET", path: "/members/me/boards", description: "Your boards" },
      { method: "GET", path: "/boards/{id}/lists", description: "The lists (columns) of a board" },
      { method: "GET", path: "/boards/{id}/cards", description: "The cards of a board" },
      { method: "GET", path: "/cards/{id}", description: "One card" },
      { method: "POST", path: "/cards", description: "Create a card (idList, name, desc): asks the owner" },
      { method: "PUT", path: "/cards/{id}", description: "Change a card or move it to another list (idList): asks the owner" },
      { method: "POST", path: "/cards/{id}/actions/comments", description: "Comment on a card (text): asks the owner" },
    ],
  },
];

export const presetOf = (id: unknown): ApiPreset | undefined => API_PRESETS.find((p) => p.id === String(id ?? "").trim().toLowerCase());
