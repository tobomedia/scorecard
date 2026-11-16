# Scorecard — MVP Product Definition

**Status:** Agreed for v1 · **Date:** 2026-11-13

## 1. Summary

Scorecard is a mobile web app for keeping score while watching a match. One person, one phone, quick taps. It ships with presets for Rugby Union and Football (soccer). Users can also build their own scoring system for any sport.

## 2. Problem

When you watch a match you lose track of the score breakdown, who scored when and how long the match has been going. Pen and paper or a notes app is slow and easy to get wrong.

## 3. Target user

- A single spectator who tracks a match on their own phone.
- Often outdoors, at a ground with poor signal, and glancing between the pitch and the screen.

## 4. Goals

- Record a score in **one tap** (plus one more tap for a follow-up such as a conversion).
- Never lose a match in progress (browser closed, phone battery dies).
- Mistakes are easy to fix, during the match or afterwards.
- Works offline once installed.

## 5. Non-goals (v1)

- Sharing or syncing between devices, accounts, live viewers
- Period-aware clock (halves, countdown, added time)
- Team colours
- Exporting or sharing results
- Player names, cards, substitutions
- Tracking missed attempts other than conversions

## 6. Features

### 6.1 Sports & scoring setup (Settings)

- **Presets:**
  - **Rugby Union** (2 × 40): Try 5 (follow-up: Conversion 2), Penalty 3, Drop goal 3, Penalty try 7
  - **Rugby League** (2 × 40): Try 4 (follow-up: Conversion 2), Penalty goal 2, Drop goal 1
  - **Rugby Sevens** (2 × 7): Try 5 (follow-up: Conversion 2), Penalty 3, Drop goal 3, Penalty try 7
  - **Football** (2 × 45): Goal 1
  - **Goal 1** sports: Netball 4 × 15, Hockey 4 × 15, Ice hockey 3 × 20, Handball 2 × 30, Futsal 2 × 20, Water polo 4 × 8, Lacrosse 4 × 15
  - **Golf**: stroke play (see 6.7f)
- Presets added in an update are added once to existing installs. Ones the user deleted aren't re-added.
- Presets can be edited (rename, change points, add or remove score types).
- **Custom sport builder:** name the sport, then add score types. Each score type has:
  - Name
  - Points value
  - Optional **follow-up** score type (for example Try → Conversion)
- A follow-up score type can be hidden from the main buttons if it only ever comes from a prompt (Rugby: conversion appears only after a try).

### 6.2 Follow-up prompt

- After a score type that has a follow-up, show a prompt: **"Conversion: Made / Missed"**.
- **Made** → adds a follow-up event that scores its points.
- **Missed** → adds a missed follow-up event (0 points) so success rate can be shown.
- The prompt must not block the clock. Dismissing it counts as missed.

### 6.3 Teams

- Default to **Home** and **Away**.
- You can type a custom name for each team when setting up a match.
- Typed names are saved to a **team list** and offered as choices in future matches.
- The team list can be managed: delete names.

### 6.4 Match clock

