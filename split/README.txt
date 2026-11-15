Split - trip costs shared between friends
https://amunexanimation.com/split/

Put it live (first time and every update; same as YGO Drafter)
1. Open your website's repo on GitHub (amunex.github.io) and click Add file > Upload files.
2. Drag this whole "split" folder onto the page, then click Commit changes.
3. Wait a minute, then open https://amunexanimation.com/split/
Nothing on the portfolio links to it, and nothing outside this folder is touched.

What it does
- Start a trip, then send the invite link, the 8-character code or the QR square. Friends open it and
  pick their name.
- Everyone adds what they paid, in any currency. The app keeps each person's balance and lists the
  payments that settle everything. "Mark paid" records a payment.
- Groups: for things only some people share (alcohol, say). Make a group once, then pick it with one
  tap when adding an expense; only the people in it split that expense. Any expense can also be split
  between hand-picked people, by shares, or by exact amounts.
- "Why this number?": every balance is explained step by step in plain words: what the person paid,
  their part of each expense, money already handed over, and the sum. "Why these payments?" does the
  same for the settle-up list.
- Photos as proof: a receipt photo can be added while entering an expense or later from the expense
  itself, and a payment can carry a photo or screenshot. More > Receipt photos shows them all and
  lists the expenses that still have none. Photos are shrunk to about 300 KB or less first.
- Log tab: every change, with who made it and when. Edits show what it said before; deleted expenses
  stay, crossed out, and can be brought back. It also points out: amounts that were changed, changes
  made more than a day later, hand-typed exchange rates far from the market rate, a receipt photo
  that was taken off, a phone or account that switched to acting as someone else, and anyone who
  joined without signing in on a trip that asks for it.
- Works with no signal after the first visit. New entries wait on the phone and are sent later.
- "Add to Home Screen" on a phone makes it open like an app.
- Try it without touching real data: add ?demo to the address for a sample trip that stays on that
  phone. ?demo=google also previews the sign-in screens with a made-up account.

Sign in with Google (optional, off until you switch it on)
Switch it on once: Firebase console > project goat-draft-796f7 > Authentication > Sign-in method >
Add new provider > Google > Enable, choose a support e-mail, Save. Nothing to upload again: phones
pick it up the next time the page is opened (give it about 15 minutes). The drafters are not affected.
What changes once it is on:
- Joining a trip starts with "Continue with Google" (one tap, no password or code to remember). The
  phone stays signed in. Whoever starts a trip while signed in can tick "Friends must sign in with
  Google to join"; it can be changed later under More.
- Each person shows the Google name behind them and a masked address (ma***@gmail.com), with a tick
  beside their name. The full address is never stored in the trip.
- A name that is signed in can't be taken over from another phone. Signing in with the same account
  on a new phone goes straight back in as the same person.
- If Google's window can't open on someone's phone (some in-app browsers block it), they can still
  join, and the log marks that join in red.
- Until it is switched on, joining works by picking a name, as before.
How far to trust it: the app checks who is signed in, and the log shows it. A technical person could
still write straight to the database under a made-up name unless the stricter rules below are used;
with them, the database itself checks the Google name on every join.

Where the data is
- The same Firebase project as YGO Drafter and MyL Drafter (goat-draft-796f7, Realtime Database),
  stored under rooms/split-<CODE>. Nothing to set up.
- Anyone who has a trip's code can read that trip and add to it. The list of trips can't be read.
- Each expense keeps the exchange rate it was added with, so balances don't move when rates do.
  Rates: fawazahmed0 currency-api (free, daily), with open.er-api.com as a backup.
- If GitHub warns that a file contains a secret, allow it. It's the Firebase web key in store.js,
  which is meant to be public. Access is controlled by the database rules.

Optional: let the database itself refuse edits, deletes and made-up names
As the rules are today, a technical person who knows a trip's code could change that trip's entries
directly in the database (the draft rooms work the same way). The app guards against this from its
side: it only ever adds entries, every phone keeps its own copy, an entry that goes missing is put
back, and one that was changed is reported at the top of the Log.
To close the gap completely, open Firebase console > Realtime Database > Rules. If the rules there
only contain the rooms/$room block the drafters use, replace them with the block below. Draft rooms
keep working exactly as before; trip entries, photos and trip records can then only be added, never
changed or removed, each entry is stamped by the database with the time and the account that wrote
it, and a Google name on a join is only accepted from the account it belongs to. (Tested against a
local copy of the database, with the app and with the drafters' kind of rooms.) If the rules have
other things in them, ask Claude to merge these in instead.

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
            ".validate": "newData.hasChildren(['t', 'd', 'ts', 'uid']) && newData.child('uid').val() === auth.uid && newData.child('ts').val() === now && newData.child('t').isString() && newData.child('t').val().length <= 40 && newData.child('d').isString() && newData.child('d').val().length <= 6000 && (!newData.hasChild('gn') || (auth.token.firebase.sign_in_provider === 'google.com' && newData.child('gn').val() === auth.token.name))"
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
- core.js                 the money logic: splits, rounding, balances, groups, the log
- store.js                saving and syncing (Firebase, plus the copy kept on each phone), signing in
- rates.js                exchange rates
- sw.js                   lets the app open offline; it only covers /split/
- lib/qr.js               QR code generator by Kazuhiko Arase (MIT licence)
- fonts/                  Recursive (SIL Open Font Licence), cut down to the two styles used
- icon files, share.png, manifest.webmanifest   icons, link preview picture, home-screen settings

Updating
After changing any file, raise the version number everywhere it appears: search this folder for
"?v=2" (index.html, sw.js, app.js, store.js, rates.js) and replace it with "?v=3", and rename
'split-v2' in sw.js to 'split-v3'. Phones then pick up the new files together, straight away.
