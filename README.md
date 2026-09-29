# Volume Competition 2026 — reference and analytics edition

Replace index.html, style.css and app.js together in your GitHub Pages repository.
Publish the entire included firestore.rules in Firebase Console → Firestore Database
→ Rules. The new reference collections and session fields require these rules.
No build step is required. Firebase configuration is already included.

## References and editing
Session references use #YYMMDD-N with a global counter for each Brisbane date.
Firestore transactions reserve the next number and an idempotent claim per session
and date. Numbers are allocated in server reservation order, not guaranteed physical
workout chronology. Discarded sessions may leave gaps; numbers are never reused.
Offline sessions remain usable but show 'pending sync' until an online transaction
can allocate a unique reference. Existing own sessions receive references online.

History is a collapsible drawer inside Profile. Each session expands to set details
and has Edit/Delete controls. Delete uses a modal confirmation. Editing reuses Train
with start/end timestamps in Brisbane time and editable name, bodyweight, sets, reps,
loads, groups, notes and routine association. Completed-set inputs unlock by tapping
its green checkmark; complete the row again before saving. Saving updates the existing
session ID, so no duplicate totals. Changing the session date allocates a reference
for the new date. Editing flat legacy logs converts that group to one modern session
and deletes the original flat records in the same batch. Unknown legacy duration
must be entered before saving. Do not edit one session simultaneously on two devices.

## Logging and supersets
Every Add Exercise/quick-select starts with group None. Superset Mode permits group
creation and assignment through each exercise's Group selector. Deleting a group or
turning Superset Mode off preserves all exercises/sets and returns their group to
None. Exercise headers show Set Volume PR (best single set's external load × reps)
and total volume across matching blocks in the most recent other session.
Checkmark toggles completion; the adjacent red X deletes that particular set.
New sessions support 30 exercises × 30 sets. External loads only; bodyweight never
adds to volume. Templates preserve group/target data and reset completion on load.

## Unified timeframes
Both Compete and Stats offer Day, Week, Month, All Time, Custom range, then Comp.
An anchor date and previous/next arrows browse periods. Fixed weeks are Monday–Sunday;
rolling weeks start on the anchor weekday. Fixed months are calendar months; rolling
months run anchor date to the day before that date in the next month, clamped for
shorter months. Month navigation uses the original anchor so January 31 → February 28
→ March 31. Custom endpoints are inclusive; arrows shift by that range's length.
Comp is Nov 1, 2026 inclusive through Dec 31, with Jan 1, 2027 exclusive.
All calendar calculations use Brisbane dates. All Time and Comp arrows are disabled.

## Compete and Stats
Checked athletes alone appear in the leaderboard, race track, graph and weekly boss
comparison. Favorites only affect drawer ordering. The chart uses daily metric values
for Volume, Density, Average Volume/Session or Duration; units appear on the axis.
One circle/name legend entry controls both that athlete's solid line and faded dashed
line. Dashed values come from seven days earlier. Tooltips show the daily value and
its difference vs seven days earlier. Competition ghosts exclude noncompetition dates.
Duration is daily total minutes; density is total timed-session volume / total minutes.
Unknown duration is excluded. No selected athletes gives an explicit empty state.

Stats category controls are mutually exclusive; clicking the active one deselects it
and shows overall training. Search narrows the entity list. Clicking an entity isolates
its history; clicking it again clears that selection. Routine statistics use persisted
routineId links. Older unlinked sessions can be associated through Edit session.
Metric chips show the selected period's totals/current values and switch the chart:
- Total Volume: sum of completed weight × reps.
- Completed Reps: sum of completed reps.
- Body Weight: latest known session bodyweight; graph shows last known value per day.
- Strength Ratio: maximum completed set volume / that session's bodyweight.
- Set Volume PR: highest single-set volume within the selected scope/timeframe.
Missing bodyweight/duration is N/A and a graph gap, not a fabricated zero.
Profile rank includes all athletes and competition dates; ties share the same rank.
The elephant equivalent and Relative PR Velocity metrics have been removed.

## Offline, permissions and verification
Persistent Firestore cache and a per-account local outbox preserve offline work.
Open and sign in online first; no service worker is included for offline cold starts.
Keep browser data until all writes are acknowledged. Errors remain visible and Retry
is available in Profile → Session history. Transient writes retry when online.
Rules restrict session/profile/routine/preference mutations to owners and retain the
server-enforced seven-day username cooldown. Shared session/profile data is readable
by signed-in users; routines/preferences are private. Counters are shared coordination
documents. This remains a trust-based challenge: rules do not prove a lift occurred.

See VALIDATION.md. The supplied tests use mocked Firebase and a minimal DOM.
No production data, Firebase rules or GitHub deployment was changed by this task.
Test rules in Firebase Rules Playground and perform a two-account live smoke test.
