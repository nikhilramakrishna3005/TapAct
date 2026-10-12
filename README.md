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
