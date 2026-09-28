# Volume Competition 2026

## What broke
The original inline module declares `const firebaseConfig` twice in the same scope.
That is a SyntaxError, preventing the entire module from executing and leaving
all buttons unbound. The second declaration also references undefined
`fallbackConfig`. The form already called preventDefault(); refreshing was not
the primary bug.

## Files and deployment
Use the three-file version: index.html, style.css and app.js. Upload all three to
the root of the existing GitHub repository, replacing its index.html. Commit to
the branch/folder configured for GitHub Pages. All asset URLs are relative, so
/Volume_Competition_2026/ works. No build step, npm or server is needed.
Do not open index.html via file://; serve over HTTP or use GitHub Pages.
For local preview: `python3 -m http.server 8000` from this folder.

The original Firebase project configuration and SDK 11.6.1 are retained.
Firebase web config is public client configuration; access is controlled by rules.

## Firebase console steps
1. In the volume-competition project, enable Authentication → Sign-in method →
   Email/Password. Ensure the app is pointed at the correct project.
2. Check Authentication → Settings → Authorized domains. Add your Pages hostname
   (USERNAME.github.io, no scheme or repository path) and localhost for local work
   if required by your configuration. Follow any domain error reported by Firebase.
3. Create Cloud Firestore if not already created. The app works with unexpired
   test-mode rules. If those expire, reads/writes fail with a visible permission
   error; authentication can still succeed because it is a separate service.
4. Publish firestore.rules in Firestore → Rules. GitHub Pages does NOT deploy
   Firestore rules. These rules allow signed-in accounts to read leaderboard data
   and allow only the owner to create/delete their workout records or write their
   profile. Unmatched paths are denied. Replace the existing permissive rule set;
   a remaining broad allow rule would override these restrictions.
5. For this private two-person competition, register both accounts, copy their UIDs
   from Authentication → Users, and fill in competitor() in firestore.rules.
   Replace signedIn() with competitor() in the profile and workout match blocks
   (do NOT replace the signedIn() call inside competitor itself). Publish again.
   This prevents a third registrant from reading or joining the competition.
   The initial signed-in-only rules deliberately support registration before UIDs
   are known, but allow ANY authenticated account into the leaderboard.

Rules are independent of profile existence. The app never writes undefined
metadata and never mutates Firebase User.displayName directly. Profile-write
failure does not invalidate account creation or block dashboard entry. Errors
remain visible in a role=alert banner. SDK/module download failure also displays
an error rather than leaving a silent screen.

## Data compatibility
Existing workouts remain at:
artifacts/volume-challenge-app/public/data/workouts/{autoId}
Profiles use:
artifacts/volume-challenge-app/public/data/profiles/{authUid}
No composite index needed. Email is kept in Auth, not the shared profile collection.
Legacy workouts without session/createdAt are readable. Invalid, zero-load, or
malformed legacy rows are omitted from statistics/history; their stored records
are not deleted. Valid records without names fall back to Athlete. Volumes are
recalculated from weight, reps and sets, not trusted from the stored total.
Listeners are unsubscribed and view data cleared on sign-out/account switch.

## Competition assumptions
- Start inclusive: 2026-11-01. End exclusive: 2027-01-01, Brisbane calendar dates.
  To include January 1, change END in app.js to 2027-01-02 and update UI text.
- Entries outside the competition may be logged for practice; only in-period
  entries contribute to stats, ranking, payout and charts. Future entries rejected
  in the UI. Current date uses Australia/Brisbane, not UTC.
- Only external loads count. Zero-load bodyweight entries are rejected. For a
  weighted pull-up, enter the attached weight only. The app cannot verify that a
  person has entered the correct physical load; agree equipment conventions.
- One entry means identical load and reps across those sets. Log varied sets
  separately. A session is a date plus case-insensitive session label. Blank
  labels on a date are grouped into one session; use Morning/Evening for two.
- Winner receives their own total kg / 1000 in AUD, not the combined total or
  margin of victory. A tie is displayed; no tie-break rule was supplied.
- Same display names remain separate athletes because aggregation uses Auth UID.
- Profile and workout notes can be read by all accounts allowed by the rules.
- The app keeps exercise/load/reps/sets/date/session after saving for fast logging.
  Wait for the save confirmation to avoid duplicate submissions.
- No offline durability claim: pending writes require keeping the page open.
  Browser session persistence is attempted if local auth persistence fails.
- Rules enforce ownership, types and volume arithmetic. They do not prove a lift
  happened, enforce an immutable end-of-competition lock, or validate calendar
  dates beyond shape. This is a trust-based challenge, not audited prize software.

## Validation and limits
See VALIDATION.md. No live accounts were created, no real workout data was changed,
and no Firebase console settings, rules or GitHub deployment were changed here.
Use the console Rules Playground/emulator before publishing restrictive rules:
- anonymous read/create: denied
- authenticated own profile/create workout: allowed with matching fields
- another user's workout deletion/profile write: denied
- invalid volume or zero load: denied
- permitted account can read the full collection
- non-competitor denied after enabling the UID allowlist

Live smoke check: register → dashboard → log a practice entry → confirm it in
Firestore/history → reload → verify session and entry persist → log out → sign in.
Repeat in a second browser with the other account to verify real-time comparison.
Test charts with November/December fixtures in a separate test project or after
competition starts; don't insert fabricated entries into the actual competition.

Firebase references:
https://firebase.google.com/docs/auth/web/password-auth
https://firebase.google.com/docs/auth/web/auth-state-persistence
https://firebase.google.com/docs/firestore/security/rules-conditions
https://firebase.google.com/docs/firestore/query-data/listen
