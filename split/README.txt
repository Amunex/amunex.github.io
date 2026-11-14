Split - trip costs shared between friends
https://amunexanimation.com/split/

Put it live (first time and every update; same as YGO Drafter)
1. Open your website's repo on GitHub (amunex.github.io) and click Add file > Upload files.
2. Drag this whole "split" folder onto the page, then click Commit changes.
3. Wait a minute, then open https://amunexanimation.com/split/
Nothing on the portfolio links to it, and nothing outside this folder is touched.

What it does
- Start a trip, then send the invite link, the 8-character code or the QR square. Friends open it and
  pick their name. No accounts.
- Everyone adds what they paid, in any currency. The app keeps each person's balance and lists the
  fewest payments that settle everything. "Mark paid" records a payment.
- Receipt photos can be attached to an expense. They are shrunk to about 300 KB or less first.
- Log tab: every change, with who made it and when. Edits show what it said before; deleted expenses
  stay, crossed out, and can be brought back. It also points out: amounts that were changed, changes
  made more than a day later, hand-typed exchange rates far from the market rate, and a phone that
  switched to acting as someone else.
- Works with no signal after the first visit. New entries wait on the phone and are sent later.
- "Add to Home Screen" on a phone makes it open like an app.
- Try it without touching real data: add ?demo to the address for a sample trip that stays on that phone.

Where the data is
- The same Firebase project as YGO Drafter and MyL Drafter (goat-draft-796f7, Realtime Database +
  anonymous sign-in), stored under rooms/split-<CODE>. Nothing to set up.
- Anyone who has a trip's code can read that trip and add to it. The list of trips can't be read.
- Each expense keeps the exchange rate it was added with, so balances don't move when rates do.
  Rates: fawazahmed0 currency-api (free, daily), with open.er-api.com as a backup.
- If GitHub warns that a file contains a secret, allow it. It's the Firebase web key in store.js,
  which is meant to be public. Access is controlled by the database rules.

Optional: let the database itself refuse edits and deletes
As the rules are today, a technical person who knows a trip's code could change that trip's entries
directly in the database (the draft rooms work the same way). The app guards against this from its
side: it only ever adds entries, every phone keeps its own copy, an entry that goes missing is put
back, and one that was changed is reported at the top of the Log.
To close the gap completely, open Firebase console > Realtime Database > Rules. If the rules there
only contain the rooms/$room block the drafters use, replace them with the block below. Draft rooms
keep working exactly as before; trip entries, photos and trip records can then only be added, never
changed or removed, and each entry is stamped by the database with the time and the phone that
wrote it. (Tested against a local copy of the database, with the app and with the drafters' kind of
rooms.) If the rules have other things in them, ask Claude to merge these in instead.

{
  "rules": {
    "rooms": {
      "$room": {
        ".read": "auth != null",
        ".write": "auth != null && !$room.beginsWith('split-')",
        "meta": {
          ".write": "auth != null && $room.beginsWith('split-') && !data.exists() && newData.exists()",
          ".validate": "newData.child('kind').val() === 'split' && newData.child('uid').val() === auth.uid && newData.child('ts').val() === now && newData.child('name').isString() && newData.child('name').val().length <= 60"
        },
        "events": {
          "$id": {
            ".write": "auth != null && $room.beginsWith('split-') && !data.exists() && newData.exists()",
            ".validate": "newData.hasChildren(['t', 'd', 'ts', 'uid']) && newData.child('uid').val() === auth.uid && newData.child('ts').val() === now && newData.child('t').isString() && newData.child('t').val().length <= 40 && newData.child('d').isString() && newData.child('d').val().length <= 6000"
          }
        },
        "receipts": {
          "$id": {
            ".write": "auth != null && $room.beginsWith('split-') && !data.exists() && newData.exists()",
            ".validate": "newData.child('uid').val() === auth.uid && newData.child('ts').val() === now && newData.child('img').isString() && newData.child('img').val().length <= 450000"
          }
        }
      }
    }
  }
}

Files (plain HTML and JavaScript, no build step)
- index.html, style.css   the page and how it looks
- app.js                  the screens
- core.js                 the money logic: splits, rounding, balances, the log
- store.js                saving and syncing (Firebase, plus the copy kept on each phone)
- rates.js                exchange rates
- sw.js                   lets the app open offline; it only covers /split/
- lib/qr.js               QR code generator by Kazuhiko Arase (MIT licence)
- fonts/                  Recursive (SIL Open Font Licence), cut down to the two styles used
- icon files, share.png, manifest.webmanifest   icons, link preview picture, home-screen settings

Updating
After changing app.js or style.css, raise the ?v= number in index.html and in sw.js (and the name
'split-v1' in sw.js) so phones pick up the new files straight away.
