# MongoDB Atlas — Setup Guide

## What It Is

MongoDB Atlas is a cloud-hosted MongoDB service. ValidDs uses the **M0 free tier cluster** for development and staging — it provides 512MB of storage at no cost, which is more than sufficient for V1.

---

## Step 1: Create an Account

1. Go to [https://www.mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Click **Try Free** and sign up with your email or Google account
3. Complete email verification

---

## Step 2: Create a Free Cluster

1. After login, click **Build a Database**
2. Select **M0 Free** (make sure it says $0/month)
3. Choose a cloud provider — **AWS** is recommended
4. Choose the region closest to your team (e.g. `us-east-1` for US)
5. Name your cluster — e.g. `validds-cluster`
6. Click **Create**

Cluster creation takes 1–3 minutes.

---

## Step 3: Create a Database User

You need a user with a username and password to connect.

1. In the left sidebar, go to **Database Access**
2. Click **Add New Database User**
3. Choose **Password** authentication
4. Set a username (e.g. `validds-api`) and a strong password
5. Under **Database User Privileges**, select **Read and Write to Any Database**
6. Click **Add User**

**Save the password somewhere safe.** You will need it in the connection string.

---

## Step 4: Whitelist Your IP Address

Atlas blocks all connections by default. You need to allow your IP.

1. In the left sidebar, go to **Network Access**
2. Click **Add IP Address**
3. For development: click **Add Current IP Address**
4. For production on Render: click **Allow Access From Anywhere** (`0.0.0.0/0`)
   - Note: Render's free tier does not provide a static IP. This is a known limitation for V1.
   - For production hardening, upgrade to Render paid tier (static IP) + restrict Atlas to that IP.
5. Click **Confirm**

---

## Step 5: Get Your Connection String

1. Go to **Database** in the left sidebar
2. Click **Connect** next to your cluster
3. Select **Connect your application**
4. Driver: **Node.js**, Version: **5.5 or later**
5. Copy the connection string — it looks like:
   ```
   mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   ```
6. Replace `<username>` and `<password>` with the credentials from Step 3

---

## Step 6: Set Your Environment Variables

Add these to your `.env` file:

```env
MONGODB_URI=mongodb+srv://validds-api:<password>@validds-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=validds
```

---

## Step 7: Verify the Connection

Start the dev server and check the ready endpoint:

```bash
npm run dev
curl http://localhost:3000/ready
```

You should see `"mongodb": { "status": "ok" }` in the response.

---

## Free Tier Limits (M0)

| Limit | Value |
|---|---|
| Storage | 512 MB |
| RAM | Shared |
| Connections | 500 max |
| Regions | Single region |
| Backups | None (manual only) |

For V1, these limits are more than sufficient. Upgrade to M2 ($9/month) or M5 ($25/month) when you need more storage or guaranteed performance.

---

## Troubleshooting

**Connection timeout**
- Check that your IP is whitelisted in Network Access
- Verify the connection string has the correct username and password

**Authentication failed**
- Double-check the password in your connection string (special characters must be URL-encoded)

**Database name**
- The database (`validds`) is created automatically when the first document is inserted
