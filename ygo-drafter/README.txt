YGO Drafter - live Yu-Gi-Oh! booster drafts (Duelist Kingdom, GOAT, Edison, Master Duel N/R)

Upload (first time and every update; same-name files get replaced)
1. Open your website's repo on GitHub and click Add file > Upload files.
2. Drag this whole "ygo-drafter" folder onto the page, then click Commit changes.
3. Wait a minute, then open https://amunexanimation.com/ygo-drafter/

Card pools (data/<pool>/) - banned cards are included everywhere; the only deck rule is max 3 copies, handled by the players
- dk:     Duelist Kingdom. Every card from Legend of Blue Eyes, Metal Raiders, Starter Deck: Yugi and Starter Deck: Kaiba (318 cards).
- goat:   Cards up to The Lost Millennium played in 3+ of 300 GOAT decklists, plus the GOAT-banned cards (548 cards).
- edison: Cards up to Duelist Pack: Kaiba played in 4+ of 400 Edison decklists, plus the Edison-banned cards (531 cards).
- mdnr:   Master Duel N and R rarity only, played in 3+ of 500 MD decklists, plus banned N/R cards (578 cards).

Notes
- If GitHub warns that a file contains a secret, allow it. It's the Firebase web key,
  which is meant to be public. Access is controlled by the database rules.
- If you republish your site from Mobirise, keep the ygo-drafter folder in the repo.
- Firebase project: goat-draft-796f7 (Realtime Database + anonymous sign-in).
- Card data and images: YGOPRODeck (re-hosted here, as their API rules ask).
