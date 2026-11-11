# eBallot SACDECO – Representative election, mobile voting

The phone page where members vote in the **Representative election**, plus the small Cloudflare Worker that sits between the page and the eVoting API.
It looks like the General Assembly mobile page (same colours, font, logo and wording style) – only the voting process is different.

```
phone browser  ──►  Cloudflare Worker (this project)  ──►  eVoting API  (api.eballotsacdeco.site)
 index.html, JS      static page + allow-listed proxy        /auth/voter-verify, /events/{id}/representative-ballot,
                     holds the kiosk secret                  …/representative-candidates, /representative-votes
```

## What the voter does

1. **Account Code** – a number keypad opens; spaces or dashes typed in the code are ignored. The API checks that the member may vote.
2. **Ballot** – one box per position, with its rule ("Pumili ng 1 hanggang 3", "Hanggang 1 ang pwedeng piliin") and a counter (2/3).
   Tap a name to tick it, tap again to untick. A box above the list finds a candidate by **name or ballot number**.
   "Tingnan ang detalye" shows what the candidate wrote about themselves. "Napili: n" shows only the chosen ones.
3. **Review** – "Tingnan muna ang boto mo": every chosen name and number, then "Isumite ang boto".
4. **Receipt** – a picture of the receipt with its code, to save or share (or take a screenshot).

## Made for senior citizens

Most voters are older members who are not used to apps, so:

- Large text (nothing under 16 px), large buttons (44–60 px tall), words instead of small icons, a tick mark (not only a colour) on chosen names.
- A short "Paano bumoto" help at the top of the ballot; the review button says exactly what is still missing ("Kulang pa ang napili sa Delegate").
- Messages say what to do ("Alisin muna ang isa para makapili ng iba"), stay on screen for 15 seconds, and a "Bumalik sa home" button is always there.
- "Isumite ang boto" wakes up 0.8 s after the review opens, so a double tap on "Suriin ang boto" can never send the vote.
- The Back button and a page reload ask first when choices were made; a session that expires while the voter is thinking is renewed silently.
- Works when the page is zoomed to 150–200% (no sideways scrolling), and the browser's own zoom is not blocked.

## What is different in the voting process (compared with the General Assembly page)

- **A large roster.** Candidates are loaded a page of 100 at a time per position, as the voter scrolls or searches (rosters can have hundreds of names). Photos are loaded only for candidates that have one, thumbnails only.
- **Rules per position.** The minimum and maximum come from the API (`minVotes`, `maxVotes`), are shown on screen and are checked again by the API.
- **Safe to send again.** The receipt code is made on the phone **before** the vote is sent, so a vote sent again after a lost answer is recognised by the API as the same vote and counted once.
- **Only the Representative election.** The Worker gives no voter token unless the open election is a `REPRESENTATIVE` one.

## Files

| | |
|---|---|
| `worker.js` | the Cloudflare Worker: serves `public/` and relays only the five calls listed in the file header; keeps the kiosk token; caches roster pages and photos |
| `wrangler.toml` | Worker name `eballotsacdecorepvotingapp`, static assets from `./public` |
| `public/` | the page: `index.html`, `app.css`, `logic.js` (rules and wording, tested on its own), `app.js` (screens), `_headers` (security headers), logo, background, self-hosted font |
| `dev-server.mjs` | runs the real `worker.js` and the page on your own computer, no Cloudflare needed |
| `test/` | `worker.test.mjs`, `logic.test.mjs` |

## Deploy (Cloudflare)

```
cd EVotingRepresentativeMobileFrontend
npx wrangler login
npx wrangler secret put KIOSK_SECRET     # paste the same value as the API's EVOTING_KIOSK_SECRET when asked
npx wrangler deploy
```

The page is then on `https://eballotsacdecorepvotingapp.<your-account>.workers.dev` (a custom domain can be added in the Cloudflare dashboard).
Check `https://<that address>/healthz` – it must answer `{"ok":true}`.

| Setting | Default | Meaning |
|---|---|---|
| `KIOSK_SECRET` | – (required, **secret**) | the API's kiosk secret. Never put it in a file or in the page. |
| `KIOSK_ID` | `MOBILE-REP-KIOSK-01` | only a label in the API's log |
| `API_BASE` | `https://api.eballotsacdeco.site` | the API |
| `CACHE_SECONDS` | `60` | how long roster pages are kept in the Worker (0 = no cache). The ballot (which says whether voting is open) is kept at most 20 s. |

