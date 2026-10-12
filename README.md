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
