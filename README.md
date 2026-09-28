# Volume Competition 2026 — session edition

Overwrite index.html, style.css and app.js together in the existing GitHub Pages
repository. The Firebase project configuration is already included. No build step.
Paste the entire firestore.rules file into Firebase Console → Firestore Database
→ Rules, replacing the old rules, and publish. Keep Email/Password authentication
enabled. GitHub Pages does not publish Firestore rules for you.

## Behaviour
- Competition: 1 November–31 December 2026 inclusive, Australia/Brisbane dates.
  END in app.js is exclusive. Practice sessions count in lifetime stats, heatmap,
  streak, weekly boss and weekly chart, but not the competition leaderboard/payout.
- Payout: winner's own cumulative competition volume / 1000 in AUD.
- Each live session contains up to 12 exercise blocks. Add another block for
  changed weight/reps. Pure bodyweight is excluded; enter added external load only.
- Routine templates include exercise names, weight, reps and sets. A routine with
  the same case-insensitive name overwrites that user's existing routine.
- Ghost hints show all matching blocks in the most recent session for that lift.
- Stopwatch resumes from the start timestamp after backgrounding/reloading.
  The optional rest timer survives backgrounding but resets on reload/sign-out;
  vibration depends on device/browser support. Background notifications are not
  guaranteed; countdown catches up when the app returns to the foreground.
- Streak: distinct training dates in the current chain. The gap from the previous
  session's end to the next start must be strictly less than 48 hours; the streak
  expires 48 hours after the last end. Two sessions on one date count once.
- Weekly boss rotates Deadlift → Squat → Bench Press by Brisbane Monday. Exercise
  matching ignores case and extra spaces but not alternate exercise names. For
  example, Romanian Deadlift is not Deadlift. All matching blocks within one
  session are summed; best single session wins. Ties share the current badge.
- Ghost racer: this week's daily/cumulative volume, plus selected opponent's
  actual previous-week data aligned Monday–Sunday. It is not a forecast.
- Heatmap: rolling 91 calendar days; daily volume sets colour intensity.
- RPG comparison assumes an illustrative 6,000 kg per African elephant.
- Crown: unique global competition leader only. No crown for a tie or one athlete.
  Tug-of-war compares you with the selected opponent (default highest-ranked other).
- Username cooldown begins at registration, then resets on each change. Existing
  legacy profiles without nameChangedAt get one change, then enter the cooldown.
  Firestore request.time and timestamps enforce this; editing the browser clock
  does not bypass the server rule. Profile deletion is deliberately prohibited.

## Offline use
Firestore IndexedDB persistence uses persistentLocalCache with multi-tab support.
Session drafts and a durable session outbox are also stored on this browser,
partitioned by Auth UID. Finish immediately queues the entire session document
under a stable ID. It stays marked pending until server acknowledgement. Failed
writes are retained locally and can be retried from History after fixing the cause.
Session deletion uses the same queue; legacy grouped deletions use an atomic batch.
Routines and exercise memory use Firestore's own persistent write queue.

Open and sign in while online before entering the gym, then keep the app loaded.
Firestore caching does not guarantee cold-start access to HTML/CDN scripts offline.
A fully installable offline app shell would require a service worker; this version
keeps the requested three frontend files. Use a browser that supports IndexedDB;
private browsing/storage restrictions can prevent persistence. Do not clear site
data while sessions are pending. Active sessions are local to this device; use one
editing tab/device at a time. No live authentication or username changes offline.

## Data layout and compatibility
Shared authenticated collections:
artifacts/volume-challenge-app/public/data/sessions/{sessionId}
artifacts/volume-challenge-app/public/data/profiles/{uid}
artifacts/volume-challenge-app/public/data/workouts/{legacyId}

Private collections:
users/{uid}/routines/{routineId}
users/{uid}/exercises/{exerciseId}

Session exercises are a nested array; totals are always calculated from their
weight × reps × sets. No denormalized total can become stale after a delete.
The rules validate every exercise up to the 12-block cap, ownership and field types.
Existing workout records are grouped by user/date/session label in History and
continue contributing to applicable totals. They are not copied, so no duplicate
migration totals. Original logs have no duration: show 'unavailable' and exclude
from the strict timed streak. New code cannot write the old workout format, so
update all devices to the new frontend after publishing these rules.

Every signed-in account can read shared profiles/sessions/legacy logs, including
session notes, for the global leaderboard. Each account can only write its own
records; routines and exercise memory are private. These rules do not restrict
registration to two people. This is a trust-based challenge: client-reported lifts
and dates are not independently verified. No automated payment is made.

## Verification
Run: node tests/test-logic.cjs
See VALIDATION.md for coverage and limitations. Test the rules in Firebase Console
before relying on them: own writes allowed, other-user mutations denied, username
changes within seven days denied, profile deletion denied, invalid exercise denied.
Try offline mode after signing in: finish a session, verify pending status, restore
connectivity and confirm it syncs once. Test a second account in a separate browser.
