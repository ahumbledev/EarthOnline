# Creating a challenge

Start with one of the six JSON examples. Each game defines an arena, a roster, entities, variables and event rules. Version 1 runs one player. Version 2 defines cooperative roles, and version 3 supports the larger fixed rosters. The validator in `shared/minigame-protocol.mjs` describes accepted fields, actions, limits and error locations.

From the root of this kit, run the following commands with Node.js 22.18 or later.

```sh
node scripts/minigame.mjs validate game.json
node scripts/minigame.mjs replay examples/cooperative.json tests/cooperative-win.json
node scripts/minigame.mjs pack . challenge.zip
```

Use the editor to import a definition, try each role, change rules and export the input trace. Replays include the expected terminal state and variables. For an image, declare a relative file under `assets/` in the definition and include it in the package. Each file must be a static PNG, JPEG or WebP. The local workshop server validates packages and stores revisions in a directory outside the checkout.
