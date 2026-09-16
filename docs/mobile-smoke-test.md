# UniClass mobile smoke test

Run against `http://localhost:5173` using a narrow mobile viewport (390 × 844) after each release.

## Student flows

- Sign in as a student with two approved classes; switch the class selector and confirm Dashboard, Missions, Scores, Badges, and Leaderboard update to the selected class.
- Open Missions, complete a generated mission, tap Submit once, and confirm a visible grading/loading state followed by a score or an actionable error.
- Open Scores, choose an activity, upload a proof image for every member, and confirm the compressed upload message appears.
- Try submitting scores with one proof missing; confirm submission is blocked and the missing member is identified.
- Open Scan QR; confirm the camera library loads only after tapping Start Camera Scan, and confirm manual hash entry remains available if camera permission is denied.

## Teacher flows

- Open Activity Logs and use Load older activity; confirm older rows append without duplicates.
- Open Activity Proof and use Load older proof; confirm thumbnails, student names, activity labels, and full-image links render.
- Open Data Export; confirm the page loads without PDF libraries, then download the PDF and confirm the button returns to its idle state.

## Acceptance criteria

- No horizontal scrolling at 390 px.
- Every action has a visible loading, success, or error state.
- Browser console contains no uncaught errors.
- Network requests remain scoped to the active classroom and paginated screens do not request the full history.
