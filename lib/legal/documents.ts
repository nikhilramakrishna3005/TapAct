import { accountDeletionEnabled } from "../account/availability";
import { readSupportEmail } from "./support";

export const LEGAL_UPDATED = "15 October 2026";

export type LegalSection = {
  id: string;
  heading: string;
  paragraphs: string[];
};

export const UNPUBLISHED_SUPPORT =
  "A public support address has not been published yet. TapAct will show an email here after the developer configures one. No sample address is listed in its place.";

export function supportParagraph(email: string | null, deletionOffered = accountDeletionEnabled()): string {
  if (!email) return UNPUBLISHED_SUPPORT;
  const deletion = deletionOffered
    ? "Writing to it does not delete an account. Delete the account from Settings → Account."
    : "Writing to it does not delete an account. Account deletion is not currently offered in the app.";
  return `You can contact the developer at ${email}. That address is for product and privacy questions. ${deletion}`;
}

export function deletionParagraphs(deletionOffered: boolean): string[] {
  const request = deletionOffered
    ? "You delete the account from Settings → Account. You sign in again, type the account email, and confirm that the deletion is permanent. A refreshed session is not a new sign-in. The account is not deleted until sign-in removal succeeds. If that last step fails, sign in again and retry. The retry does not restore the personal data already prepared for deletion. If this browser cannot clear its local copy after the account is deleted, the account is still gone. Clear that leftover copy on this device without signing in again."
    : "Account deletion is not currently offered on this site. The Settings control stays off until the database update is applied and the full flow has been checked. When it is offered, you will delete the account from Settings → Account after signing in again and typing your email.";
  return [
    request,
    "Deletion removes the sign-in, synced activities and sessions, imported baselines, push subscriptions, notification preferences, the private notification inbox, and the duel character. Signing out is not deletion.",
    "A shared duel can remain for the other member. The deleted member is shown as Former member. Their score is frozen at deletion, and the time zone saved when they joined stays so the recap can still be calculated. The other member's own history is not deleted, and creator privileges are not transferred.",
    "A push notification already delivered to a device cannot be recalled. A notice that only says Player, or a sentence that uses the same display name as the other member, can remain because it cannot be attributed safely. Proposal notes and private tracker links are removed. The shared activity names and targets stay.",
  ];
}

