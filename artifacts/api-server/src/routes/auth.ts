// Google OAuth 2.0 callback — used for initial setup to obtain GOOGLE_REFRESH_TOKEN.
// After the first authorisation, copy the printed refresh token into your environment
// variables (GOOGLE_REFRESH_TOKEN) and you won't need this flow again.
import { Router } from "express";
import { makeOAuth2Client, GOOGLE_SCOPES } from "../lib/googleAuth";
import { logger } from "../lib/logger";

const router = Router();

// Step 1 — redirect admin to Google consent screen
router.get("/auth/google", (_req, res) => {
  const client = makeOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_SCOPES,
    prompt: "consent",        // force refresh_token to be returned every time
  });
  res.redirect(url);
});

// Step 2 — Google redirects back here with ?code=...
router.get("/auth/callback/google", async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    return res.status(400).send("Missing authorisation code.");
  }

  try {
    const client = makeOAuth2Client();
    const { tokens } = await client.getToken(code);

    logger.info({ scopes: tokens.scope }, "Google OAuth tokens received");

    // Return the refresh token to the admin so they can add it to env vars
    res.send(`
      <html>
        <body style="font-family:monospace;padding:2rem;background:#0d1b2a;color:#e0f0ff">
          <h2 style="color:#29B8D9">Google OAuth Authorised ✓</h2>
          <p>Copy the value below and add it as <strong>GOOGLE_REFRESH_TOKEN</strong> in your environment variables.</p>
          <pre style="background:#091320;padding:1rem;border-radius:8px;word-break:break-all;color:#29B8D9">${tokens.refresh_token ?? "(no refresh token — re-run with prompt=consent)"}</pre>
          <p style="color:#aaa;font-size:.85rem">You only need to do this once. Once GOOGLE_REFRESH_TOKEN is set, this route is no longer needed for normal operation.</p>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error({ err }, "Google OAuth callback failed");
    res.status(500).send("OAuth callback failed — check server logs.");
  }
});

export default router;
