# TapAct

TapAct is a premium everyday activity time tracker built with Next.js App Router, TypeScript, Tailwind CSS, Lucide icons, and Motion for React.

Users can tap an activity once to start timing, tap again to pause, and switch activities instantly with automatic handoff to the newly tapped activity.

## Phase 1 Features

- Sophisticated mobile-first home dashboard with TapAct branding
- Daily progress, goals completed, and total tracked time summaries
- Activity cards for Coding, Gym, Communication, and Reading
- One-tap start/pause/resume with automatic activity switching
- Timestamp-based timer calculations (stays accurate across inactive tabs)
- Local browser storage persistence (`localStorage`)
- Premium bottom navigation for Home, Insights, History, and Settings
- Responsive layout with clear "Coming soon" indicators for nonimplemented sections

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev -- --port 43123
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123) in your browser.

Build for production:

```bash
npm run build
```

## Tech Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Lucide React
- Motion for React

## Notes

- Phase 1 intentionally excludes auth, backend services, social features, and AI coaching.
- Tracking state is stored only in the browser and resets to a new day automatically based on local date.

## Local Storage Reliability

- State lives under the versioned key `tapact.tracker.v3`; older `v1`/`v2` data is migrated on load and left in place as a backup.
- Every change re-reads the latest stored state, applies the change, and writes it back with an incremented `revision`. Other tabs pick up changes via the `storage` event and on focus/visibility.
- Running time is derived from stored timestamps, so open tabs only re-render the clock and never add time on their own.
- If a write fails (storage full or blocked), tracking continues in memory and a small warning is shown until a later write succeeds.

Known limitations:

- `localStorage` has no cross-tab locking. Two tabs writing in the same instant can still lose one of those two changes.
- If a tab's writes are failing while another tab saves successfully, the failing tab's unsaved changes can be superseded by the other tab's data.
- If `tapact.tracker.v3` becomes unreadable, the app falls back to the older `v2`/`v1` data (if present) or defaults; the corrupt value is not backed up.
- Day boundaries follow the device's current timezone. Changing timezones does not re-assign time that was already recorded.

## Phase 5: Electric Minimalism

- Design tokens (color, type, radius, spacing, motion) live in `app/globals.css` and `lib/motion.ts`.
- The orbit motif (`app/components/Orbit.tsx`) powers the brand mark and the Home "Day Orbit", where each activity's time today is an arc against the daily target and goal satellites light up when met.
- First launch shows a splash and short onboarding (starter activities, optional goals, Skip). Completion is stored under `tapact.prefs.v1`; anyone with existing tracker data skips it automatically.
- Settings → Motion controls animation intensity (Expressive/Subtle) and reduced motion (Match device/Always reduce). The OS `prefers-reduced-motion` setting is always respected.
- UI preferences are stored separately, so the v3 tracker schema and backups are unchanged.

## Phase 6A: Accounts (Supabase Auth)

- `/auth` hosts Sign in, Create account, Forgot password, Set new password and the "check your inbox" states. Continue as guest is always available; nobody is forced to sign in.
- Settings → Account shows guest vs. signed-in state (name, email, verification) and Sign out. Sessions restore automatically, so returning users never see login or onboarding again.
- Signing in, signing out and creating an account never change the local `tapact.tracker.v3` data by themselves. Cloud sync (Phase 6B, below) only starts after the user chooses what to do with this device's data.
- Without `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, the app builds and runs in guest-only mode. Network failures show a calm message and tracking keeps working.

How it fits together:

- `lib/supabase/client.ts` (browser) and `lib/supabase/server.ts` (route handlers) use `@supabase/ssr` with cookie sessions. `proxy.ts` refreshes the session on navigations and passes requests straight through when Supabase is unconfigured or unreachable.
- `app/auth/confirm/route.ts` handles every email link: `token_hash` + `type` (recommended, works across browsers) and the default PKCE `code`. Destinations go through `safeNextPath` (`lib/auth/redirect.ts`), which only allows same-origin paths.
- Only the public publishable key is used. No service-role or secret key is read anywhere.

### Required Supabase configuration

1. **Authentication → URL Configuration**
   - Site URL: `https://tap-act.vercel.app`
   - Redirect URLs: `https://tap-act.vercel.app/auth/confirm**` (add `http://localhost:3000/auth/confirm**` and your preview domain pattern, e.g. `https://*-<team>.vercel.app/auth/confirm**`, if you test there).