export function privacySections(email: string | null = readSupportEmail(), deletionOffered = accountDeletionEnabled()): LegalSection[] {
  return [
    {
      id: "who",
      heading: "Who offers TapAct",
      paragraphs: [
        "TapAct is a free, early-stage activity tracker. This policy describes the TapAct app at tap-act.vercel.app and the data that app stores.",
        "The app does not name a registered company, a street address, or a home jurisdiction. The developer is an individual publisher of this project.",
        supportParagraph(email),
      ],
    },
    {
      id: "account",
      heading: "Account email and authentication",
      paragraphs: [
        "An account is optional. You can track as a guest without an email address. If you create an account, TapAct asks for your name, email address, and a password. The name and email are sent to Supabase Auth, which stores the account and the sign-in credential. TapAct does not keep a copy of your password in its activity history.",
        "Supabase can send a verification email and a password-reset email. Those messages contain a one-time link back to TapAct. Whether you can use the account before you confirm the email depends on the authentication project's settings. The app shows a verified or not-verified badge. It does not, by itself, block tracking when the badge says the email is not verified.",
        "A signed-in session is kept in this browser so you stay signed in across visits, including when you are offline. Signing out clears that session on this device and asks this device to stop receiving push notifications. Signing out does not delete your activities, your cloud backup, or your account.",
      ],
    },
    {
      id: "local",
      heading: "Activities, goals, and time sessions on this device",
      paragraphs: [
        "Activity names, icons, colors, daily goals, categories, archived activities, and timer sessions are stored in this browser first. A running timer is saved as timestamps, not as a ticking counter. Daily totals, including time that crosses midnight on the device clock, are rebuilt from those timestamps.",
        "Appearance, motion preferences, onboarding progress, and sync bookkeeping stay on the device as well. A backup file you export is a download you control. TapAct does not receive that file unless you import it again on a device.",
        "Someone else who can open this browser profile can see the activities stored here. After you sign out, that local history remains on the device until you remove the site's saved data or sign in with another account and set it aside.",
      ],
    },
    {
      id: "sync",
      heading: "Optional cloud synchronization",
      paragraphs: [
        "Cloud sync is off until you have an account and you choose what to do with the data already on the device. Guest history is not uploaded on its own. Creating an account does not, by itself, upload that history.",
        "If you merge this device into your account, TapAct uploads activity definitions, goals, archive state, timer segments recorded after sync starts, and a one-time baseline of earlier daily totals. Later edits wait in an outbox on the device and are sent again until the server accepts them. The same account can receive that backup on another device.",
        "Those rows live in a Supabase Postgres database. Database rules limit each row to the signed-in account. If a different account signs in on this device, the previous account's local data is set aside on the device and is not merged into the new account.",
        "You can keep using TapAct when the network fails. Changes stay on the device and sync when a connection is available and the account that owns them is signed in.",
      ],
    },
    {
      id: "duels",
      heading: "What a Duel opponent can see",
      paragraphs: [
        "A Duel is a private 1:1 challenge. Your opponent can see the name stored on your account, unless that name is missing or looks like an email address, in which case the label Player is used. Your email address is not used as that name. They can also see the duel title, the agreed activity names and daily targets, the length and start date, your status, the time zone saved when you joined, and the arena character you chose (its look and title).",
        "Scores are calculated on the server from timer sessions on activities you connect to the duel. Your opponent can see the resulting points and, for each duel day, how many of those timer minutes counted toward each agreed activity. Sessions you add or edit by hand in Time Rescue stay in your own history and are not part of the score. Activities you never connect, and the private names of those activities, are not part of the duel board.",
        "Live presence is off until you turn on “Share when I'm tracking a duel activity.” While it is on, your opponent can see which agreed duel activity is currently running. They do not see a private activity that is not part of the duel. “Mute their live status” hides their live activity from you. It does not hide yours from them.",
        "An invitation link contains a secret token. TapAct stores only a hash of that token. Anyone who has the link can preview the duel title, dates, agreed activities, targets, and the inviter's display name until the link expires, is revoked, or is used. Accepting the invite requires that person's own account.",
        "In-app duel notices are stored for the recipient. A notice can name the other person and the duel event, such as an accepted invite, a start, a rule proposal, a finish, or someone leaving. It is not a copy of your session history.",
      ],
    },
    {
      id: "push",
      heading: "Optional push notifications",
      paragraphs: [
        "Push is off until you allow it. TapAct then stores this device's push subscription — the endpoint address and the keys the browser provides — with your account in Supabase. You can pause notifications, turn off individual duel events, or disable this device.",
        "A notice's delivered text is a short title, a short body, and a link back to that duel. It does not include your activity list or timer history. The browser's push service (Apple, Google, Mozilla, or Microsoft, depending on the browser) receives that text in order to deliver it. TapAct accepts subscription endpoints only for those providers' push hosts.",
        "On iPhone and iPad, Web Push works in the installed Home Screen app, not in a Safari tab. When a duel notice is created, Supabase can start delivery by calling TapAct through a Database Webhook. A scheduled Vercel cron runs as the fallback. Delivery is not guaranteed to be immediate.",
        "Signing out asks this device to drop its subscription. The account's other devices are unchanged until they are disabled or the account is removed.",
      ],
    },
    {
      id: "retention",
      heading: "How long data stays, and account deletion",
      paragraphs: [
        "Local activities stay in this browser until you clear the site's saved data, replace them by importing a backup, the account that owns them is deleted on this device, or the browser removes stored data. Cloud activities, duel membership, in-app notices, and push subscriptions stay for as long as the account exists.",
        ...deletionParagraphs(deletionOffered),
        "Clearing this browser's site data removes the copy on this device only. It does not remove data already synced to the account or already shared with a duel opponent.",
      ],
    },
    {
      id: "processors",
      heading: "Infrastructure",
      paragraphs: [
        "TapAct uses Supabase for accounts, the Postgres database, and row-level access rules. The website runs on Vercel. Push delivery is event-triggered through a Supabase Database Webhook, with a scheduled Vercel cron as the fallback. When push is enabled, the browser's push service delivers the notice.",
        "The app does not include an advertising network or a product-analytics or crash-reporting service. Connections to TapAct and Supabase use HTTPS.",
      ],
    },
    {
      id: "choices",
      heading: "Choices you can make now",
      paragraphs: [
        "Use TapAct as a guest and skip an account. If you do create an account, you choose whether this device's existing history joins that account, stays only on the device, or waits for a later decision.",
        "Skip duels. If you join one, leave it later, keep live sharing off, and mute the other person's live status. Connect only the activities you want to count.",
        "Leave push off, pause it, disable one device, or turn off individual duel events. Export a backup from Settings. Sign out when you are finished on a shared device, and be aware the activities remain stored in that browser until they are removed there.",
        "Appearance, motion, and reduced-motion preferences stay on the device. The app follows Light, Dark, or System appearance, and it respects a request for reduced motion.",
      ],
    },
    {
      id: "changes",
      heading: "Changes to this policy",
      paragraphs: [
        `This policy was last updated on ${LEGAL_UPDATED}. If the data TapAct collects changes, this page will change with it. The app does not email you a separate notice of policy edits today.`,
      ],
    },
  ];
}

