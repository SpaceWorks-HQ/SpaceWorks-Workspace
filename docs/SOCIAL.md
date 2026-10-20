# Social accounts, analytics and comments

Space Works Social is an internal comms dashboard. MEMBER, ADMIN and OWNER can
read cached analytics and answer or moderate comments. ADMIN and OWNER connect
accounts. GUEST cannot access Social. Publishing posts, ads, scheduling content
and personal LinkedIn profiles are outside this feature.

## Instance configuration

Apply the `social` migration and run the normal scheduled-job runner. Posts and
comments are due every 15 minutes; daily analytics refresh once a day. A
PostgreSQL claim prevents replicas from syncing the same account concurrently.
The existing scheduler calls `lib/scheduled/social.ts`.

Use an HTTPS `NEXT_PUBLIC_BASE_URL` in production. OAuth redirects use its
origin, never a request Host header. Existing Google client credentials and
instance Google settings are reused. Other app credentials are instance env
settings; they are never returned by a page or assistant tool:

| Platform | Configuration |
| --- | --- |
| YouTube | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or the instance Google sign-in client |
| Facebook and Instagram | `SOCIAL_META_CLIENT_ID`, `SOCIAL_META_CLIENT_SECRET`, `SOCIAL_META_CONFIG_ID` |
| LinkedIn | `SOCIAL_LINKEDIN_CLIENT_ID`, `SOCIAL_LINKEDIN_CLIENT_SECRET` |
| X | `SOCIAL_X_CLIENT_ID`, `SOCIAL_X_CLIENT_SECRET` |
| Optional Meta webhooks | `SOCIAL_META_WEBHOOK_VERIFY_TOKEN` (random), same Meta app secret as above |
| Encryption | `INTEGRATION_ENCRYPTION_KEY` (32-byte base64); existing crypto fallback uses `MFA_ENCRYPTION_KEY` |

Register these exact redirect URIs, replacing `https://workspace.example.org`:

- `https://workspace.example.org/api/social/oauth/youtube/callback`
- `https://workspace.example.org/api/social/oauth/facebook/callback`
- `https://workspace.example.org/api/social/oauth/instagram/callback`
- `https://workspace.example.org/api/social/oauth/linkedin/callback`
- `https://workspace.example.org/api/social/oauth/x/callback`

An admin starts in Settings → Social, authorises the platform, then chooses
accounts from a ten-minute selection. OAuth state is single-use, hashed,
bound to the initiating user and workspace, and checked against their current
admin membership. Google and X use S256 PKCE. Tokens and the PKCE verifier are
encrypted with separate purposes. Discovery selections remain encrypted on the
server and expose only names and scope metadata to the browser.

Disconnect removes local credentials and cancels a sync claim. History remains.
Also revoke the application in the platform's settings to remove its upstream
access. Reconnecting retains existing history and any refresh token when the
provider does not issue a replacement.

## YouTube

Create a Google Cloud project, enable YouTube Data API v3 and YouTube Analytics
API, configure the OAuth consent screen, and create a Web application client.
Add the YouTube callback above. In testing mode add the connecting owner as a
test user; external production apps may need Google OAuth verification. Request:

- `https://www.googleapis.com/auth/youtube.readonly`
- `https://www.googleapis.com/auth/yt-analytics.readonly`
- `https://www.googleapis.com/auth/youtube.force-ssl`

Discovery lists the channels available to the authorised identity. Switch to
the desired Brand Account during consent when needed. Channel uploads come
from the uploads playlist, video statistics from Data API, and daily views,
watch minutes, average view duration in seconds, likes, comments, shares and
subscriber gains/losses from Analytics API. Subscriber totals can be rounded or
hidden. Reports are subject to YouTube's reporting delay and date semantics.

Comments use `commentThreads.list`; replies are fetched separately because the
thread resource does not guarantee all replies. Sending uses `comments.insert`.
Channel-owner moderation uses `heldForReview`, `published` or `rejected`.
“Hide” holds for review and is reversible; “Reject” is irreversible here.
Another person's comment cannot be deleted with `comments.delete`. Write and
moderation calls consume more quota than reads. Refresh uses the existing
Google client configuration and refresh-token grant.

