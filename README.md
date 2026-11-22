# VOLUNATION — Firebase Spark (free plan)

Replace `index.html`, `style.css` and `app.js` together in the existing GitHub Pages repository. No build step and no Cloud Functions are required. Your uploaded Firebase project configuration is retained. **Publish the complete `firestore.rules` before using the new app.** Do not leave an old test-mode allow-all rule alongside it.

## First setup

1. Back up your current source and Firestore data.
2. In Firebase Authentication, enable Email/Password and ensure your GitHub Pages domain is authorised. Configure the verification email template if desired.
3. Publish the supplied Firestore rules. They explicitly name `werd6464@gmail.com` as the administrator and require the email_verified token claim. A client-side email check alone does not grant access.
4. Upload the three frontend files to your GitHub Pages repository. Reload the site. Existing offline changes should be synced with the old app before changing rules, or retained on the same device and retried after verification/approval.
5. Sign in with `werd6464@gmail.com`, verify its email, and click **I have verified / Refresh**. The app creates the approval setting and original competition if absent.
6. Other athletes verify their email and appear under Profile → Admin settings → Approvals. Approve or reject them. Previously registered athletes also need verification and approval; existing workouts are preserved.
7. Select **The 62-day EOY Push** under Admin settings and mark eligible athletes. Athletes then see their own Join competition button in Compete. Eligibility is separate for each competition, and being eligible does not automatically opt someone in.
8. Select joined competitions from Compete. That selection is shared with the competition option in the Stats timeframe control. No joined competitions gives an explicit empty state.

The original competition includes **1 November 2026 through 1 January 2027**, Brisbane time. Its exclusive query boundary is 2 January. This is 62 days. New competitions use inclusive start/end date inputs and have no cash prize. Dates, name and eligibility can be changed by the admin until the existing end instant. Ended competitions and memberships are locked. Late opt-ins include earlier workouts within that competition's dates.

## Free-plan operation and permanent results

There is no server scheduler in this version. When the verified admin opens the app, after shared collections are confirmed synced, it:

- Saves a random current-week boss drawn from already logged, normalised exercise names. Previously logged names before that week are preferred. On first setup, the available log history is used. The choice is saved once and never changes on refresh. Without logs there is no boss yet.
- Finalises completed Monday–Sunday weeks. On first setup this also backfills earlier weeks from the available history, including retrospective boss choices. These are not claimed to have been announced before this installation.
- Saves milestone awards with the first qualifying date in the retained training history.
- Saves ended competition and completed calendar-month recap records.

The admin can retry using **Finalise completed awards and recaps**. Writes have stable IDs and completion markers. Ordinary athletes cannot mint badges, choose bosses, edit final results, or promote themselves. Until the admin visits, the app shows provisional results or a pending-finalisation state. Keep the page online until completion. The current day/week/month is never awarded as if finished.

Completed recaps are snapshots. Later edits, deletions, or late offline uploads change live training analytics but do not rewrite permanent awards or final recap totals. Sync all participants' outstanding sessions before the admin's first visit after a period ends. Finalised records are not recalculated when a participant deletes their account; that participant's own result documents are removed. Shared archive markers and competition definitions remain. This is a small, trust-based challenge, not a proof-of-lift system. Nested workout rows are validated by the client; rules enforce ownership, access and top-level bounds, but cannot establish that a physical lift occurred.

## Money, units and ties

All session loads and bodyweight, goals, thresholds, result volumes and ranking calculations stay in **kg**. Only display/input and CSV output use the selected kg/lb preference. Conversion is 1 kg = 2.2046226218487757 lb. Inputs in lb are converted once on entry. Display rounding never rewrites saved kg values. The CSV names weight columns with the chosen unit; ratios, reps and durations do not convert.

