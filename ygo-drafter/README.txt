YGO Drafter - live Yu-Gi-Oh! drafts (Duelist Kingdom, GOAT, Edison)

Upload (first time and every update; same-name files get replaced)
1. Open your website's repo on GitHub and click Add file > Upload files.
2. Drag this whole "ygo-drafter" folder onto the page, then click Commit changes.
3. Wait a minute, then open https://amunexanimation.com/ygo-drafter/

Card pools (data/<pool>/pool.js) - each format only has the cards first released in its own era; banned cards included; max 3 copies is handled by players
- dk:     First released before Spell Ruler (Mar-Sep 2002). 348 cards: LOB, MRD, other releases.
- goat:   First released after Duelist Kingdom up to The Lost Millennium (Sep 2002-Jul 2005). 1,352 cards in 14 booster sets + other releases, plus 15 earlier-era staples.
- edison: First released after GOAT up to Duelist Pack: Kaiba (Aug 2005-Apr 2010). 2,006 cards in 35 booster sets + other releases, plus 33 earlier-era staples.
Viewer groups cards by booster set; cards only in starter/structure decks, tins, tournament packs or promos are under "Other releases".
Deck draft: one deck per seat from Competitive (Format Library top-4 event decks: 24 GOAT, 34 Edison), Structure (the era's starter/structure decks), or Both; shuffled into stacks of 20.
Earlier-era staples: older cards in 10%+ of the format's decklists or 20%+ of its tournament decks.
Card images: img/<card id>.webp. Original pack art: packs/<set code>.webp (Yugipedia; a few from YGOPRODeck).

Notes
- If GitHub warns that a file contains a secret, allow it. It's the Firebase web key,
  which is meant to be public. Access is controlled by the database rules.
- If you republish your site from Mobirise, keep the ygo-drafter folder in the repo.
- Firebase project: goat-draft-796f7 (Realtime Database + anonymous sign-in).
- Card data and images: YGOPRODeck (re-hosted here, as their API rules ask). Structure deck lists: Yugipedia. Tournament decks: Format Library.

Tournament (online rooms with 3+ players)
- Lobby setting "Tournament after the draft": Off, Round robin, Swiss or Single elimination; matches best of 1 or 3.
- When players mark their deck ready, the deck is registered for the tournament (rooms/<code>/decks/<draft>/<uid>).
- The host starts it from the ready panel; anyone not ready is left out. Players report each game (I won / I lost, with undo);
  the host can also report for others and moves to the next round. Standings: 3 points per match win, ties broken by
  opponents' win rate, then game difference. "Download results and decks" saves a text file.
- Duel test (beta): duel/ runs EDOPro's rules engine with GOAT rules, hot-seat, with undo (see duel/README.txt).
