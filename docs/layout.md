# Map layout and fog

## Static nature is fogged like any other cell (TASK-1161)

Lakes, seas and mountains (`StaticNature`, `sprites/entities/buildings/nature/nature.js`) no longer count as
visible on their own. `Grid.clearFogOfWarArr` starts every cell at 0, `RevealScout.currentVisibility`
(`options/reveal.js`) starts every cell at 0 when it has no fog mask of its own, and `computeFogFor`
(`options/filteredView.js`) reuses `Player.changeFogOfWarByVision`. A static-nature cell is visible
(fog count > 0) only while a unit or suburb sees it, the same as a plain cell. This applies to vision,
autoscouting, the AI and the hidden-information filtered view.

The art still shows on fogged cells. `Grid.drawFogLandmark` (TASK-1160) draws the lake, sea or mountain
body image above the fog shade on every fogged cell, but never the map-edge `InvisibleMountain` ring.

## How nature positions reach the client

- Offline (local, hot-seat, tutorials): the client holds the whole board. `grid.arr[x][y].building` is the
  nature entity, so the fogged art is drawn straight from it.
- Online with hidden information (`HIDDEN_INFO`, on by default): `filteredView` sends no nature. On an
  unknown cell it sends no grid colour (`null`), units, towns or other contents. The nature layout is public
  map layout and arrives separately:
  - `game:terrain {gameID, terrainId, nature, goldmines, mapShape}` comes once per `game:open`
    (server `terrainOnce.js`). Its `nature` list is `[{name, coord: {x, y}}]` for every nature entity,
    i.e. position and type only (`Nature.toJSON`).
  - Each emitted board carries `terrainId` and `terrainChanges` (sudden-death seas, destroyed bushes).
    The client rebuilds the nature list with `boardWithTerrain` / `boardFromFilteredView`.
  Every static-nature cell, fogged or not, therefore has its entity on the client, and `drawFogLandmark`
  can draw it. The hidden cell's colour stays unknown, and the hexagon is drawn as fog.
- Online without hidden information (`HIDDEN_INFO=0`): full boards include `nature`, as offline.

No message shape changed. Before TASK-1161 every static-nature cell counted as known, so the filtered
view also sent its grid colour. That colour is now sent only while the cell is seen.
