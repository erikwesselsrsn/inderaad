# Raadsspel — Deployment Guide

## Wat je nodig hebt (eenmalig)

| Service | Wat | Gratis? |
|---------|-----|---------|
| **Netlify** | Hosting + serverless functions | ✅ Gratis tier |
| **Supabase** | Authenticatie | ✅ Gratis tier |
| **Firebase** | Realtime multiplayer database | ✅ Spark plan |
| **Anthropic** | AI spelleider (Claude Haiku) | Betaald per gebruik |

---

## Stap 1 — Supabase instellen

1. Ga naar [supabase.com](https://supabase.com) → **New project**
2. Geef het project een naam (bijv. "raadsspel")
3. Wacht tot het project klaar is (~2 min)
4. Ga naar **Project Settings → API**
5. Noteer:
   - **Project URL** → dit is `SUPABASE_URL`
   - **anon public** key → dit is `SUPABASE_ANON_KEY`

> Email confirmatie uitzetten (optioneel voor testen):  
> Authentication → Providers → Email → zet "Confirm email" uit

---

## Stap 2 — Firebase instellen

1. Ga naar [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
2. Geef het een naam (bijv. "raadsspel"), zet Google Analytics uit
3. Ga naar **Build → Realtime Database → Create database**
4. Kies **Start in test mode** (30 dagen open, genoeg om te testen)
5. Noteer de **Database URL** (eindigt op `.firebaseio.com`) → `FIREBASE_DATABASE_URL`
6. Ga naar **Project Settings → General → Web API Key** → `FIREBASE_API_KEY`

---

## Stap 3 — Netlify deployen

### Optie A — Via GitHub (aanbevolen)

1. Push deze map naar een GitHub repository:
   ```
   git init
   git add .
   git commit -m "Raadsspel v1"
   git remote add origin https://github.com/jouwgebruiker/raadsspel.git
   git push -u origin main
   ```

2. Ga naar [netlify.com](https://netlify.com) → **Add new site → Import from Git**
3. Kies je repository → **Deploy site**

### Optie B — Via Netlify CLI (drag & drop)

```bash
npm install -g netlify-cli
netlify deploy --prod --dir .
```

---

## Stap 4 — Environment variables instellen in Netlify

Ga naar je Netlify site → **Site configuration → Environment variables → Add variable**

Voeg deze 4 variabelen toe:

| Variabele | Waarde |
|-----------|--------|
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` |
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | `eyJhbGc...` |
| `FIREBASE_DATABASE_URL` | `https://raadsspel-default-rtdb.firebaseio.com` |
| `FIREBASE_API_KEY` | `AIzaSy...` |

Klik daarna op **Trigger deploy → Deploy site** om de wijzigingen door te voeren.

---

## Stap 5 — Supabase redirect URL instellen

1. Ga naar Supabase → **Authentication → URL Configuration**
2. Voeg toe bij **Redirect URLs**: `https://jouw-site.netlify.app`
3. Sla op

---

## Klaar!

Open `https://jouw-site.netlify.app` — je ziet het inlogscherm.  
Registreer een account, log in, en start een spel.

---

## Lokaal testen

Maak een `.env` bestand aan in de root:

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
FIREBASE_DATABASE_URL=https://raadsspel-default-rtdb.firebaseio.com
FIREBASE_API_KEY=AIzaSy...
```

Installeer dependencies en start:

```bash
npm install
npm install -g netlify-cli
netlify dev
```

Open `http://localhost:8888`

---

## Projectstructuur

```
raadsspel/
├── netlify.toml              ← Netlify configuratie
├── package.json              ← Dependencies
├── README.md                 ← Deze handleiding
├── public/
│   └── index.html            ← Het volledige spel
└── netlify/
    └── functions/
        ├── index.mjs         ← Injecteert env vars in HTML
        └── gm.mjs            ← Beveiligde Anthropic API proxy
```

## Architectuur

```
Browser
  │
  ├── Supabase Auth ──────────── Login / registratie / sessies
  │
  ├── Firebase Realtime DB ───── Multiplayer sync (spelers, beurten, berichten)
  │
  └── /api/gm (Netlify Fn) ──── Anthropic API aanroep (key NOOIT in browser)
        │
        └── Claude Haiku ──────── AI spelleider
```

De Anthropic API key verlaat **nooit** de server. De browser stuurt alleen zijn  
Supabase JWT mee als autorisatie, de Netlify Function controleert dit en roept  
Claude aan met de server-side key.