For the original EOY competition only, the prize pool is the leading total kg / 1000 AUD. With one winner, every other participant owes that pool / (participants − 1). Comparison checkboxes never change the participant count, payout or actual competition rank. In a tie, the pool is shared equally among tied winners and funded equally by the remaining participants. If all participants tie, there are fewer than two participants, or the leading total is zero, no money is owed. Projected balances can change while membership is open. Cash results are saved in final recaps. No payments are collected by the app.

## Training and analytics

The original offline outbox, legacy flat-workout reading, references, routines, exercise memory, editable sessions, supersets, rest timer, stats, history and CSV export are preserved. New exercises start in group None. Removing a group or switching off Superset Mode keeps its exercises. The Previous column matches completed set positions from the last other session with the same normalised exercise name. Names ignore case and repeated spaces; spelling variations remain different exercises.

Session density is total volume of sessions with known positive durations / their combined minutes. Unknown legacy duration is N/A. Strength ratio is completed single-set volume / bodyweight from that session. Highest session is the sum of every completed set in the session, not the largest set. The original session-reference transaction still needs a connection to allocate its final #YYMMDD-N number. Offline drafts show a pending reference.

Main comparison checkboxes control the leaderboard, race track and athlete ghost series. Drawer search/filter/sort narrows the list of controls, not existing selections. Competition mode additionally limits comparison to opted-in athletes. The profile competition rank uses every entrant, independent of comparison checkboxes.

The separate weekly control drives weekly awards and competition duels. Duels use each Monday–Sunday week's intersection with the competition. A tie or zero-volume week adds no win. An unfinished week declares no winner. The running tally is based on current logged training within the competition. Weekly awards are global across all athletes, not limited by competition membership or comparison checkboxes. Most Improved means the greatest positive absolute kg increase over the previous week. Most Consistent means distinct training dates. Early Bird counts sessions starting before `EARLY_BIRD_HOUR` (default 8:00, Brisbane); legacy sessions without start times do not qualify. All positive ties earn the award.

A streak counts actual training days. One missed calendar day per Monday–Sunday week is automatically bridged and consumes that week's freeze. It does not add a fictional training day or volume. A second missed day in that week breaks the streak. Today is not treated as missed until the day ends. Across a Sunday/Monday boundary two rest days can be bridged using two different weeks' freezes. Levels use the supplied 15 kg thresholds; all ranges and remaining quantities display in the chosen unit.

Personal best ghosts use the highest-volume **completed** calendar week/month and align its daily values with the start of the displayed graph. Select yourself for the personal ghost to appear. Days beyond the source period are blank. Previous-week athlete ghosts remain dashed and share one legend entry with that athlete. Records show the top 20 streak holders plus the current athlete. Monthly recaps are selected in the history drawer.

## Editable settings

- Admin email: `ADMIN_EMAIL` in app.js and the verified email comparison in firestore.rules must match. The shipped value is werd6464@gmail.com.
- Approval switch: **Profile → Admin settings → Require account approval** writes the single server-backed `config/app.requireApproval` setting. Both app and rules read it. `DEFAULT_REQUIRE_APPROVAL` only seeds the initial value. Email verification is always required, and rejected/deleting accounts stay blocked even if approval is switched off.
- Early Bird hour: `EARLY_BIRD_HOUR` near the levels constant.
- Levels: `LEVELS`, in kg.
- Preset milestones: `MILESTONES`. Initial badges cover first session, 25/100 sessions, 100,000/1,000,000 kg lifetime, 7/30 training-day streaks and a 10,000 kg session. Change thresholds or add entries with stable unique IDs. Existing permanent awards are retained.
- Personal goals: weekly volume, sessions per week and competition volume. Their bars are separate from preset milestones. Weekly goals reset their progress each Monday.

## New Firestore data

Existing shared path prefix: `artifacts/volume-challenge-app/public/data`.

