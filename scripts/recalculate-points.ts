import 'dotenv/config';
import { openDatabase } from '../server/db.ts';
import { recalculateGameweek } from '../server/scoring.ts';
import { recalculatePlayerPrices } from '../server/pricing.ts';

const database = openDatabase();

try {
  const requestedGameweek = process.argv[2];
  const gameweeks = requestedGameweek
    ? [{ id: requestedGameweek }]
    : database.prepare(`SELECT id FROM gameweeks WHERE status = 'FINISHED' ORDER BY week_number`).all() as Array<{ id: string }>;
  const results = gameweeks.map(({ id }) => ({ gameweekId: id, ...recalculateGameweek(database, id) }));
  const pricing = recalculatePlayerPrices(database);
  process.stdout.write(`${JSON.stringify({ success: true, results, pricing }, null, 2)}\n`);
} finally {
  database.close();
}
