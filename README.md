# SplitSmart — itemized receipt splitting (prototype)

A concept feature for a Venmo-style payments app: scan a receipt, let AI parse
the line items, assign each item to the people who shared it, and auto-distribute
tax and tip proportionally to what each person ordered. Prototype only — no real
payments are sent.

The receipt scanning uses Groq's vision API, called through a small serverless
proxy so the API key stays server-side and never reaches the browser.

---

## Prerequisites

- **Node.js** installed (check with `node -v`). If missing, get it from nodejs.org.
- A **free Groq API key** from https://console.groq.com → API Keys → Create API Key.

## 1. Add your API key

Open `.env` and paste your key between the quotes:

```
GROQ_API_KEY="gsk_your_actual_key_here"
```

`.env` is gitignored, so it will not be committed. Never share this key.

## 2. Install dependencies

```
npm install
```

## 3. Run it locally

Because this app has BOTH a front end and a serverless function (`/api`), the
simplest way to run both together locally is the Vercel CLI:

```
npm install -g vercel      # one time
vercel dev
```

`vercel dev` serves the front end and the `/api/scan-receipt` function on one
URL (usually http://localhost:3000), so receipt scanning works end to end.

**Front-end only (no scanning):** if you just want to see the UI and use the
"Try a sample receipt" / "Enter items manually" paths, you can run:

```
npm run dev
```

...but the scan button won't work this way, because the `/api` function isn't
served by plain Vite. Use `vercel dev` for the full experience.

## 4. Deploy

1. Push this folder to GitHub (the `.env` file will be excluded automatically).
2. Import the repo at vercel.com.
3. In the Vercel project's **Settings → Environment Variables**, add:
   - Name: `GROQ_API_KEY`
   - Value: your Groq key
4. Deploy. Vercel serves the front end and the `/api` function together, and
   the key lives only in Vercel's settings — never in your code or repo.

---

## How it works

- **Scan** → the image is sent to `/api/scan-receipt`, which calls Groq's vision
  model and returns structured `{ items, tax, tip }`.
- **Review** → parsed items appear in an editable list so you can fix any
  misreads before splitting. (This step is the honest answer to "what if the AI
  gets it wrong.")
- **Assign** → tap who shared each item; shared items split evenly among them.
- **Split** → tax and tip are distributed proportionally to each person's
  item subtotal, then per-person requests are generated.

## Scope / limitations (by design)

- No real payments, accounts, or persistence — this is a portfolio prototype.
- Receipt parsing quality depends on photo clarity; the review step exists to
  catch mistakes.
- The vision model is an open-weight model via Groq's free tier; accuracy on
  messy receipts is a known tradeoff, discussed in the accompanying PRD.
