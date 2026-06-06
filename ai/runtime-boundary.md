# AI Runtime Boundary

AI bot implementations, model/vectorization code, map generation, training
orchestration, smoke tests, and benchmark support belong under `ai/`.
Cloud-provider deployment files belong outside the repository under
`~/ai/deploy`.

The browser keeps a few small integration hooks outside `ai/`:

- `index.html` loads the AI scripts in dependency order.
- `options/gamestart.js` maps game setup values to `AIPlayer` or
  `SimpleAiPlayer`.
- `menu/menu.js` exposes the existing UI action that starts AI play/training.
- `events/events.js` reports completed human commands through `AiRuntime`.
- `nextTurn.js` tells `AiRuntime` when human-command training may run.
- `options/gameObjectVariables.js` owns shared game settings used by AI mode.

These hooks should not contain model, vectorization, bot decision, training,
benchmark, or deployment implementations.
