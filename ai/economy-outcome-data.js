const assert = require('assert');
const crypto = require('crypto');
const { runRuntimeScenario } = require('./benchmark-gamestart-all-slots');

function outcomeLayoutHash(map) {
  // GameMap's startup inputs. Generator seed/name/count metadata does not make
  // another physical scenario. Preserve array order: entity order affects play.
  const fields = ['mapSize', 'players', 'goldmines', 'lakes', 'mountains',
    'bushes', 'hills', 'suddenDeathRound'];
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    assert(typeof value !== 'function', 'layout must serialize runtime entity types explicitly');
    return value;
  }
  const input = Object.fromEntries(fields.map(field => [field, map[field]]));
  return crypto.createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
}

function assertDisjointOutcomeLayouts(layouts) {
  const seen = new Map();
  for (const layout of layouts) {
    const hash = outcomeLayoutHash(layout.map);
    assert(!seen.has(hash), 'physical layout overlap: ' + JSON.stringify({
      previous: seen.get(hash), current: {split:layout.split, seed:layout.seed}, hash
    }));
    seen.set(hash, {split:layout.split, seed:layout.seed});
  }
  return Object.fromEntries(seen);
}

// End-of-turn states actually visited by the behavior policy, never speculative
// candidates. Labels are undiscounted terminal wins from the candidate's view.
// A return describes this trajectory; it is not an optimal-action/Q label.
function labelOutcomeTrajectory(game, positions) {
  let previousTurn = 0;
  for (const position of positions) {
    assert.equal(position.playerIndex, game.candidateSlot, 'position perspective mismatch');
    assert(position.turnCount > previousTurn && position.turnCount <= game.turnCount,
      'positions must be ordered and belong to the reported game');
    previousTurn = position.turnCount;
  }
  const eligible = game.exactClassAssignment === true && !game.crash &&
    !game.timeout && !game.suddenDeath && Number.isInteger(game.winner) &&
    game.players.some(player => player.side === game.winner && !player.lost);
  if (!eligible) {
    return { disposition: 'excluded-nonterminal-or-invalid', examples: [], labels: [] };
  }
  assert.equal(game.candidateWon, game.winner === game.candidateSlot,
    'reported winner and candidate result disagree');
  assert.equal(game.players.filter(player => !player.lost).length, 1,
    'terminal outcome must have exactly one surviving player');
  const label = game.candidateWon ? 1 : 0;
  return {
    disposition: 'terminal-outcome',
    examples: positions.map(position => ({
      playerIndex: position.playerIndex,
      turn: position.turnCount,
      round: position.gameRound,
      board: position.vector[0],
      global: position.vector[1]
    })),
    labels: positions.map(() => label)
  };
}

function collectOutcomeTrajectory(mapEntry, candidateSlot, seed, options, checkpoint) {
  const positions = [];
  let game;
  try {
    game = runRuntimeScenario(mapEntry, candidateSlot, seed, options, checkpoint, {
      position: position => positions.push(position)
    });
  } catch (error) {
    // Preserve partial observations for diagnosis, but never invent a return.
    return { seed, candidateSlot, positions, game: null,
      error: { message: error.message, stack: error.stack },
      disposition: 'excluded-crash', examples: [], labels: [] };
  }
  return { seed, candidateSlot, game, positions,
    ...labelOutcomeTrajectory(game, positions) };
}

module.exports = { collectOutcomeTrajectory, labelOutcomeTrajectory,
  outcomeLayoutHash, assertDisjointOutcomeLayouts };
