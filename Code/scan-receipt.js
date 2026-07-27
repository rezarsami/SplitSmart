// ============================================================================
//  /api/scan-receipt  —  serverless proxy for the Groq vision call
// ----------------------------------------------------------------------------
//  WHY THIS FILE EXISTS:
//  The browser must never see the Groq API key. So the front end sends the
//  receipt image to THIS function instead of to Groq directly. This function
//  runs on a server (locally: the Vercel dev server; in production: Vercel's
//  serverless platform), reads the key from an environment variable, calls
//  Groq, and returns only the parsed result to the browser. The key never
//  leaves the server.
//
//  Works out of the box on Vercel (an /api folder with a default-export
//  handler). For Netlify, see the note at the bottom.
// ============================================================================

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Groq's current vision-capable model. If Groq renames it, update here.
const MODEL = "meta-llama/llama-4-maverick-17b-128e-instruct";

const PROMPT =
  "You are parsing a restaurant or store receipt image. Extract the line items, tax, and tip. " +
  "Return ONLY a JSON object (no markdown, no commentary) with this exact shape: " +
  '{"items":[{"name":"string","price":number}],"tax":number,"tip":number}. ' +
  "Rules: prices are numbers with no currency symbols. If a line has a quantity, fold it into " +
  'the name (e.g. "2x Latte" -> name "Latte (x2)", price = the line total). If tax or tip is not ' +
  "present, use 0. Do NOT include subtotal or total as line items. If you cannot read the receipt, " +
  'return {"items":[],"tax":0,"tip":0}.';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === "paste-your-groq-key-here") {
    res.status(500).json({
      error:
        "No Groq API key configured. Add GROQ_API_KEY to your .env file (local) " +
        "or your host's Environment Variables (production).",
    });
    return;
  }

  try {
    // The browser sends { image: "<base64>", mediaType: "image/jpeg" }
    const { image, mediaType } = req.body || {};
    if (!image) {
      res.status(400).json({ error: "No image provided." });
      return;
    }

    const dataUri = `data:${mediaType || "image/jpeg"};base64,${image}`;

    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
        temperature: 0,
        max_completion_tokens: 1000,
        response_format: { type: "json_object" },
      }),
    });

    if (!groqRes.ok) {
      const detail = await groqRes.text();
      res.status(groqRes.status).json({ error: `Groq API error: ${detail}` });
      return;
    }

    const data = await groqRes.json();
    const text = data.choices?.[0]?.message?.content || "";

    // The model is asked for pure JSON, but strip fences just in case.
    const clean = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      res.status(502).json({ error: "The receipt could not be parsed into items." });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown server error." });
  }
}

// ============================================================================
//  NETLIFY NOTE:
//  Netlify uses a slightly different function signature. If you deploy to
//  Netlify instead of Vercel, create netlify/functions/scan-receipt.js with:
//
//    exports.handler = async (event) => {
//      const { image, mediaType } = JSON.parse(event.body || "{}");
//      ... same logic ...
//      return { statusCode: 200, body: JSON.stringify(parsed) };
//    };
//
//  and set the fetch URL in the front end to /.netlify/functions/scan-receipt
// ============================================================================
