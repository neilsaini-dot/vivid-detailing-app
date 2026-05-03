// Standard Google OAuth 2.0 — uses GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
// Single OAuth client shared by both Google Calendar and Google Drive.
import { OAuth2Client } from "google-auth-library";

export const GOOGLE_REDIRECT_URI = "https://book.vividpei.com/api/auth/callback/google";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.file",
];

export function makeOAuth2Client(): OAuth2Client {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

/** Returns a fresh access token, using the stored refresh token to renew when needed. */
export async function getAccessToken(): Promise<string> {
  const client = makeOAuth2Client();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      "GOOGLE_REFRESH_TOKEN is not set. Visit /api/auth/google to complete the OAuth flow."
    );
  }
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain Google access token");
  return token;
}

/** Authenticated fetch wrapper for any Google API. */
export async function googleFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getAccessToken();
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}