| Collection/document | Content and permissions |
| --- | --- |
| `access/{uid}` | Private verified email, userId, approval status, createdAt. User reads own; admin lists and approves/rejects. Pending users can only create their own pending access document and read the approval config. |
| `config/app` | `requireApproval` boolean, written only by verified admin. |
| Shared `competitions/{id}` | Name, inclusive start/end, endAt milliseconds, cash flag, timestamps. Admin writes; only original eoy-2026 can have cash enabled. |
| Shared `entries/{competitionId}_{uid}` | userId, competitionId, eligible, optedIn, updatedAt. Admin eligibility; eligible owners toggle optedIn while open. |
| Shared `bosses/{YYYY-MM-DD}` | Monday week, chosen exercise and createdAt. Admin creates once. |
| Shared `awards/{stableId}` | userId, award type/name, date/week, optional milestoneId/value, createdAt. Admin creates; no athlete self-awards. |
| Shared `results/{periodId}_{uid}` | Per-user kg recap, rank, session count, streak, highest-session reference, most-lifted exercise, badges, balanceKgCash, dates. Admin finalises; owners can remove their own records only during account deletion. |
| Shared `archives/{periodId}` | Finalisation marker with kind, dates and completedAt. No participant names or lists. |
| `users/{uid}/goals/{id}` | Private target in kg or session count, type and competitionId. |
| Existing shared `profiles/{uid}` | Adds optional bio, up to 500 characters. Existing displayName and seven-day nameChangedAt cooldown retained. |
| Existing `users/{uid}/settings/competition` | Adds unit = kg or lb. Existing bodyweight remains kg, selected and favorites remain UID lists. |

Existing sessions, workouts, sessionReferences and sessionCounters remain at their original paths. There is no destructive bulk migration. Editing a legacy grouped session still replaces its original flat rows atomically with a modern session. Existing routines remain compatible.

**Indexes:** No new composite indexes are required. Collection listeners use no compound filters. Deletion queries use the default single-field `userId` index. If you previously disabled that field's indexing, restore it for sessions, workouts, sessionReferences, entries, awards and results.

## Account deletion

The athlete must verify email, type DELETE and re-enter the current password. This performs recent reauthentication, writes a deleting marker that blocks normal writes across tabs, removes own sessions/legacy logs/reference claims/profile/routines/exercise memory/preferences/goals/entries/badges/recaps, removes their access document, and finally deletes the Firebase Authentication account. The users/{uid} parent is also deleted if present. Shared competition definitions, anonymous day counters, boss definitions and archive markers are retained. Other athletes' private favourite lists may retain an inert UID; without a profile/log record it no longer appears in the athlete list. No names or email addresses are stored there.

This is a resumable browser operation, not a server job. Stay online and keep the page open. If it fails, press Delete account again and retry. An interrupted account is restricted to cleaning up its own records. The app does not say deletion succeeded until the Auth deletion succeeds. No data is merely deactivated in a successful deletion. Previously deleted portions cannot be restored by cancelling. Other devices' offline browser caches cannot be remotely erased; close all tabs and clear site data on those devices as appropriate. The current browser attempts to clear its Firestore cache after success and asks for a refresh.

## Offline, limits and verification

Load/sign in online before going offline. Auth verification, admin changes, opt-in/out, finalisation and deletion require a connection. Workouts continue through the existing durable local outbox; no service worker/cold-start offline guarantee is added. Do not clear browser storage before pending sessions sync.

This small-community implementation reads shared history into memory for analytics. It uses the free plan's normal quotas and does not guarantee unlimited athletes/history. No billing plan changes or Cloud Functions are used.

Validated: JavaScript syntax; DOM/behaviour tests with mocked Firebase; Firestore emulator tests for verification, approval, admin permissions, ownership, eligibility, badge writes, username cooldown, preferences, the approval switch, rejection and resumable cleanup. Browser visual testing could not run because this environment blocked Chromium's startup socket. No live Firebase records, security rules or GitHub deployment were changed. Perform a two-account live smoke test after publishing, including email verification and offline/reconnect logging.
