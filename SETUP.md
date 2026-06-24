# Galaxy OS — Setup Guide

## Prerequisites
- Node.js 18+ installed
- A Google account for Firebase

---

## Step 1 — Install dependencies

Open terminal in this folder and run:
```
npm install
```

---

## Step 2 — Create Firebase project

1. Go to https://console.firebase.google.com
2. Click **Add project** → name it "Galaxy CRM"
3. Enable **Google Analytics** (optional)
4. Click **Create project**

### Enable Authentication
1. In Firebase Console → **Authentication** → **Get started**
2. Click **Sign-in method** → Enable **Google**
3. Add your company email domain under **Authorized domains** if needed

### Enable Firestore
1. **Firestore Database** → **Create database**
2. Select **Production mode** (your rules are already in `firestore.rules`)
3. Choose region: **asia-south1** (Mumbai)

### Enable Storage
1. **Storage** → **Get started** → Production mode

### Get config keys
1. **Project settings** (gear icon) → **General** → **Your apps**
2. Click **Add app** → Web → Register as "Galaxy CRM Web"
3. Copy the config object

---

## Step 3 — Configure environment

Copy `.env.example` to `.env`:
```
cp .env.example .env
```

Paste your Firebase config values into `.env`:
```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=galaxy-crm.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=galaxy-crm
VITE_FIREBASE_STORAGE_BUCKET=galaxy-crm.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

---

## Step 4 — Deploy Firestore rules

Install Firebase CLI:
```
npm install -g firebase-tools
firebase login
firebase init firestore  (select your project)
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

---

## Step 5 — Run the app

```
npm run dev
```

Open http://localhost:5173

---

## Step 6 — Create your Super Admin account

1. Sign in with your Google account
2. Go to Firebase Console → **Firestore** → `users` collection
3. Find your document (it will have your Google UID)
4. Change `role` from `bd_exec` to `super_admin`
5. Refresh the app — you now have full access

---

## Step 7 — Add team members

1. Open **Settings** → **Team Members**
2. Add each person with their email and role
3. They sign in with their Google account — it auto-matches

---

## Optional — Enable AI features

Add to `.env`:
```
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

This enables:
- Daily Executive Digest (Claude API)
- Lead Qualification scoring
- Voice report transcription
- Content Studio (real AI instead of templates)

Get your API key at https://console.anthropic.com

---

## Build for production

```
npm run build
```

Then deploy to Firebase Hosting:
```
firebase init hosting
firebase deploy
```

---

## Role Assignment Guide

| Person | Role | Department |
|---|---|---|
| Ketan Sir | management | management |
| Smita Ma'am | management | management |
| Krish Sir | management | management |
| BD executives | bd_exec | business_development |
| Project managers | project_manager | project_management |
| Shahid / Majid / Sufi | site_worker | site_operations |
| Marketing team | marketing | marketing |
| AI team | ai_team | ai_department |
| Accounts team | accounts | accounts |
