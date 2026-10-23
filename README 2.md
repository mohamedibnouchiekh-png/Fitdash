# FitDash — personal health & fitness dashboard

Runs entirely on your Mac. Nothing is sent to any server. Your data lives in one file: `data/fitdash.db`.

## Run it

1. Install Node 22.18 or newer (`brew install node`, check with `node -v`).
2. In this folder: `npm install`, then `npm run build`, then `npm start`.
3. Open http://127.0.0.1:3000

Until you import something, the dashboard shows clearly labelled sample data.

## Import your Apple Health data

1. iPhone: Health → profile picture → Export All Health Data.
2. AirDrop `export.zip` to your Mac.
3. In FitDash: Settings → Import from Apple Health → choose the file.
   For very large exports: `npm run import -- ~/Downloads/export.zip`

Re-importing a newer export is safe: records are matched on source and ID/time, so nothing is double-counted.

## Import your workout spreadsheet

Strength page → Import your workout spreadsheet → choose your .xlsx.

- The sheet needs an "Exercise" column and "Week1, Week2 …" columns, one row per set, "Day N" labels, and a "PHASE 1 (3×5)" style heading above each group of exercises.
- The sheet has no dates, so you give the date Week 1 started and the weekday of each Day. FitDash proposes them from the sheet's weekly schedule.
- Reps come from the plan heading, not from the sheet. Check the preview before importing.
- Importing the same sheet again replaces those sessions, so you can keep one spreadsheet and re-import it.
- "Remove spreadsheet entries" undoes an import without touching entries you typed by hand.

## What is and isn't included

- In: runs (GPS splits, heart rate), strength workouts, calories and macros that MyFitnessPal wrote to Apple Health, steps, energy, resting HR, HRV, VO₂ max, respiratory rate, sleep.
- Weight and the strength exercise log are typed in by hand (Recovery and Strength pages).
- MyFitnessPal only writes food logged after you switch on its Apple Health sync. No history before that.
- Strava is not used.

## Commands

- `npm test` — importer and calculation tests
- `npm run typecheck`
- Back up: stop the app and copy `data/fitdash.db`.