2. **Authentication → Email Templates** (recommended, so links work even when opened in a different browser, such as Mail → Safari instead of the installed app):
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
   
   The default `{{ .ConfirmationURL }}` templates also work, but only in the browser that started the flow.
3. Keep "Confirm email" enabled. Minimum password length in Supabase should be 8 or less (the app requires 8 characters with a letter and a number).

### Required Vercel configuration

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for Production (and Preview if you want accounts there). These are inlined at build time, so redeploy after changing them.
- Optional: `NEXT_PUBLIC_SITE_URL=https://tap-act.vercel.app` to force email links to the production domain from any deployment.

## Phase 6B: Offline-first cloud sync

Signed-in users back up activities, goals, archived activities and daily history to Supabase, and see the same data on every device. Guests are unaffected.

**Apply the database migration before deploying:** run `supabase/migrations/20261012220000_tapact_cloud_sync.sql` in the Supabase SQL editor (or `supabase db push`). Until it is applied, Settings shows sync as "Error: Cloud storage for TapAct isn't set up yet" and tracking keeps working locally.

### Data model

The v3 tracker schema is unchanged. Per-day totals alone can't be merged safely (two devices' 30 minutes may be the same 30 minutes), so sync adds the minimum extra metadata beside it:

| Cloud table | Holds | Merge rule |
| --- | --- | --- |
| `tapact_activities` | Activity definitions | Newest edit wins (client timestamp, device id tie-break); archiving is sticky |
| `tapact_time_entries` | Timer segments recorded after sync starts, id `device:activity:start` | Segment end only grows; overlapping segments of one activity are unioned |
| `tapact_daily_baselines` | Pre-sync per-day totals imported from a device | Immutable; identical totals for the same day/activity count once |

Daily totals on every device are rebuilt from these records, so time is never double-counted across devices, retries, or duplicated uploads. The server triggers enforce the same rules, so a stale or replayed upload can't overwrite newer data. RLS limits every row to `auth.uid()`; only the publishable key is used.

### On the device

- Local bookkeeping lives in `tapact.sync.v1` (device id, which account owns the local data, unconfirmed outbox), `tapact.sync.cache.v1` (pulled rows) and `tapact.sync.stash.v1` (data sets kept aside).
- Every tracker commit records its exact timer segment and activity edits into the owner's outbox (`lib/sync/capture.ts`). Items leave the outbox only after the server confirms them.
- Sync runs on sign-in, ~3s after changes, on reconnect, on focus, every 2 minutes while visible, and from **Sync now**, with backoff retries. Web Locks keep one sync at a time across tabs.

### Ownership and account switching

- First sign-in with guest history shows a prompt: **Merge into my account** (with a backup download first), **Keep it on this device only** (sets it aside; nothing uploaded or deleted), or **Decide later** (no sync). An untouched fresh install simply adopts the account.
- Local data remembers its owner. Signing out keeps it; changes made while signed out sync when that account signs in again.
- If a different account signs in, the other account's data is never merged into it. Switching sets it aside on the device and brings it back when its owner signs in.
- Restoring a backup while signed in detaches the local data from the account first, so the file is only uploaded if the user chooses to merge it.

Known limitations: time on different activities at the same moment on two devices is kept for both; day boundaries follow each device's timezone; merging a backup that is already in the account would count it twice (the prompt warns about this).
