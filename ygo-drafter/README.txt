YGO Drafter - live Yu-Gi-Oh! drafts (Duelist Kingdom, GOAT, Edison)

Upload (first time and every update; same-name files get replaced)
1. Open your website's repo on GitHub and click Add file > Upload files.
2. Drag this whole "ygo-drafter" folder onto the page, then click Commit changes.
3. Wait a minute, then open https://amunexanimation.com/ygo-drafter/

Card pools (data/<pool>/pool.js) - every card released in each era; banned cards included; only deck rule is max 3 copies (players handle it)
- dk:     Duelist Kingdom. Every TCG card released before Spell Ruler (348 cards, 7 products, 2 pre-built decks).
- goat:   Every TCG card released up to The Lost Millennium (1,700 cards, 66 products, 10 pre-built decks).
- edison: Every TCG card released up to Duelist Pack: Kaiba (3,706 cards, 226 products, 27 pre-built decks).
Card images: img/<card id>.webp (loaded one by one as needed).
Deck draft: one pre-built deck per seat (starter/structure decks of the era, exact card counts from Yugipedia), shuffled into stacks of 20.

Notes
- If GitHub warns that a file contains a secret, allow it. It's the Firebase web key,
  which is meant to be public. Access is controlled by the database rules.
- If you republish your site from Mobirise, keep the ygo-drafter folder in the repo.
- Firebase project: goat-draft-796f7 (Realtime Database + anonymous sign-in).
- Card data and images: YGOPRODeck (re-hosted here, as their API rules ask). Deck lists: Yugipedia.
