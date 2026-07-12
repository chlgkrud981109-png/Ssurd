# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Ssurd — AI cover letter analyzer for global (English-speaking) job seekers. Users paste a cover letter, pick a target role and up to 3 target companies, and get a scored HR-style report from Claude, including insights tied to each company's recent news.

Detailed API contracts, Firestore schema, and payment config live in [SPEC.md](SPEC.md). `Ssurd_PRD_v1.2.md` is the original Korean-market PRD and is **outdated** (it references Stripe/₩9,900; the live product uses Lemon Squeezy/$9 USD and targets a global audience) — don't treat it as current requirements.

## Commands

No build step, package.json, tests, or linter — this is a static site plus Cloudflare Pages Functions.

```bash
# Local dev (serves static files + functions at http://localhost:8788)
npx wrangler pages dev . --port 8788

# Deploy
npx wrangler pages deploy . --project-name ssurd
```

Local env vars go in `.dev.vars` (gitignored). Production env vars are set in the Cloudflare Pages dashboard: `ANTHROPIC_API_KEY`, `LEMON_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT`.

Google Sign-In on localhost requires adding `localhost` to Firebase Console → Authentication → Authorized domains.

## Architecture

**Static HTML pages** (no framework, no bundler) — each page is self-contained with inline `<style>` and inline `<script type="module">` blocks; shared styles are in `style.css`:
- `index.html` — landing + Google Sign-In entry
- `write.html` — the main app: role dropdown, company selector (max 3), pre-analysis company news panel, cover letter textarea, results rendering
- `dashboard.html` — analysis history (reads Firestore directly from the client)
- `pricing.html` — Lemon Squeezy checkout button (appends `checkout[custom][uid]` so the webhook can identify the user)

