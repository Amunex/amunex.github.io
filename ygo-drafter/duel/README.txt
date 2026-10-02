YGO Drafter: Duel test (beta)

A GOAT-format duel table that runs EDOPro's rules engine in the browser.
You play both sides on one screen. Undo replays the duel up to your previous decision.

Credits and licenses
- Rules engine: EDOPro core by Project Ignis (github.com/edo9300/ygopro-core), AGPL-3.0.
- WebAssembly build of the core: ocgcore-wasm by n1xx1 (github.com/n1xx1/ocgcore-wasm).
- Card scripts, GOAT card versions and banlist: Project Ignis CardScripts, BabelCDB and LFLists, AGPL-3.0 (see scripts/COPYING).
- The source of this page is everything in this folder; it is public in this repository.

Files
- engine/        the WebAssembly core and its JavaScript wrapper
- scripts/       card scripts (only the cards in EDOPro's 2005.4 GOAT list) plus the core rule scripts
- goat-db.json   card data for those cards (incl. GOAT and pre-errata versions) and tokens
- strings.json   EDOPro's interface strings (effect descriptions)
- sample-decks.json  tournament and structure decks offered on the setup screen
- glue.js, duel.js, duel.css, index.html  the table itself
