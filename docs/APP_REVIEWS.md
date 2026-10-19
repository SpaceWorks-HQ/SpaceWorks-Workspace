# App reviews setup

Open Operations → App reviews → Settings as a workspace admin. Members can
read, triage, draft and send replies; guests cannot open this area. Replies
are public. The assistant only drafts text; a person must press Send.

## App Store Connect

Create a team API key in App Store Connect with access to the app and customer
reviews (use an appropriate customer-support or admin role). Save the issuer
ID, key ID and downloaded `.p8` key in a store account. The private key must
be P-256. Add the app's numeric Apple ID, not its bundle ID, in Apps, then
use Test connection. Credentials are encrypted and write-only; blank fields
on edit retain the saved values.

Apple requests use ES256 JWTs with a 19-minute lifetime and the
`appstoreconnect-v1` audience. Reviews are read newest first in pages of 100,
stopping at the first known review. Existing responses are included. Sending
an edited reply uses the response POST endpoint to replace it. Publication
can be delayed: “Sent, waiting for Apple to publish” means Apple accepted the
reply. The job checks pending/unknown states every five minutes and announces
publication only after Apple reports PUBLISHED. Do not repeatedly resend a
pending reply.

References: [Apple review responses](https://developer.apple.com/documentation/appstoreconnectapi/customer-review-responses),
[review listing](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-customerreviews),
[API authentication](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests).

## Google Play

Enable the Google Play Android Developer API in the Google Cloud project.
Create a service account and a JSON key. Give that service account access to
the app in Play Console, including **Reply to reviews** permission. Save the
JSON as a Google store account and add the app's package name, such as
`org.example.app`. Test connection checks read access; the account also needs
reply permission to send. Google uses an RS256 service-account assertion to
obtain an OAuth token for the `androidpublisher` scope.

Google lists recent written production reviews, not all historical or
star-only ratings. The importer reads every returned page so updates to
known reviews are retained. Google exposes a modification date rather than
a separate creation date; the first observed date remains the review's
creation date here. Language and app version are stored when supplied.
Replies have a 350-character limit; Apple replies have a 5,970-character
limit. Counts use Unicode code points. Apple does not provide language or
app version in this review-list response; missing metadata is labelled.

References: [Google review access and limitations](https://developers.google.com/android-publisher/reply-to-reviews),
[list endpoint](https://developers.google.com/android-publisher/api-ref/rest/v3/reviews/list),
[service-account authentication](https://developers.google.com/identity/protocols/oauth2/service-account).

## Polling, proxies and routing

Apps poll every 15 minutes by default (configurable from 5 to 1,440).
The shared scheduler runs the job approximately once a minute. Run the
outbox worker or the authenticated internal outbox endpoint in deployment.
Database leases coordinate replicas; no store call runs inside a webhook
request. Last polled records the last completed sync. Interrupted syncs retain
that boundary, so retries read past partially saved pages without losing older
reviews or dispatching duplicates. Pausing an account pauses its apps. Pausing an app pauses its
polling and replies.

Set an HTTP(S) egress proxy on the store account or override it for one app.
The proxy URL is encrypted because it may contain authentication. An app
without a proxy requires explicit **Allow a direct connection** consent.
Only the official Apple, Google OAuth and Android Publisher HTTPS hosts
are used; redirects and foreign pagination addresses are rejected. The
proxy itself is trusted admin configuration; it may be on your private
network. Keep its access restricted to workspace admins.

Use **Send to** to choose existing notification destinations and optionally
restrict ratings. For example, select ratings 1 and 2 for an on-call Telegram
destination, and mirror every review into the app's Slack channel. Workspace
notification rules also apply. Events are `app_review.received`,
`app_review.replied` and `app_review.reply_failed`, with typed app, platform,
rating, author, excerpt and link payloads. Rule JSON supports `ratings: [1, 2]`.
Destination delivery depends on the provider adapters configured by the
messaging area. This area does not implement those shared adapters.

## Slack replies

Create and install a Slack app with bot scopes `chat:write`, `reactions:read`,
`channels:history` and `groups:history`. Enable the `reaction_added` bot event.
Invite the bot to every channel used by an app. Save the bot token and
signing secret in App reviews settings. Set the Events API request URL to:

```text
https://your-workspace-host/api/app-reviews/slack/events?workspace=your-workspace-slug
```

The endpoint verifies Slack's v0 signature over the exact raw body, permits
five minutes of clock skew and handles URL verification. Set the trigger
emoji name (default `white_check_mark`, without colons). Map each permitted
Slack user ID to an active MEMBER, ADMIN or OWNER in this workspace. This
explicit mapping prevents an arbitrary Slack user from using store credentials.
Mapping and membership are checked again by the worker. To revoke access,
suspend the member, map the Slack ID to another permitted member, or disable
Slack replies. Switching Slack teams clears all saved member mappings.

For each review, the bot posts a plain-text Block Kit card with stars,
metadata and a link back. A member writes a reply in that review's thread,
then reacts to **their own reply** with the configured emoji. The worker
fetches that message, checks the author and thread, converts Slack markup to
plain text and sends one store reply. It confirms in the thread with
“Reply published”, “Sent, waiting for Apple to publish” or a safe failure.
Removing and adding the reaction cannot send the same message again. Write
a new thread reply to submit a different version.

A permanent marker is stored before each Slack mirror POST and each store
reply POST. Retries never repeat an ambiguous send. If the network or worker
fails after a remote service accepted a request, the mirror can show Failed
without a message reference, or the reply can show Sending/Unknown until
read-only reconciliation finds it. Inspect the remote store before an
explicit new send. Slack mirror failures require manual inspection and are
not automatically reposted, preserving the at-most-once guarantee.

References: [Slack request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/),
[thread retrieval](https://docs.slack.dev/reference/methods/conversations.replies/),
[reaction event](https://docs.slack.dev/reference/events/reaction_added/).

## Insights and search

Insights cover imported reviews from the last 90 days: daily average rating,
distribution, volume by app/platform/version, reply rate and median time
from store creation to reply. Daily buckets use the workspace time zone.
Charts have table equivalents and visible labels. These figures are not the
stores' overall ratings because the APIs expose different review windows.

Members can search full review text in the inbox or through the read-only
`sw_list_app_reviews` and `sw_get_app_review` assistant tools. Global search
records use PRIVATE visibility because the shared index currently has no
MEMBER minimum-role field; no guest-readable review index is created.