- Simple count-up clock (mm:ss) with **Start / Pause**.
- **Kick-off prompt:** after "Start match", an overlay with a large **Start clock** button and a "Not yet" option.
- While the clock isn't running, a large **Start clock** or **Resume clock** bar shows on the live screen. Once the clock runs it becomes a **Pause** button.
- **Pause** and **End match** both ask for confirmation in-app.
- Every event is stamped with the match minute (for example 23').
- **Periods:** each sport has a default number of periods and length (Rugby Union 2 × 40, Football 2 × 45). Both can be changed per match on the New match screen.
- The clock runs per period. Each period starts at its own offset, so the 2nd half always starts at 40:00.
- **Time up:** when a period's time is reached:
  - the clock turns red and flashes, showing added time (40:00 +2:10)
  - a HALF TIME / FULL TIME banner appears and the screen flashes
  - Android phones vibrate, and a beep plays (can be turned off in Settings)
  - a "Time up" entry is added to the log
- A big **Half time** / **Full time** button stops the clock and logs the whistle with its added-time minute (e.g. 40+3'). Full time ends the match.
- If a period runs **10 minutes over** with no whistle, the cue repeats.
- Scores in added time are stamped 40+n'.
- The clock keeps running correctly when the app is in the background or the screen is locked. Elapsed time is calculated from timestamps, not from ticks.

### 6.5 Live match screen (portrait)

```
┌─────────────────────────────┐
│  Home   12  –  7   Away     │
│          23:41  [⏸]         │
├──────────────┬──────────────┤
│  [ Try ]     │  [ Try ]     │
│  [ Penalty ] │  [ Penalty ] │
│  [ Drop goal]│  [ Drop goal]│
├──────────────┴──────────────┤
│  [Undo]   [Log]   [End]     │
└─────────────────────────────┘
```

- Header: team names, total scores and the clock, always visible.
- Two columns of large buttons, one column per team, one button per score type.
- **Undo** removes the last event.
- Live screen shows **totals only** (no breakdown).
- **Screen stays awake** during a live match (Wake Lock API). The lock is released when the match ends.

### 6.6 Event log & corrections

- A list of all events: minute, team, score type, made/missed.
- **Delete** any event.
- **Edit** any event: team, score type, minute.
- **Add** a missed event with a minute set in the past.
- Scores are always **worked out from the log**, never stored separately.

### 6.7 Match lifecycle

- **New match:** pick a sport, set team names → live screen.
- **Auto-save:** the live match is saved on every change. If you reopen the app, it resumes the match in progress.
- **End match:** confirm → match saved to history → back to the home screen.
- Only one live match at a time.

### 6.7a Edit match

- **Edit match** on the match detail screen, and **Edit** on the live screen, change:
  - team names
  - number of periods and minutes per period
  - date and kick-off time
- Changing the minutes re-times events in later periods. With 2 × 40 → 2 × 35, a 2nd-half score at 46' becomes 41', and "Time up" entries move to the new period end.
- The sport can't be changed after the match starts, because score types wouldn't line up.

### 6.7b Share result

- **Share result** on a finished match opens the phone's share sheet with "Home 7–3 Away" and a link. Where there's no share sheet, the link is copied instead.
- The whole match is packed into the link after `#` (compressed), so no server is involved.
- Opening the link shows a read-only result (score, breakdown, timeline) with **Save to my history**. Saving twice is prevented.

### 6.7c Live score sharing

- **Go live** on the match screen creates a match ID and a secret key, then shares a viewer link (`#/watch/<id>`). A red **LIVE** badge then shows; tap it to share again or stop. It turns grey while the phone has no signal.
- Every change sends the full match state to a Cloudflare Worker (`live/`). Without signal, the latest state is retried when the phone reconnects. While live, the phone also sends a state update every 60 s, so viewers can tell it's still online.
- **Viewers see:**
  - the score and a ticking clock with the period
  - the timeline (newest first) and the breakdown
  - a "TRY!" flash for new scores
  - "up to date", or "scorer's phone offline – last update N min ago" after 2.5 min with no update
- **At full time** viewers see the final result and **Save to my history**. If the scorer stops sharing, viewers are told.
- Only the phone that went live can update the match. Viewers are read-only. No accounts.
- The server deletes matches 30 days after their last update. It runs on Cloudflare's free plan.
- Later: hand scoring over to another phone (a scorer link).

### 6.7d Backup, restore and opening links in the app

- iPhone keeps a home-screen app's data separate from Safari, deletes it when the icon is removed, and always opens links in Safari. So data has to come in from inside the app.
- **Settings → Back up** saves one `.json` file (matches, sports, teams) via the share sheet, or downloads it where there's no share sheet.
- **Settings → Restore** picks a backup file and shows what it will add first. It adds matches, sports and teams that aren't already there and never deletes anything, so restoring twice adds nothing.
- **Open a shared link** (on History and Settings): paste a result or live link, or a whole message containing one, or tap **Paste from clipboard**. It opens inside the app, so **Save to my history** saves to the home-screen app.

### 6.7e Help, FAQ and welcome

- **Help & FAQ** on the Home screen has 8 guides and 11 FAQs as tap-to-expand sections, and works offline.
- The same screen is a shareable link (`…/#/help`) that works in any browser. **Share this guide** sends it.
- The content lives in one place (`HELP` in `app.js`).
- When not installed, Help shows an install tip for iPhone or Android.
- **Welcome:** 3 cards on first launch (install / scoring a match / where Help is). It appears on the Home screen only, never over a shared or live link. It's skippable, never shown again, and can be replayed from Help.

### 6.7f Golf

- **Golf** is a sport of its own kind: stroke play against par, with any number of players and no clock.
- **Courses** (Settings → Golf courses): name, 9 or 18 holes, and par 3–6 per hole. Built-in **Quick round** courses (18 or 9 holes, par 4 each) cover courses that aren't set up.
- **New match → Golf:** choose a course, then add players. Names are saved with the team names.
- **Hole screen:**
  - hole number, par and a hole picker
  - the leader so far
  - one row per player with − / + buttons and their score against par ("+3 thru 7")
  - a fixed bottom bar with ‹ Prev / Card / Next hole ›, which becomes **Finish** on the last hole
  - untouched scores show par in grey and are saved when moving on
- **Card:** a grid of every hole for every player, with Out/In for 18 holes and a total with ± against par. It marks eagle, birdie, bogey and double bogey or worse. Tapping a score edits it, during or after the round.
- **Finish** saves to History with a leaderboard (ties shown as T2) and the card. Share result, Go live (a live leaderboard with the current hole) and backup/restore (including courses) all work for golf.

### 6.7g Cricket

- **Cricket** is a limited-overs mode, scoring the team ball by ball with no clock.
- **New match → Cricket:** team names, overs per side (default 20), wickets (default 10) and who bats first.
- **Ball pad:** · (dot) 1 2 3 4 6, Wicket, Wide, No-ball, Bye.
  - **Wide:** 1 run plus any extra runs (it asks), not a legal ball.
  - **No-ball:** 1 run plus runs off the bat (it asks), not a legal ball.
  - **Bye/leg-bye:** asks how many runs, and is a legal ball.
  - **Wicket:** a legal ball with no runs.
  - **Undo** removes the last ball.
- **Board:**
  - the batting team and score (e.g. 87/3), overs (12.4 of 20) and run rate
  - in the chase: the target, "need X off Y balls" and the required rate
  - the "this over" chips and the last few overs
- **Automatic:**
  - a toast at the end of each over
  - innings over when the overs run out or the side is all out, with a prompt and then **Start 2nd innings**
  - the match ends when the target is reached or the 2nd innings is over, with the result worked out ("won by N wickets / N runs / Match tied")
- **End** finishes early, e.g. for rain.
- History shows over by over for both innings. Share result and backup work as for other sports. Go live gives viewers FOUR! / SIX! / WICKET! flashes.

### 6.8 History

- A list of finished matches: date, sport, teams, final score.
- **Match detail** shows:
  - Final score
  - Breakdown per team (for example "2 tries, 1/2 conversions, 1 penalty")
  - Full timeline of events
- Delete a match from history.

## 7. Screens

1. **Home:** New match, Resume (if live), History, Settings
2. **New match setup:** sport, Home/Away names (with saved-team suggestions)
3. **Live match**
4. **Event log** (from live match or match detail)
5. **History list**
6. **Match detail**
7. **Settings:** sports & scoring builder, saved teams

## 8. Data model (sketch)

```
Sport      { id, name, scoreTypes: ScoreType[] }
ScoreType  { id, name, points, followUpId?, hiddenFromButtons? }
Team       { name }                       // saved team list
Match      { id, sportSnapshot: Sport, home, away,
             startedAt, endedAt?, clock: { elapsedMs, runningSince? },
             events: Event[] }
Event      { id, team: 'home'|'away', scoreTypeId, minute,
             made: boolean, createdAt }
```

- `sportSnapshot` is copied when a match starts, so later changes to settings don't rewrite past results.
- Everything is stored in `localStorage` on the device.

## 9. Technical

- Plain **HTML/CSS/JS**, no build step and no framework.
- **PWA:** web app manifest plus a service worker. Can be installed to the home screen and works fully offline.
- **Hosting:** GitHub Pages from `tobomedia/scorecard`.
- **Targets:** current iOS Safari and Android Chrome, portrait, one-handed use.
- Tap targets at least 48px, with high contrast that can be read outdoors.

## 10. Acceptance criteria

- [ ] Start a Rugby Union match, tap Try for Home → prompt appears → Made → Home shows 7.
- [ ] Missed conversion → Home shows 5, and detail shows "0/1 conversions".
- [ ] Football match: Goal adds 1.
- [ ] Create a custom sport with 2 score types and a follow-up, then play a match with it.
- [ ] Editing a preset doesn't change past matches.
- [ ] Undo removes the last event and the score updates.
- [ ] Edit an event's team → both totals update.
- [ ] Add a backdated event at 15' → it appears in the right order in the timeline.
- [ ] Close the tab mid-match, reopen → match and clock resume correctly.
- [ ] Clock is correct after the screen has been locked for 5 minutes.
- [ ] Screen does not dim during a live match.
- [ ] A typed team name appears as a suggestion in the next match.
- [ ] End match → appears in history with breakdown.
- [ ] Installed to home screen, airplane mode → app loads and works.

## 11. Later (post-MVP ideas)

- Period-aware clock (2×40, 2×45, quarters, added time)
- Share or export the result (text for WhatsApp)
- Team colours
- Live sharing to other viewers
- Player names, cards, more stats
- Move to a framework if it grows
