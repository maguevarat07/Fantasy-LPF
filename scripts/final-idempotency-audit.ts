import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { openDatabase } from '../server/db.js';
import { calculatePlayerPrices } from '../server/pricingEngine.js';

const filename = process.argv[2];
if (!filename || basename(filename) !== 'economy-audit.sqlite') {
  throw new Error('Esta auditoría solo puede ejecutarse sobre economy-audit.sqlite.');
}

const tournamentId = 'apertura-2026';
const gameweekId = 'apertura-2026-gw-7';
const db = openDatabase({ filename });
const snapshot = () => createHash('sha256').update(JSON.stringify(db.prepare(`
  SELECT player_id, price_cents FROM tournament_players
  WHERE tournament_id = ? ORDER BY player_id
`).all(tournamentId))).digest('hex');

db.transaction(() => {
  db.prepare('DELETE FROM player_price_history').run();
  db.prepare('DELETE FROM pricing_runs').run();
  db.prepare(`UPDATE tournament_players SET previous_price_cents = NULL,
    fair_price_cents = NULL, last_change_cents = NULL,
    last_calculated_gameweek_id = NULL, pricing_status = 'LEGACY',
    pricing_version = NULL, price_updated_at = NULL
    WHERE tournament_id = ?`).run(tournamentId);
})();

const before = snapshot();
const first = calculatePlayerPrices(db, tournamentId, gameweekId);
const afterFirst = snapshot();
const second = calculatePlayerPrices(db, tournamentId, gameweekId);
const afterSecond = snapshot();

process.stdout.write(`${JSON.stringify({
  before,
  afterFirst,
  afterSecond,
  first: {
    runId: first.runId,
    updated: first.updated,
    bootstrap: first.bootstrap,
    idempotent: first.idempotent,
  },
  second: {
    runId: second.runId,
    updated: second.updated,
    bootstrap: second.bootstrap,
    idempotent: second.idempotent,
  },
  runCount: Number((db.prepare('SELECT COUNT(*) AS total FROM pricing_runs').get() as { total: number }).total),
  historyCount: Number((db.prepare('SELECT COUNT(*) AS total FROM player_price_history').get() as { total: number }).total),
}, null, 2)}\n`);
db.close();
