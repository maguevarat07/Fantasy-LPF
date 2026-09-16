import Database from 'better-sqlite3';
import path from 'node:path';
import process from 'node:process';

const filename = path.resolve(process.argv[2] ?? 'data/fantasy-lpf.sqlite');
const db = new Database(filename, { readonly: true, fileMustExist: true });
const tournamentId = process.argv[3] ?? 'apertura-2026';

const scalar = (sql, ...params) => Number(db.prepare(sql).get(...params).total);
const moneyColumns = [
  ['tournament_players.price_cents', 'SELECT COUNT(*) AS total FROM tournament_players WHERE typeof(price_cents) <> \'integer\''],
  ['squad_players.purchase_price_cents', 'SELECT COUNT(*) AS total FROM squad_players WHERE typeof(purchase_price_cents) <> \'integer\''],
  ['fantasy_teams.bank_cents', 'SELECT COUNT(*) AS total FROM fantasy_teams WHERE typeof(bank_cents) <> \'integer\''],
  ['transfer_items.sell_price_cents', 'SELECT COUNT(*) AS total FROM transfer_items WHERE typeof(sell_price_cents) <> \'integer\''],
  ['transfer_items.buy_price_cents', 'SELECT COUNT(*) AS total FROM transfer_items WHERE typeof(buy_price_cents) <> \'integer\''],
];

const result = {
  filename,
  userVersion: db.pragma('user_version', { simple: true }),
  integrityCheck: db.pragma('integrity_check'),
  foreignKeyErrors: db.pragma('foreign_key_check'),
  activePricingStates: db.prepare(`SELECT pricing_status AS status, COUNT(*) AS count
    FROM tournament_players WHERE tournament_id = ? AND active = 1
    GROUP BY pricing_status ORDER BY pricing_status`).all(tournamentId),
  activeLegacyPlayers: db.prepare(`SELECT p.id, p.name, p.position, tp.price_cents AS priceCents
    FROM tournament_players tp JOIN players p ON p.id = tp.player_id
    WHERE tp.tournament_id = ? AND tp.active = 1 AND tp.pricing_status <> 'CURRENT'
    ORDER BY p.name`).all(tournamentId),
  pricingRuns: db.prepare(`SELECT id, as_of_gameweek_id AS gameweekId, formula_version AS formulaVersion,
      status, created_at AS createdAt, completed_at AS completedAt
    FROM pricing_runs WHERE tournament_id = ? ORDER BY created_at`).all(tournamentId),
  priceHistoryCount: scalar('SELECT COUNT(*) AS total FROM player_price_history WHERE tournament_id = ?', tournamentId),
  transfers: scalar(`SELECT COUNT(*) AS total FROM transfers t JOIN fantasy_teams ft ON ft.id = t.fantasy_team_id
    WHERE ft.tournament_id = ?`, tournamentId),
  activeManagers: scalar(`SELECT COUNT(*) AS total FROM fantasy_teams ft WHERE ft.tournament_id = ?
    AND (SELECT COUNT(*) FROM squad_players sp WHERE sp.fantasy_team_id = ft.id) = 15`, tournamentId),
  unsafeMoneyValues: Object.fromEntries(moneyColumns.map(([column, sql]) => [column, scalar(sql)])),
  offTickCurrentPrices: scalar(`SELECT COUNT(*) AS total FROM tournament_players
    WHERE tournament_id = ? AND pricing_status = 'CURRENT' AND price_cents % 10000000 <> 0`, tournamentId),
  maxAbsolutePersistedChangeCents: Number((db.prepare(`SELECT COALESCE(MAX(ABS(change_cents)), 0) AS value
    FROM player_price_history WHERE tournament_id = ?`).get(tournamentId)).value),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
db.close();
