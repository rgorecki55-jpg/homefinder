# Rob & Kelly Home Finder — Setup Guide

Total time: ~15 minutes. No coding required beyond copy-paste.

---

## Step 1 — Create a free Supabase account (database)

1. Go to https://supabase.com and click "Start your project"
2. Sign up with GitHub or email
3. Click "New project"
   - Name it: `homefinder`
   - Set a database password (save it somewhere)
   - Region: US East (closest to Charlotte)
4. Wait ~2 minutes for the project to spin up

---

## Step 2 — Create the database table

1. In your Supabase dashboard, click "SQL Editor" in the left sidebar
2. Click "New query"
3. Open the file `SUPABASE_SCHEMA.sql` from this folder
4. Paste the entire contents into the SQL editor
5. Click "Run" (green button)
6. You should see "Success. No rows returned"

---

## Step 3 — Get your Supabase credentials

1. In Supabase dashboard, click "Project Settings" (gear icon, bottom left)
2. Click "API"
3. Copy two things:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — the long string under "Project API keys"

---

## Step 4 — Deploy to Vercel (free hosting)

1. Go to https://vercel.com and sign up with GitHub
2. Click "Add New Project"
3. Click "Import" next to your GitHub repo
   - If you haven't pushed this code to GitHub yet:
     a. Go to https://github.com/new
     b. Create a repo called `homefinder`
     c. Upload all these files (drag and drop the folder)
     d. Come back to Vercel and import it
4. In the "Environment Variables" section, add:
   - Name: `REACT_APP_SUPABASE_URL`  Value: (your Project URL from Step 3)
   - Name: `REACT_APP_SUPABASE_ANON_KEY`  Value: (your anon key from Step 3)
5. Click "Deploy"
6. Wait ~2 minutes
7. Vercel gives you a URL like `https://homefinder-rob.vercel.app`

---

## Step 5 — Share with Kelly

1. Send Kelly the Vercel URL
2. She opens it on her phone or laptop — that's it
3. Any changes either of you make show up for the other within seconds

---

## Add to home screen (optional but recommended)

**iPhone:** Open the URL in Safari → Share button → "Add to Home Screen"  
**Android:** Open in Chrome → three dots menu → "Add to Home Screen"  
**This makes it feel like a native app with one-tap access.**

---

## Costs

Everything used here is free:
- Supabase: free tier (500MB, plenty for home search)
- Vercel: free tier (unlimited deploys for personal projects)
- Total: $0/month

---

## If something goes wrong

Common issues:
- **Blank page on Vercel**: Check that both env variables are set correctly (no spaces, no quotes)
- **Data not syncing**: Make sure you ran the full SQL schema including the `alter publication` line
- **Can't connect to Supabase**: Double-check the Project URL starts with `https://` and ends with `.supabase.co`