Official references:
[OAuth](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps),
[channels](https://developers.google.com/youtube/v3/docs/channels/list),
[playlist items](https://developers.google.com/youtube/v3/docs/playlistItems/list),
[videos](https://developers.google.com/youtube/v3/docs/videos/list),
[channel reports](https://developers.google.com/youtube/analytics/channel_reports),
[metric definitions](https://developers.google.com/youtube/analytics/metrics),
[comment threads](https://developers.google.com/youtube/v3/docs/commentThreads/list),
[replies](https://developers.google.com/youtube/v3/docs/comments/insert),
[moderation](https://developers.google.com/youtube/v3/docs/comments/setModerationStatus),
[quota](https://developers.google.com/youtube/v3/determine_quota_cost).

## Meta: Facebook Pages and Instagram professional accounts

Create a Meta business app and configure Facebook Login for Business. Create
its login configuration, save its id in `SOCIAL_META_CONFIG_ID`, select the
permissions below in that configuration, and add both Meta redirect URIs.
Assign the test account and Page assets to the app while it is in development.
For other organizations complete Business Verification and App Review for the
permissions requiring advanced access. Consumer/personal Instagram accounts
are not supported; connect a professional Instagram account to a Facebook Page.

Facebook permissions: `pages_show_list`, `pages_read_engagement`,
`pages_read_user_content`, `pages_manage_engagement`, `read_insights`,
`business_management`. Instagram: `pages_show_list`, `pages_read_engagement`,
`instagram_basic`, `instagram_manage_insights`, `instagram_manage_comments`,
`business_management`. Request only the assets and approved permissions your
installation needs; some business configurations need additional asset access.

Graph API is pinned to `v24.0` in `lib/social/config.ts`. The adapter exchanges
the login token for a long-lived token, then obtains Page access tokens from
`/me/accounts`. Page tokens derived this way can be long-lived without a fixed
expiry, but access can still be invalidated. The local expiry conservatively
uses the source token expiry when supplied. Meta Page tokens do not use a
standard refresh-token grant: reconnect to renew consent or asset access.
Google, X and eligible LinkedIn refresh tokens are renewed automatically;
Meta connections show expiry warnings rather than claiming perpetual access.

The current metric set intentionally avoids legacy `page_impressions*`,
`page_fans` and `post_impressions*`. Facebook requests `page_media_view`,
`page_total_media_view_unique`, `page_post_engagements`, `page_views_total`,
`page_daily_follows_unique`, `page_daily_unfollows_unique`; post insights request
`post_media_view`, `post_total_media_view_unique`, `post_clicks`. Views retain
their name; unique media viewers are shown as reach. Reactions, comment counts
and shares come from the post resource. Availability varies by Page and version.

Instagram requests account reach, views, profile views, accounts engaged,
total interactions and profile-link taps; follows/unfollows use a separate
`follows_and_unfollows` request with `breakdown=follow_type`. `FOLLOWER` and
`NON_FOLLOWER` are normalised to gains and losses. Small accounts may not get
all insight metrics. Media reads request reach, likes, comments, saved, shares
and views. Unsupported media metrics stay unavailable and produce a warning.

Facebook comments support replies, hide/unhide and delete with Page access.
Instagram comments support replies, hide/unhide and delete with the professional
account's permissions. Moderation only changes local status after API success.
A hidden comment can remain visible to its author according to Meta's rules.

Optional realtime setup: configure the callback
`https://workspace.example.org/api/social/meta` and the verify token in Meta's
Webhooks product. Subscribe the app to Page `feed` and Instagram `comments`
fields as applicable, complete review if required, then use “Subscribe to
comments” for each connected account. POST bodies are size-limited and their
exact bytes checked against `X-Hub-Signature-256` before parsing. Events wake
polling; bodies are not trusted as canonical comments. Polling remains active
without webhooks. A webhook cannot bypass a recorded provider backoff.

Official references:
[Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/),
[permissions](https://developers.facebook.com/docs/permissions/),
[long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/),
[Page access tokens](https://developers.facebook.com/docs/pages-api/getting-started/page-access-tokens/),
[Page insights](https://developers.facebook.com/docs/graph-api/reference/page/insights/),
[Page metric changes](https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics),
[Instagram insights](https://developers.facebook.com/docs/instagram-platform/insights/),
[account metrics](https://developers.facebook.com/docs/instagram-platform/reference/instagram-user/insights/),
[media metrics](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/),
[Instagram comment moderation](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/comment-moderation/),
[webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/),
[rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/),
[changelog](https://developers.facebook.com/docs/graph-api/changelog/).

Research limitation (20 October 2026): Meta's documentation host rejected
repeated automated retrieval with HTTP 429/access errors. These canonical
references are provided for operator verification. Metric acceptance must be
confirmed against the approved app and connected assets; no live platform
acceptance is claimed by fixture tests. The adapter isolates failed metrics
instead of substituting zero or using an unofficial API.

## LinkedIn organization pages

Create an app associated with your LinkedIn Page, verify that association,
request Community Management API access, and complete the review and technical
sign-off requested for your tier. A basic “Sign in with LinkedIn” app is not
sufficient. The connecting member must administer the organization. Add the
LinkedIn callback URI above. Set `SOCIAL_LINKEDIN_CLIENT_ID` and secret.

Request `rw_organization_admin`, `r_organization_social`,
`w_organization_social`, `r_organization_social_feed`,
`w_organization_social_feed`, subject to the products your app is approved for.
The newer feed scopes cover comment/social-action reads and writes. The
`r_organization_followers` scope is for follower member data/mentions and is
not needed just to read aggregate follower statistics.

`LinkedIn-Version: 202605` and `X-Restli-Protocol-Version: 2.0.0` are pinned.
The adapter lists organization ACLs and posts, gets follower totals through
`networkSizes`, and daily follower/share statistics through their organization
endpoints. Share metrics include impressions, unique impressions, clicks,
reactions, comments, shares and reported engagement. It reads nested comments
and replies through `socialActions/{urn}/comments`. Member names are not
fabricated when the app returns an opaque actor URN. Comment hide/delete are
not offered for other members' comments. Refresh is automatic only when the
approved app receives a programmatic refresh token; otherwise reconnect at
expiry. Review version support before the pinned monthly API sunsets.

Official references:
[Community Management](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview),
[app review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review),
[permissions and access](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access),
[versioning](https://learn.microsoft.com/en-us/linkedin/marketing/versioning),
[follower statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/follower-statistics),
[share statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics),
[organization lookup](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api),
[posts](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api),
[comments](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api),
[refresh tokens](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens).

## X (Twitter)

Create a developer project/app, enable OAuth 2.0 as a confidential Web App,
register the exact X callback, and set the instance client id and secret.
Authorisation uses PKCE with `tweet.read`, `users.read`, `offline.access`,
`tweet.write`. The offline scope enables rotating refresh tokens. Use the
Developer Console to configure credits and a spending limit before connecting.

The current official documentation describes pay-per-use credits and Enterprise
access, rather than promising historical Free/Basic/Pro allowances. Do not
assume a free tier provides analytics or reply search. Check current endpoint
pricing and account entitlements in the Console. Without paid/approved API
access, Social does not promise usable X reads or writes. Public reads can
still incur charges; fallback requests are not necessarily free.

Reads use `/2/users/me` for follower totals and `/2/users/{id}/tweets` for
post metric snapshots. Non-public/organic fields are requested for owned posts;
if denied, a public-metrics request preserves the available data. Recent reply
search uses `conversation_id` and covers the recent search window (seven days),
not historical conversations. Search and higher limits need appropriate paid
access. Access/billing failures show an actionable message. Creating a reply
uses `POST /2/tweets` and `reply.in_reply_to_tweet_id`. X moderation is not
exposed because the configured scopes do not include reply-hiding permission.

No historical daily reach or engagement is invented from cumulative post
snapshots. Character validation uses a conservative weighted count and fixed
URL length; complex emoji sequences can be rejected conservatively. The API
remains authoritative about accepted text.

Official references:
[PKCE and refresh](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code),
[pricing](https://docs.x.com/x-api/getting-started/pricing),
[users](https://docs.x.com/x-api/users/lookup/introduction),
[post metrics](https://docs.x.com/x-api/fundamentals/metrics),
[recent search](https://docs.x.com/x-api/posts/search/introduction),
[create post/reply](https://docs.x.com/x-api/posts/create-post),
[rate limits](https://docs.x.com/x-api/fundamentals/rate-limits),
[character counting](https://docs.x.com/fundamentals/counting-characters).

## Data interpretation and operational limits

A missing metric is unavailable, not zero. Overview sums cover reporting
accounts only. Follower totals are snapshots; 7/28/90-day changes need an older
snapshot. No cross-platform unique audience is claimed. Period reach is the sum
of daily reach and can count the same person more than once. Engagement uses
reported interactions divided by available impressions, otherwise reach,
otherwise views, only for accounts with both sides present. Daily average watch
duration remains an average; it is not a count. Post rows are latest lifetime
snapshots. Different platforms' reported dates and metric definitions remain
visible rather than being presented as one universal measurement standard.

Sync is bounded: YouTube fetches 50 recent uploads plus a saved older page,
100 recent comment threads plus an older page, and up to 1,000 replies per
thread per pass, continuing from a saved cursor. Meta/LinkedIn fetch 50 recent posts plus a saved older page and comments
for up to 30 posts per pass, combining recent posts with a rotating older set. Comment pagination cursors persist. X refreshes
100 recent posts plus an older page and searches up to 20 recent conversations.
Nested Meta/LinkedIn discussions fetch 100 replies per pass and retain continuation cursors.
There is a 250-request safety budget per adapter invocation. Polling is a
bounded operational inbox, not a guaranteed historical archive of every reply.

Daily YouTube and LinkedIn reports request up to 90 days. Meta collects the previous day and incrementally backfills up to 90 days, five historical days per pass. Availability can be shorter for a particular metric. Followers build from
connection time. Deleted remote comments may remain in history until a local
moderation action; polling does not infer deletion from absence.

429 responses, Retry-After, X reset headers and Meta usage headers schedule
backoff. Partial failures retain successfully fetched data. Account errors are
short, sanitised messages; raw platform responses and tokens never enter sync
logs, audit metadata, notifications or assistant outputs. Unknown reply outcomes
and interrupted sends remain blocked for verification; do not automatically
resend. An admin must verify the original platform discussion before using the comment page’s reconciliation form. Recently started sends are protected for ten minutes. Provider approval, credentials and live smoke tests are still
required for a production installation.