**Serverless backend** — `functions/api/*.js` auto-map to `/api/*` (Cloudflare Pages Functions, Workers runtime — WebCrypto only, no Node APIs):
- `analyze.js` — verifies the Firebase ID token manually via WebCrypto (no Admin SDK), checks plan/usage in Firestore via REST, fetches Google News RSS for selected companies (starter/admin only), calls Claude (`claude-sonnet-4-6`, max_tokens 5000 with a `stop_reason === 'max_tokens'` truncation guard), parses the JSON report, increments usage. Accepts optional `jobDescription` (capped 5,000 chars) — when present the prompt adds a `jdMatch` requirement-by-requirement section. Always produced: `ats` (6 checks), `skim` (per-sentence recruiter heat `hold|skim|lose` + `dropOff` index — **the sentence-split rule `.!?` followed by whitespace must match write.html's client-side split** `/(?<=[.!?])\s+/`), `interviewProbes` (3-5 weak-claim questions). write.html also has a client-only "live coach" (cliché/quantification/JD-keyword heuristics, zero API cost) in the side panel.
- `company-news.js` — public endpoint; fetches/parses Google News RSS for the client-side news panel on write.html
- `analyze-teaser.js` (`POST /api/analyze-teaser`) — **unauthenticated** one-shot preview (real score + ONE Before/After). Rate limited 1/IP/day + 300/day global via Firestore atomic `fieldTransforms` increments on `teaser_limits/{sha256(salt|ip|day)}` and `teaser_limits/_global_{day}` (service-account token, **fail-closed** — limiter outage returns 503, never a free Claude call). IPs are hashed with `TEASER_IP_SALT` env (optional, has default); raw IPs never stored. Cost ceiling ≈ $6.60/day.
- `lemon-webhook.js` — verifies HMAC `X-Signature`, then updates `users/{uid}.plan` in Firestore using a service-account OAuth2 token (RS256 JWT built with WebCrypto)
- `share.js` (`POST /api/share`) — creates a **sanitized** public share doc `shares/{shareId}` (scores/grade/role only — never letter/JD/feedback text). Idempotent per analysis (reuses `analyses.shareId`). Reads the analysis with the user's token, writes the share doc with the service-account token.
- `functions/share/[id].js` (`GET /share/{id}`) — server-rendered public score card with OG/Twitter meta (score in `og:title` so links unfurl on X). Tokenless Firestore read (requires public-read rule on `shares`), `Cache-Control: max-age=3600`, 302 to `/` when missing.

**Two Firestore auth paths** — this distinction matters when touching any function:
1. `analyze.js` (and the analysis-doc reads/patches in `share.js`) use the *user's own ID token* (subject to Firestore security rules)
2. `lemon-webhook.js` and the `shares/` write in `share.js` use a *service account token* (bypasses rules; requires `FIREBASE_SERVICE_ACCOUNT`)

**Firestore schema:**
- `users/{uid}`: email, plan (`free`|`starter`|`admin`), monthlyUsage, monthlyUsageMonth
- `analyses/{id}`: uid, jobTitle, coverLetter, jdText|null, report, createdAt, **revision lineage** — parentId|null, rootId (v1's own id), version (1,2,3…), previous {analysisId, score, scores, atsScore}|null, shareId|null. Analyses are **auto-saved** client-side after every successful run (`doc(collection(...))` pre-generated ref + `setDoc`); the dashboard groups chains purely by `rootId` (never walk `parentId` — mid-chain deletes orphan it).
- `shares/{shareId}`: flat scalars only (score, grade, per-dimension scores, atsScore/atsVerdict, jdMatchScore, jobTitle, delta, version, createdAt, uid). shareId = 11-char base62 from `crypto.getRandomValues`.

**Firestore security rules live in the Firebase console (not this repo).** Required:
```
match /analyses/{id} {
  allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
  allow read, update, delete: if request.auth != null && resource.data.uid == request.auth.uid;
}
match /shares/{id} { allow read: if true; allow write: if false; }
```

**Plan gating** is enforced server-side in `analyze.js` (`free` = 3/month, `starter` = 10/month + Company Intelligence, `admin` = unlimited) and mirrored client-side in write.html for UI only. Free users get **2 extra "locked preview" runs** past 3: the analysis executes and usage increments, but the response is stripped server-side to `{score, grade, atsScore, atsVerdict, locked:true}` — details never leave the server, and locked runs are deliberately **not auto-saved** (they'd pollute history/rootId chains). Conversion funnel: logged-out visitors get the teaser endpoint (write.html "teaser mode" replaces the old auth-gate modal; the pasted letter survives signup via `sessionStorage.ssurd_teaser`, expiring after 1h, and is never auto-run after login). ATS check, JD matching, revision tracking, and share links are **free-tier features** (deliberate acquisition decision); Starter = volume + Company Intelligence. The plan is upgraded exclusively by the Lemon Squeezy webhook.

## Constraints

- Do not modify the Firebase config object in the HTML pages. (`style.css` may be modified.) Visual language (July 2026 rebrand): **Runway-inspired dark-first minimalism** — theme tokens on `:root` (dark default) with `:root[data-theme="light"]` overrides, toggled via `ssurdToggleTheme()` (localStorage `ssurd_theme`, FOUC head snippet on every page). Monochrome CTAs (`--inv-bg/--inv-fg`), `#3182f6`/`#6ba1ff` only for links/data points, 1px hairline borders, soft shadows, sentence-case labels; DM Mono is reserved for numerals/data. Print forces light tokens (block at end of style.css). Never hardcode hex in page markup/JS — use `var()` tokens (exception: the canvas share card and `functions/share/[id].js`, which are fixed dark-palette artifacts).
- Claude model is `claude-sonnet-4-6` — older dated model IDs (e.g. `claude-sonnet-4-20250514`) are deprecated and return errors.
- Claude prompts must demand JSON-only output; `analyze.js` extracts the first `{...}` block from the response, so report-schema changes must be made in both `buildPrompt()` and the write.html result renderer, **and every new renderer section must null-guard** (legacy saved reports lack `ats`/`jdMatch`).
- No company logos/favicons anywhere (copyright decision) — company references are text-only.
- Google News RSS from Workers IPs is unreliable (bot detection may return HTML instead of XML); `company-news.js` returns a `_debug` field when parsing yields no items.
- Lemon Squeezy IDs are not interchangeable: Product ID (1152533) ≠ Variant ID (1803451) ≠ checkout UUID (`564ac14e-...`). The checkout URL uses the UUID.
- X caches OG metadata per-URL indefinitely — share docs are immutable by design; never "update" one expecting the unfurl card to change.