export function termsSections(email: string | null = readSupportEmail(), deletionOffered = accountDeletionEnabled()): LegalSection[] {
  return [
    {
      id: "service",
      heading: "The service",
      paragraphs: [
        "TapAct is a free, early-stage way to track everyday activities on your own device, with an optional account, optional cloud backup, optional private 1:1 duels, and optional push notifications.",
        "These terms are the house rules for using the app. They are not a company contract. No registered company, office, or jurisdiction is stated here because none is identified for this project.",
      ],
    },
    {
      id: "accounts",
      heading: "Your account and your data",
      paragraphs: [
        "You can use TapAct without an account. If you create one, you need an email address you can access and a password that meets the form's rules. You are responsible for keeping that sign-in to yourself.",
        "Activity history on a device stays on that device until you choose to sync it. Please read the privacy policy for what is stored locally, what an optional backup contains, and what a duel opponent can see.",
        deletionOffered
          ? "You can permanently delete the account from Settings → Account after signing in again and typing your email. Signing out does not delete it. The privacy policy describes what is removed and what a shared duel keeps."
          : "Account deletion is not currently offered. Signing out does not close the account or erase cloud data. The privacy policy describes what deletion removes and keeps when it is offered.",
      ],
    },
    {
      id: "use",
      heading: "Using duels and notifications",
      paragraphs: [
        "Use duels only with someone you intend to challenge. Invitation links are secrets. Do not post a link where strangers can open it. Do not attempt to read another person's private activities or to interfere with their account.",
        "Push notifications are optional. You can turn them off by device or by event. Delivery can be late, and a notice might not arrive.",
      ],
    },
    {
      id: "availability",
      heading: "Early-stage software",
      paragraphs: [
        "TapAct can change, pause, or drop features while it is early. Tracking can be wrong if the device clock changes, if browser storage is full, or if two tabs save at the same moment. Keep an export from Settings if you need your own copy.",
        "The app is offered for personal tracking. Nothing in TapAct is a promise of fitness, health, or competitive results.",
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      paragraphs: [supportParagraph(email, deletionOffered), "The privacy policy is part of these terms. If the two disagree about what data is stored, the privacy policy is the one to follow."],
    },
  ];
}
