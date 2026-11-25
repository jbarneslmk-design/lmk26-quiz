# LMK 26 — the LMK Christmas quiz

A live phone quiz for the Christmas meal. You read the questions out, everyone answers on their phone, and the big screen shows who got it right. There's also a drawing round, a live leaderboard, a podium with prizes and a gallery of everyone's drawings at the end.

- **Players** go to `https://YOUR-NAME.github.io/lmk26-quiz/`, type the **quiz password** (you announce it on the night) and their name, and they're in. There's no app or sign-up.
- **You** (the host) open `https://YOUR-NAME.github.io/lmk26-quiz/host.html` on a laptop, ideally plugged into a TV, and enter the **host PIN**.
- **Nothing is lost.** Every answer and score is saved in Neon the moment it happens. If your laptop or someone's phone refreshes, crashes or loses signal, it carries on exactly where it was.
- **Locked down.** The password and PIN are checked inside Neon, not in the web page, and the questions and answers are stored in Neon where only the host PIN can read them. They are never in this public repository.

---

## 1. The database (Neon project "LMK TESTING")

The quiz uses its own Neon project, kept separate from SHELL's data.

1. In the Neon console open **LMK TESTING → SQL Editor** (database `neondb`).
2. Open `neon/SETUP_LMK_TESTING.sql`. On its last line, replace `TYPE-QUIZ-PASSWORD` and `TYPE-HOST-PIN` with your own. Then paste the whole file into the editor and press **Run**.
3. `js/config.js` holds the connection string for the restricted `quiz_web` login. It's fine for that to be public: the login can only call the quiz functions, and each one checks the password or PIN.

To **change the password or PIN** later, run `select quiz.setup('lmk26', 'new password', 'new pin');` in the SQL Editor. Everyone signs in again automatically.

Until a connection string is in `js/config.js`, the quiz runs in **LOCAL TEST MODE**: tabs in one browser sync with each other, which is handy for rehearsing alone. In that mode the PIN is `2512`.

## 2. GitHub Pages

The site is the files in this repository: no build step and no server. Pages is set to deploy from branch `main`, folder `/ (root)`. The live site updates about a minute after each push.

## 3. Rehearse

- **On your own:** open `host.html` in one tab, then `index.html?as=1`, `index.html?as=2` and so on in other tabs. Each `?as=` tab acts as a separate player.
- **With real phones:** get a couple of colleagues to join on the live link.
- **Before the night:** in host.html, open **⋯ → Reset game**. That clears rehearsal players and scores but keeps your questions.

## 4. On the night

1. Laptop on the TV, `host.html` open, then enter the PIN. A QR code and the web address appear on screen.
2. Everyone scans the QR code and types their name. Their names pop up on screen. Tap a name to remove it if someone's being cheeky.
3. Press **Start** (or the **space bar**). From then on you only ever press one button, and it always says what happens next:
   *question → stop answers → reveal → leaderboard → next question…*
4. Each question closes automatically when the timer runs out or when everyone has answered. Use **+10s** if you're still reading it out.
5. **The drawing round:** everyone gets a secret, funny work-situation prompt and draws it on their phone (90 seconds by default). Drawings save as they go, so a phone that refreshes keeps the picture. The drawings then come back as questions spread through the rest of the quiz, alternating between *"What on earth is this?"* and *"Who drew this?"*.
   Artists earn points for each person who guesses their drawing correctly, and for each person they fool on "who drew it?". With 15–20 people, only 10 drawings become questions to keep things moving (`maxQuestions` in `questions.js`). **Every** drawing appears in the gallery at the end.
6. **Finale:** reveal 3rd, then 2nd, then the winner, each with their prize. Then the special awards (Fastest Finger, Hot Streak, Wildest Guess, Christmas Pudding for last place), then the gallery wall.
7. Press **Save results** (top right) to download the full results, a scores spreadsheet (CSV) and a gallery page with every drawing.

**Pub checklist:** ask the Black Bull for the Wi-Fi password and put it on the table cards, because phone signal in villages can be patchy. Bring a laptop charger and an HDMI cable, and check the TV input beforehand.

## 5. Writing the questions

**The easy way: the question builder.** Open `https://jbarneslmk-design.github.io/lmk26-quiz/builder.html` (or go to host page → **⋯ → ✏️ Question builder**) and log in with the host PIN.
- Pick **Edit the quiz's questions**, or open a file. Then go through it one question at a time: the type, the question, the answers (tick the right one), the real story, the seconds, and double points. A phone preview shows how each question will look.
- After that come the prizes, the fun awards and the drawing prompts.
- Numbered circles along the top show each question's status: green means ready, yellow means still a placeholder, and red means something's missing.
- Your work saves on that device as you go, so a refresh loses nothing.
- At the end, **Upload to the quiz** sends it straight into Neon. Then go to host page → **⋯ → ↻ Reload questions**. You can also **download lmk26-questions.js** as a backup.

**By hand:** edit the file as described below.


Write the quiz in `js/questions.js` **on your laptop**. It's deliberately not in this repository. On host.html, choose **⋯ → Load quiz file** to upload it into Neon, where only the host PIN can read it. Load it again after any edit.

- `choice` has up to 6 options; `answer` is the position of the right one (0 = first).
- `number` is "closest guess wins", e.g. "How many orders did we ship?". Being within 2% counts as spot on, and the closest guess gets a bullseye bonus.
- `double: true` doubles the points (good for the last question).
- `funFact` is the story you tell after the reveal. This is where the funny real-company stuff goes.
- `todo: true` marks a placeholder. The host screen shows how many are left.
- `drawPrompts` holds the secret drawing prompts. Have at least one per person.
- `prizes` lists the podium prizes in order 1st, 2nd, 3rd.

Players only ever receive each question as you show it, and the answer only when you reveal it.

## 6. Afterwards

Press **Save results**, then delete the **LMK TESTING** project in Neon (Settings → Delete project) and make this repository private or delete it.

---
Scoring: a correct multiple-choice answer earns 500 points plus up to 500 more for speed. Number questions earn up to 1,000 points depending on how close the guess is, plus 200 for the closest guess. Streaks show as ★ stars.
