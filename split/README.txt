Split - trip costs shared between friends
https://amunexanimation.com/split/

Put it live (first time and every update; same as YGO Drafter)
1. Open your website's repo on GitHub (amunex.github.io) and click Add file > Upload files.
2. Drag this whole "split" folder onto the page, then click Commit changes.
3. Wait a minute, then open https://amunexanimation.com/split/
Nothing on the portfolio links to it, and nothing outside this folder is touched.

What it does
- Start a trip, then send the invite link, the 8-character code or the QR square. Friends open it and
  pick their name. The code box on the start page also takes a pasted invite link or message, and
  still finds the trip when a look-alike character was typed (S for 5, U for V, O for Q).
- Accounts: the name someone joins under becomes theirs. Nobody else can pick it, and they get their
  own link (shown right after joining, later under More > Your own link). That link is their login:
  opened on any phone, or pasted into the code box, it asks "Are you Ana?" and signs that phone in.
  There is no password. The invite sheet can also send an invite made for one person ("Or invite by
  name"), which opens with that name already picked.
  - Lost the link and the phone? Any friend in the trip opens More > that person > "can't get in?"
    and makes a new link to send them. The old link stops working, the person's other phones are
    signed out, and the log says who made it.
  - Anyone can make themselves a new link (More > Your own link) if the old one got around.
  - Picked the wrong name? More > the right name > "I'm ..." moves the phone over and frees the old
    name. The log notes the switch.
  - Trips from before accounts carry over by themselves: the first time a phone that had joined
    opens the trip again, its name gets a key and that phone holds it.
- Everyone adds what they paid, in any currency. The app keeps each person's balance and lists the
  payments that settle everything. "Mark paid" records a payment.
- An expense's own page: its name in big letters (tap it to rename), what it was about, the amount
  and receipt, then everyone's part with what each person has already paid towards it and what is
  left. "I've paid my part" (or "Mark as paid" beside anyone's name) records money already handed to
  whoever paid the bill, with how (cash, PayPal, bank transfer, or your own words) and an optional
  photo. It comes off that person's balance. Anyone can change or remove such a payment; a change
  shows on the log as one line with the old and new values.
- Groups: for things only some people share (alcohol, say). Make a group once, then pick it with one
  tap when adding an expense; only the people in it split that expense. Any expense can also be split
  between hand-picked people, by shares, or by exact amounts.
- "Why this number?": every balance is explained step by step in plain words: what the person paid,
  their part of each expense, money already handed over, and the sum. "Why these payments?" does the
  same for the settle-up list.
- Photos as proof: a receipt photo can be added while entering an expense or later from the expense
  itself, and a payment can carry a photo or screenshot. More > Receipt photos shows them all and
  lists the expenses that still have none. Photos are shrunk to about 300 KB or less first.
- Finalize trip (end of the Balances tab, or under More): shows the final bill, with how much of
  what was owed has been paid back, the payments still to make, and where everyone stands. It can be
  copied or shared as text. A finalized trip takes no new expenses until someone reopens it (asked
  for whenever an expense would be added or changed); paying up still works. Finalizing and
  reopening are on the log.
- Colours: six ready-made, or any two of your own (background and buttons; the writing turns black
  or white by itself). A choice is for everyone in the trip, or "Only on my phone".
- Log tab: every change, with who made it and when. Edits show what it said before; deleted expenses
  stay, crossed out, and can be brought back. It also points out: amounts that were changed (on
  expenses and on payments), changes made more than a day later, hand-typed exchange rates far from
  the market rate, a receipt photo that was taken off, a phone or account that switched to acting as
  someone else, a phone that tried to come in under a taken name without that person's link (and
  anything it wrote), a login link made for someone by somebody else, anyone who joined without
  signing in on a trip that asks for it, and expenses added or changed while the trip was finalized.
- Works with no signal after the first visit. New entries wait on the phone and are sent later.
- "Add to Home Screen" on a phone makes it open like an app.
- Try it without touching real data: add ?demo to the address for a sample trip that stays on that
  phone. ?demo=google also previews the sign-in screens with a made-up account.

Sign in with Google (optional extra on top of accounts, off until you switch it on)
Switch it on once: Firebase console > project goat-draft-796f7 > Authentication > Sign-in method >
Add new provider > Google > Enable, choose a support e-mail, Save. Nothing to upload again: phones
pick it up the next time the page is opened (give it about 15 minutes). The drafters are not affected.
What changes once it is on:
- Joining a trip starts with "Continue with Google" (one tap, no password or code to remember). The
  phone stays signed in. Whoever starts a trip while signed in can tick "Friends must sign in with
  Google to join"; it can be changed later under More.
- Each person shows the Google name behind them and a masked address (ma***@gmail.com), with a tick
  beside their name. The full address is never stored in the trip.
- Signing in with the same account on a new phone goes straight back in as the same person, without
  needing the own link.
- If Google's window can't open on someone's phone (some in-app browsers block it), they can still
  join, and the log marks that join in red.
- Until it is switched on, joining works by picking a name, and the own link is the login.
How far to trust it: the app checks who is signed in, and the log shows it. A person's key is never
stored in the trip, only a fingerprint of it (a hash), so reading the trip's data doesn't give
anyone a login. A technical person could still write straight to the database under someone's name;
the app can't stop that, but every phone marks such entries on the log ("From a phone that isn't
signed in as ..."). With the stricter rules below, the database itself also checks the Google name
on every join.

Where the data is
- The same Firebase project as YGO Drafter and MyL Drafter (goat-draft-796f7, Realtime Database),
  stored under rooms/split-<CODE>. Nothing to set up.
- Anyone who has a trip's code can read that trip. To add to it they join under a name of their own.
  The list of trips can't be read.
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
"?v=4" (index.html, sw.js, app.js, store.js, rates.js) and replace it with "?v=5", and rename
'split-v4' in sw.js to 'split-v5'. Phones then pick up the new files together, straight away.
A phone that still has an older page open keeps working with the same numbers: new kinds of
information are written in a way older versions simply skip (an edited payment, for instance, is
stored as a removal plus a new payment, which every version understands).