`KIOSK_ID`, `API_BASE` and `CACHE_SECONDS` are plain values: put them under `[vars]` in `wrangler.toml` if you want to change them.

**Before the election day:** the API with the Representative endpoints must be deployed, the Representative election must be the **only open** election (the API refuses overlapping schedules, and this page refuses to let anybody in while a General Assembly election is the open one), and one member should try the page on a real phone.

## Run it on your computer

```
KIOSK_SECRET=<the API's EVOTING_KIOSK_SECRET> API_BASE=http://localhost:5000 node dev-server.mjs
```

Open `http://localhost:8787`. It runs the same `worker.js` and applies `public/_headers`, so the strict content security policy is in force.

## Tests

```
npm test
```

91 tests with Node's built-in runner (Node 22 or newer, nothing to install): the Worker (allow-list, tokens, cache, retries, error mapping, body limits) and the page logic (rules, ballot standing, receipt code, what to tell the voter for every API answer).

## Security

- The kiosk secret exists only in the Worker. The browser holds the voter token in memory only (no cookies, no local storage) and drops it after the vote.
- The Worker relays only the listed calls and checks their shape (ids, page size, token form, at most 500 choices, body up to 16 KB). Server errors (5xx) are replaced by a plain message without details.
- Content security policy: scripts, styles, fonts and images only from the same address (`blob:` for the receipt and photos), no inline script or style, no framing. The font is served from here, not from Google.
- Everything that comes from the server (names, details) is put on the page as text, never as HTML.
- The receipt code is a random label made on the phone; it holds nothing about the voter or the choices. The API never sends the choices back.

## Capacity

**What was tested.** The real `worker.js` and the real API on one small shared test machine (2 CPU cores; the API, the database, the Worker and the virtual voters all sharing it). Not tested: real phones on real mobile networks, the real Cloudflare network, your production server.

| Test | Result |
|---|---|
| 10,000 voters, 150 at the same time, 2,000 candidates (1,800 Delegate pick 1–20, 200 Alternate pick 0–5) | all voted, no failures, no retries; 104 seconds in all; one voter from sign-in to receipt (no thinking time): typically 1.5 s, 95 out of 100 within 2.5 s, the slowest 3.8 s |
| Every candidate voted for, including the last names of the list (found by scrolling, and by typing the ballot number) | 2,000 of 2,000 |
| Database after the run | one receipt per voter, nobody above 20 Delegates / 5 Alternates, nobody twice on a ballot; the results page and the CSV export equal the database (about 0.6 s each) |
| Bad ballots with the big roster (21 Delegates, none, the same one twice, an unknown id, 6 Alternates) | all refused, nothing recorded |
| Phone-size browser, all 1,800 names scrolled in, 20 + 5 chosen, searched by number and by name | works; a tap costs a few milliseconds; also on a phone 4× slower with a 1.6 Mbps connection |
| Burst of 300 voters within seconds, API limits **as shipped** | only 90 got through, 210 were turned away |
| The same burst with the raised limits below | 300 of 300 |

**Raise the API limits before an election with many voters.** They are one budget for everybody together (they were set for tablets at a counter), so a rush of phones uses them up. In the API's `appsettings.json` (or as environment variables, `RateLimit__VoteSubmitPerMinute` and so on):

| Setting | Shipped | Tested |
|---|---|---|
| `RateLimit:VoteSubmitPerMinute` (the vote itself) | 60 | 600 |
| `RateLimit:VoterVerifyPerMinute` (sign-in with the Account Code) | 200 | 1200 |
| `RateLimit:KioskLoginPerMinute` (the Worker signs in once per running copy of itself) | 10 | 30 |

A voter who is turned away anyway is retried by the page automatically, and sending the vote again is always safe.

**Cloudflare plan.** One voter costs the Worker about 6–7 requests (sign-in, ballot, a candidate page per position, a few more when the voter scrolls or searches, the vote) plus one for every photo shown. The static files are free. The **Free** plan allows 100,000 Worker requests a day – about 15,000 voters a day without photos, fewer with photos. The **Paid** plan ($5 a month) includes 10 million requests a month.

**Limits of the API.** At most 500 choices in one ballot, 100,000 candidates in a position, 50 positions in an election. How many a voter may pick in each position is the rule of the election (here 20 and 5).

Roster pages, photos and the ballot are the same for every voter, so the Worker keeps them in its own cache and the API sees each page about once per cache period (for each running copy of the Worker) instead of once per voter.
