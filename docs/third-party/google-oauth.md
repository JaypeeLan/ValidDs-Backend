# Google OAuth — Setup Guide

## What It Is

Google OAuth lets users sign into ValidDs with their Google account — no password required. It is the primary and recommended sign-in method.

The flow works like this:
1. User clicks "Sign in with Google" on the frontend
2. Frontend redirects to `GET /api/v1/auth/google`
3. The backend redirects to Google's consent screen
4. User approves — Google redirects back to `GET /api/v1/auth/google/callback`
5. Backend exchanges the code for a user profile
6. Backend finds or creates the user, issues a JWT
7. User is redirected back to the frontend with their token

---

## Step 1: Create a Google Cloud Project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown at the top → **New Project**
3. Name it `ValidDs` (or similar)
4. Click **Create**

---

## Step 2: Enable the Google OAuth API

1. In your project, go to **APIs & Services** → **Library**
2. Search for **Google+ API** or **Google Identity**
3. Click **Enable** on **Google People API** (used for profile info)

---

## Step 3: Configure the OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** (for users outside your organisation)
3. Fill in:
   - **App name**: `ValidDs`
   - **User support email**: your email
   - **Developer contact information**: your email
4. Click **Save and Continue**
5. On the **Scopes** step, add:
   - `openid`
   - `email`
   - `profile`
6. Click **Save and Continue** through the remaining steps
7. Click **Back to Dashboard**

> While in **Testing** mode, only users you add as test users can sign in.
> To go live, click **Publish App** (requires Google review for sensitive scopes — our scopes are non-sensitive).

---

## Step 4: Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `ValidDs Backend`
5. Under **Authorised redirect URIs**, add:
   - For local dev: `http://localhost:3000/api/v1/auth/google/callback`
   - For staging: `https://validds-backend.onrender.com/api/v1/auth/google/callback`
   - For production: `https://api.validds.com/api/v1/auth/google/callback`
6. Click **Create**

You will see your **Client ID** and **Client Secret**. Copy both.

---

## Step 5: Set Your Environment Variables

Add these to your `.env` file:

```env
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/auth/google/callback
FRONTEND_URL=http://localhost:3001
```

For staging on Render, update `GOOGLE_REDIRECT_URI` to your Render URL and add it to the Google Console too.

---

## Step 6: Test the Flow

Start the dev server:

```bash
npm run dev
```

Open in your browser:
```
http://localhost:3000/api/v1/auth/google
```

You should be redirected to Google's consent screen. After approving, you will be redirected back to your frontend with a `?token=...` query parameter.

---

## Frontend Integration

The frontend should:

1. Link or button pointing to `GET /api/v1/auth/google` (or open it in the same window)
2. After redirect back to `/auth/callback`, extract `token` from the URL query params
3. Store the token (localStorage or a secure cookie)
4. Strip the token from the URL (`history.replaceState`)
5. Include the token on subsequent API calls: `Authorization: Bearer <token>`

---

## Security Notes

- **Never log or expose** the `GOOGLE_CLIENT_SECRET`
- **Always use HTTPS** for the redirect URI in staging and production
- The `state` parameter is used to pass the frontend return URL — validate it on callback
- Refresh tokens are stored in MongoDB with `select: false` — they are never returned in API responses
- Google access tokens are NOT stored — only used at login time to fetch the profile

---

## Troubleshooting

**redirect_uri_mismatch**
The redirect URI in your request does not match what is registered in Google Console.
Solution: Add the exact URI from your `.env` to the Google Console's Authorised redirect URIs list.

**This app isn't verified**
Your OAuth consent screen is in Testing mode.
Solution: Add your email as a test user in the consent screen settings, or publish the app.

**403 access_denied**
User clicked "Cancel" or is not a registered test user.
Solution: Add the user's Google account email to the test users list in the consent screen.
