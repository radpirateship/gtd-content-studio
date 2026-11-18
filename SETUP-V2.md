# GTD Content Studio v2 — Setup Checklist (for Ryan)

This is a fully separate repo from `gtd-content-studio`. The original app, its
Vercel project, and its traffic are untouched and always available to go back to.

## One-time setup (~10 minutes)

### 1. Publish this repo to GitHub (2 clicks)
- Open **GitHub Desktop** → File → **Add local repository** → choose
  `Documents\GitHub\gtd-content-studio-v2`
- Click **Publish repository** — keep "Keep this code private" CHECKED ✔

### 2. Create the Vercel project
- vercel.com → **Add New → Project** → Import `gtd-content-studio-v2`
- Before clicking Deploy, add Environment Variables (copy the values from the
  ORIGINAL gtd-content-studio project → Settings → Environment Variables):
  - `DATABASE_URL`
  - `SHOPIFY_ACCESS_TOKEN`
  - `ANTHROPIC_API_KEY`
  - `GEMINI_API_KEY`
  - `SITE_PASSWORD` ← NEW. Pick a strong password — this now locks the whole app.
- Click Deploy. The app will ask for the password on first visit (30-day cookie).

### 3. Neon (recommended, 2 min)
- Rotate the database password (Neon dashboard → your project → Settings →
  Reset password) because the old one was committed to GitHub. Update
  `DATABASE_URL` in BOTH Vercel projects afterward.
- Optional: create a Neon **branch** of the database and use that branch's
  connection string for v2, so v2 experiments can never touch production data.

### 4. Housekeeping
- There is a broken half-created folder `GitHub\gtd-content-studio-v2` ONLY IF
  this file is missing from it — if you're reading this inside that folder, it's fine.
- The `v2-upgrade` branch on the ORIGINAL repo is now unused (we went with a
  separate repo instead). Safe to delete on GitHub, or leave it.
- Move `GitHub\github-recovery-codes.txt` into a password manager and delete the file.

## What's already done in this repo (9 commits on main)

1. Junk files removed, `tsconfig.tsbuildinfo` ignored, package renamed
2. Hardcoded Neon DB credentials removed (env var now required)
3. Shopify token no longer displayed in the OAuth callback page (masked)
4. **Writing rules restored** from the pre-Feb-18 version into shared
   `lib/brandRules.ts` — wired into the main article generator with em-dash
   stripping and post-generation brand validation
5. Brand rules also applied to ultimate guides, workshop regeneration, and the
   section editor (which also had a forbidden "float tanks" mention fixed)
6. `lib/ai.ts`: retry with backoff, 90s timeout, env-configurable model
   (`AI_MODEL`), truncation detection
7. Fixed dead featured-image endpoint (invalid `gemini-nano-banana` model name)
8. Bulk queue now actually processes P1 → P2 → P3 in priority order
9. Internal links no longer carry the external-link arrow icon
10. Site-wide password gate (middleware + login page, no fallback password)

## Known pre-existing issues (inherited, untouched so far)
- ~30 TypeScript errors in `app/page.tsx`, `app/api/chat/route.ts`, and
  `app/api/collections/[slug]/route.ts` — currently hidden by
  `ignoreBuildErrors: true` in next.config.mjs. Cleanup scheduled for the
  UI overhaul phase.
- See the audit docs in the "GTD Content Generator Vercel" folder for the full
  roadmap (Phases 2-5: CSV elimination, Shopify product sync with collection
  scoping, Content Refresh bulk rewrite, image upgrades, UI overhaul).
