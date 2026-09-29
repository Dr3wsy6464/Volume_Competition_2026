# Volume Competition 2026 — set logging edition

Replace index.html, style.css and app.js together in your GitHub Pages repository.
Publish the entire included firestore.rules in Firebase Console → Firestore Database
→ Rules. The preceding edition's rules reject nested sets, bodyweight and preferences.
The Firebase project configuration is retained. There is no build step.

## Logging
- Start Session, optionally enter bodyweight, then add exercises or load a routine.
- Each row is one set. Complete turns green; only completed sets count as volume.
  A completed exercise collapses to its name and volume. Reopen to review or undo.
  Add Set copies the last row's load/reps and creates an incomplete row.
- Superset Mode creates a named group. New exercises join the selected group.
  Use each exercise's Group selector to move existing exercises in or out.
  Rename a group inside its expanded boundary. At least two member exercises are
  required; the group collapses only when all their sets are complete.
- Finish requires all included sets to be complete; remove unused rows first.
- Maximum 30 exercises and 30 sets per exercise in new sessions.
- Bodyweight is remembered for the next session (and synced as a private preference).
  It is never added to competition volume. External load only remains the rule.
- Routines store groups, exercises and set targets; loading resets completion flags.
- History, deletion and CSV export are now in Profile.

## Statistics definitions
Day = today; Week = current Monday–Sunday; Month = current calendar month;
All-Time = all logged dates through today; Comp = November 1, 2026 inclusive to
January 1, 2027 exclusive (so December 31 is the final competition training date).
All dates use Australia/Brisbane.

Exercise Stats aggregate repeated exercise blocks in a session as one session:
- Total Volume = sum of completed external weight × reps.
- Average Volume/Session = that volume / number of sessions containing the exercise.
- Reps = sum of completed repetitions, not number of sets.
- Strength Ratio = best completed set weight / bodyweight recorded in that session.
- Relative PR Velocity = percentage increase in best-ever Strength Ratio over the
  last 30 or 90 days. Reference endpoint is the selected period's exclusive end,
  capped at tomorrow. Baseline uses records before endpoint minus 30/90 days;
  current PR uses all records before endpoint. No bodyweight/baseline gives N/A.
  For example, a prior best ratio of 1.00× and current 1.20× gives +20%.
- Session Density = session volume / full session duration in minutes, including
  rest. Aggregated density is total volume / total minutes for timed sessions only.
  Untimed legacy sessions are excluded from density, not from total volume.

The Compete filter applies to leaderboard totals, session counts, average session
volume, density, track lanes and graph. Athlete favorites are independent of
selection. The global filtered leaderboard includes everyone; checked athletes
appear in the track/graph. A unique global leader gets the crown. No selections
shows an empty graph with a prompt instead of silently choosing someone.

Ghost trajectories use each selected athlete's recorded volume seven days earlier,
shifted forward; they are not forecasts. Competition ghosts exclude data outside
competition dates. Chart legends are below the graphs. Track bars normalize against
the selected leader; they do not represent a fixed competition finish target.
Payout is shown only for the competition filter: winning volume / 1000 in AUD.

Weekly boss, training streak, heatmap and lifetime/RPG statistics remain available.
Weekly boss rotates Deadlift/Squat/Bench Press, using all training in the current
Brisbane Monday–Sunday week. Streak requires gaps strictly under 48 hours and counts
unique training dates. The elephant equivalent remains illustrative at 6,000 kg.

## Data, offline and compatibility
New documents keep the sessions collection and add schemaVersion: 3, bodyweight,
and exercises[].sets[] with weight, reps and complete fields. Superset ID/name are
stored on each exercise. Older session records expand their sets count into rows;
legacy flat workouts remain readable and are grouped by date/session label. Neither
format is copied into another collection, so totals are not duplicated. Historic
sessions without bodyweight show N/A ratios; no current bodyweight is backfilled.

Private user settings are at users/{uid}/settings/competition. Exercise memory and
routines retain their existing private paths. Shared profiles/sessions can be read
by signed-in users; only owners can mutate data. The seven-day username cooldown
uses server timestamps and prevents profile deletion as a bypass. Rules enforce
ownership and top-level shape; nested numerical validation is performed in the app.
This remains a trust-based challenge, not an audited prize system.

Firestore IndexedDB persistence and the per-account local session outbox remain.
Offline finishes keep a stable document ID and stay pending until server confirmation.
Open and sign in online before the gym; this three-file app has no service worker
for guaranteed offline cold starts. Do not clear browser data while writes are
pending. Use one editing tab/device at a time for the active session.

## Verification
Run node tests/test-logic.cjs for the included mocked regression tests.
No Firebase production accounts/data/rules or GitHub deployment were changed here.
Live Firebase rule compilation, actual IndexedDB and visual browser QA still need
checking. Test own writes, forbidden other-user edits, and the username cooldown
in Firebase Rules Playground before using the new rules for the competition.
