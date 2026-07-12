# Ssurd — Technical Specification

> AI-powered cover letter analyzer with real-time company intelligence.

---

## Architecture Overview

```
Browser (HTML/JS)
    │
    ├── Firebase Auth (Google Sign-In, client SDK v10.12.0)
    │
    └── Cloudflare Pages
            ├── Static files  (write.html, pricing.html, index.html, style.css)
            └── Functions/api/
                    ├── analyze.js       → POST /api/analyze
                    ├── company-news.js  → GET  /api/company-news
                    └── lemon-webhook.js → POST /api/lemon-webhook
```

---

## Environment Variables (Cloudflare Pages)

| Key | Description |
|-----|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `LEMON_WEBHOOK_SECRET` | Lemon Squeezy webhook signing secret |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON (stringified) — used by webhook to write Firestore |

---

## Files

```
Ssurd/
├── index.html              # Landing page
├── write.html              # Main app (cover letter input + results)
├── pricing.html            # Pricing page with Lemon Squeezy checkout
├── style.css               # Global styles (do not modify)
├── SPEC.md                 # This file
└── functions/
    └── api/
        ├── analyze.js          # Cover letter analysis endpoint
        ├── company-news.js     # Company news fetch endpoint
        └── lemon-webhook.js    # Lemon Squeezy subscription webhook
```

---

## API Endpoints

### `POST /api/analyze`

Analyzes a cover letter using Claude and returns a structured report.

**Auth:** `Authorization: Bearer <Firebase ID Token>`

**Request Body:**
```json
{
  "jobTitle": "Product Manager",
  "coverLetter": "...",
  "companies": [
    { "name": "Google" },
    { "name": "Meta" }
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "report": {
    "score": 72,
    "grade": "B",
    "summary": "...",
    "scores": {
      "relevance": 80,
      "specificity": 65,
      "clarity": 75,
      "authenticity": 70,
      "impact": 60
    },
    "strengths": [
      { "title": "...", "detail": "..." }
    ],
    "improvements": [
      { "issue": "...", "why": "...", "before": "...", "after": "..." }
    ],
    "keywords": {
      "matched": ["leadership", "roadmap"],
      "missing": ["OKRs", "A/B testing"]
    },
    "oneLineTip": "...",
    "companyInsights": [
      {
        "company": "Google",
        "domain": "google.com",
        "news": [
          {
            "title": "...",
            "url": "https://...",
            "source": "reuters.com",
            "summary": "..."
          }
        ]
      }
    ]
  }
}
```

**Plan gating:**

| Plan | Monthly limit | Company Intelligence |
|------|-------------|---------------------|
| `free` | 3 | ✗ |
| `starter` | 10 | ✓ |
| `admin` | unlimited | ✓ |

**Logic flow:**
1. Verify Firebase ID token (WebCrypto RS256, no SDK)
2. Fetch Firestore `users/{uid}` with user's own token → read `plan`, `monthlyUsage`, `monthlyUsageMonth`
3. Enforce usage limit
4. If `starter`/`admin` and `companies` provided → fetch Google News RSS for each company (parallel, 5s timeout each)
5. Call Claude `claude-sonnet-4-6` with prompt including news context
6. Parse JSON from Claude response
7. PATCH Firestore `users/{uid}` to increment usage counter
8. Return report

---

### `GET /api/company-news`

Fetches latest news for up to 3 companies from Google News RSS.

**Auth:** None (public endpoint, called from client before analysis)

**Query params:** `?companies=Google,Meta,McKinsey`

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "company": "Google",
      "news": [
        {
          "title": "Google expands AI infrastructure...",
          "url": "https://news.google.com/...",
          "source": "Reuters",
          "pubDate": "Sat, 05 Jul 2026 09:00:00 GMT"
        }
      ]
    }
  ]
}
```

**RSS source:** `https://news.google.com/rss/search?q={company}&hl=en-US&gl=US&ceid=US:en`

**Known issue:** Google News RSS may block Cloudflare Workers IPs or return HTML (bot detection). Debug info returned in `_debug` field when `news: []`.

---

### `POST /api/lemon-webhook`

Handles Lemon Squeezy subscription lifecycle events.

**Auth:** `X-Signature` header (HMAC-SHA256 hex, verified against `LEMON_WEBHOOK_SECRET`)

**Handled events:**
- `subscription_created`
- `subscription_updated`

**Logic:**
1. Verify HMAC signature
2. Extract `uid` from `meta.custom_data.uid`
3. Determine plan: `active`/`trialing` → `'starter'`, else → `'free'`
4. Get Google OAuth2 access token via Firebase service account RS256 JWT
5. PATCH Firestore `users/{uid}` field `plan`

---

## Firestore Schema

**Collection:** `users`  
**Document ID:** Firebase Auth UID

```
users/{uid}
├── email              : string
├── plan               : "free" | "starter" | "admin"
├── monthlyUsage       : integer (string-encoded in Firestore integerValue)
└── monthlyUsageMonth  : string  e.g. "2026-07"
```

