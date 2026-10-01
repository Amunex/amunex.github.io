MyL Drafter - mesa de juego (sandbox table + deck builder + draft by era) for Mitos y Leyendas
==============================================================================

PUT IT LIVE (same as YGO Drafter)
1. Open your GitHub repo amunex.github.io
2. Add file -> Upload files -> drag the whole "myl-drafter" folder in -> Commit changes
3. After a minute it's live at:  https://amunexanimation.com/myl-drafter/

WHAT'S INSIDE
- index.html, css/, js/   the app (plain HTML/JS, no build step)
- data/cards.json         snapshot of the official card database (api.myl.cl), Oct 1 2026:
                          141 editions, 20,434 cards. Ask Claude to refresh it when new sets come out.

HOW IT WORKS
- Online tables use the same Firebase project as YGO Drafter (goat-draft-796f7), stored under
  rooms/myl-XXXXX. Nothing to set up. GitHub may warn about the Firebase key in js/net.js: that key
  is public by design for web apps, it's fine.
- Card images load straight from the official MyL server. Small versions go through wsrv.nl (a free
  image cache) so the table stays fast; the first time anyone sees a card it can take a few seconds,
  then it's instant. If the cache ever fails, the app falls back to the original image.
- Decks are saved in each person's browser. Share them with "Exportar" (code or link).
- Hidden information (hands, castle order) is honor system, like any free sandbox: a technical
  player could read it from the database. Fine for friends.

DRAFT (same rules as YGO Drafter, by era)
- Pick one era or several at once: Primera Era, Primer Bloque, Segundo Bloque, Bloque Furia,
  Furia Extendido, Imperio. Only real booster sets go in (no promos, racial decks or toolkits).
- Packs open with the real wrapper art for 47 booster sets (img/packs, 96 designs, cut out of
  photos from the MyL fan wiki and blog.myl.cl). Sets without a usable photo get a drawn wrapper
  with the set logo. Classic Espada Sagrada / Helénica / Cruzadas / Imperio use the 20th-anniversary
  reprint wrappers (same layout).
- Booster draft: 11-card packs (6 vasallos, 3 cortesanos, 1 real that can upgrade, 1 oro) or Arena
  odds, real sets or everything mixed, 1-10 packs, open 1 or 2 at once, take 1 or 2 per pick.
- Deck draft: one random racial deck per seat built from the chosen eras, shuffled into stacks of 20.
- Deck building: free pool of generic golds (no ability) from the drafted eras, cost curve, a
  suggested gold count, "Equilibrar mazo" (best 50 with the right golds), download the list as .txt.

TOURNAMENT (live drafts)
- Formats: todos contra todos, suizo (no rematches), eliminación directa; al mejor de 1 or de 3.
- Players mark "Terminé mi mazo" (that registers the deck), the host starts the tournament.
- "Jugar en una mesa" opens a table with both players and decks already seated. Players report
  games won; conceding in a match table records the game for the rival automatically.
- Standings, champion screen, every decklist, and "Descargar resultados y mazos" (.txt).

CARD DATA CHECK (Oct 1 2026)
- Images: all 20,434 checked against the official server. Editions 1-9 (Furia to Bushido) live in
  two-digit folders there, which the app now handles. Only 9 cards have no image on the official
  server itself (Troya 230-236, Invasión Oscura 339, Escuelas Elementales 050).
- Text: every card shows something. 19,739 have their ability text, 467 only flavour text (shown in
  italics), 224 plain golds show "Oro sin habilidad", 3 tokens say they have no text.
  The official database was missing 1,042 texts: 699 were filled from the same card in the same
  era, 115 were read from the card images by hand, the rest are plain golds and vanilla cards.
- Names: about 140 names broken in the official database were corrected (Ángel, Árbol, Águila,
  Gigantes de Fuego, Konaki Jiji, Eratóstenes, Ganímedes...).

SHARE LINKS
- Table or draft:  https://amunexanimation.com/myl-drafter/?t=CODE  (the Unirse box takes both)
- Deck:   use Exportar -> Copiar enlace in "Mis mazos"
