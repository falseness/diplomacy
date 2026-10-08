'use strict';
// The packed board the host sends for the shipped competitive map (as ops/prod_smoke_lobby.js competitiveBoard).
function competitiveBoard(clientContext) {
    return clientContext()(`() => {
      const variant = maps['open field'].find(v => v.players.length === 3);
      isFogOfWar = false;
      variant.start({updateCameraBorders() {}, clearValues() {
        external=[]; externalProduction=[]; nature=[]; goldmines=[]; gameRound=0; gameExit=false;
      }}, false);
      const b = JSON.parse(JSON.stringify(getGameObject()));
      b.whooseTurn=0; b.gameRound=0; b.gameSettings.isOnline=true;
      return b;
    }`);
}

module.exports = {competitiveBoard};