All Firestore writes from `analyze.js` use the user's own Firebase ID token (Firestore security rules must allow `users/{uid}` read/write for authenticated owner).

Firestore writes from `lemon-webhook.js` use a Google OAuth2 access token derived from the Firebase service account (bypasses client security rules, requires service account JSON in env vars).

---

## Authentication

### Client → Firebase
- Provider: Google Sign-In (`GoogleAuthProvider`)
- SDK: `firebase/auth` v10.12.0 (ESM CDN)
- After sign-in: `getIdToken()` → included in `Authorization: Bearer` header on every API call

### Server-side token verification (`analyze.js`)
- No Firebase Admin SDK (not available in Workers)
- Manual JWT verification via WebCrypto:
  1. Decode header/payload from base64url
  2. Check `exp`, `aud`, `iss`, `sub`
  3. Fetch Google public keys from `googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`
  4. Verify RS256 signature

### Webhook → Firestore (service account flow)
- Parse service account JSON from `FIREBASE_SERVICE_ACCOUNT` env var
- Build RS256 JWT with scope `https://www.googleapis.com/auth/datastore`
- POST to `https://oauth2.googleapis.com/token` → get `access_token`
- Use token in Firestore REST API calls

---

## Payments (Lemon Squeezy)

| Property | Value |
|----------|-------|
| Store | ssurd.lemonsqueezy.com |
| Product ID | 1152533 |
| Variant ID | 1803451 |
| Checkout UUID | `564ac14e-d752-41eb-a45c-f7f187b37dc4` |
| Price | $9 / month |
| Type | Subscription (Merchant of Record) |

**Checkout URL:**
```
https://ssurd.lemonsqueezy.com/checkout/buy/564ac14e-d752-41eb-a45c-f7f187b37dc4
  ?checkout[custom][uid]={firebase_uid}
  &checkout[email]={user_email}
```

`uid` is passed as Lemon Squeezy custom data → received in webhook → used to update Firestore.

**Webhook URL to register in Lemon Squeezy dashboard:**  
`https://ssurd.pages.dev/api/lemon-webhook`

**Events to subscribe:** `subscription_created`, `subscription_updated`

---

## Claude Integration

**Model:** `claude-sonnet-4-6`  
**Max tokens:** 2500  
**API version:** `2023-06-01`

**Prompt structure:**
- Persona: 20-year HR director who reviewed 10,000+ cover letters
- Input: `[Target Role]`, `[Cover Letter / Resume]`, optionally `[Target Companies — Recent News]`
- Scoring: 5 dimensions (Relevance, Specificity, Clarity, Authenticity, Impact), each 0–100
- Output: strict JSON only (no surrounding text)

---

## write.html — Key UI State

```js
let cUserPlan = 'free';       // loaded from Firestore on auth
let selectedCos = [];          // array of {name} objects, max 3
let newsCache = {};            // { "CompanyName": [{title,url,source,pubDate}] }
let activeNewsTab = null;      // company name of active news tab
let roleDDOpen = false;        // role dropdown open state
let coDDOpen = false;          // company dropdown open state
```

**Role options:** 7 categories, 80+ roles (defined in `ROLES` object)  
**Company options:** 9 categories, 80+ companies (defined in `CO_GROUPS` object)

**News panel flow:**
1. User selects company → `renderSelectedCos()` → `updateNewsPanel()`
2. `updateNewsPanel()` renders tabs, calls `fetchAndShowNews(company)` for active tab
3. `fetchAndShowNews()` hits `/api/company-news?companies={name}`, caches result, calls `renderNewsList()`
4. News visible before user writes cover letter — for pre-analysis research

**Analysis flow:**
1. `startAnalysis()` sends `{ jobTitle, coverLetter, companies: selectedCos }` to `/api/analyze`
2. Results rendered in `renderResult(report)`
3. `companyInsights` section rendered in `#ciSec` below main results

---

## Deployment

```bash
npx wrangler pages deploy . --project-name ssurd
```

Or push to GitHub → Cloudflare Pages auto-deploys from connected repo.

**Local dev:**
```bash
npx wrangler pages dev . --port 8788 \
  --binding ANTHROPIC_API_KEY=... \
  --binding LEMON_WEBHOOK_SECRET=... \
  --binding FIREBASE_SERVICE_ACCOUNT='...'
```

> Firebase Google Sign-In requires adding `localhost` to authorized domains in Firebase Console → Authentication → Settings.

---

## Plan Gating Summary

| Feature | free | starter | admin |
|---------|------|---------|-------|
| Monthly analyses | 3 | 10 | unlimited |
| Company selector | view only | up to 3 | up to 3 |
| Company news panel | ✗ | ✓ | ✓ |
| Company insights in result | ✗ | ✓ | ✓ |
| Checkout | ✓ | current plan | — |
