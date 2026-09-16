/* global process, URL */
import Database from 'better-sqlite3';

const db = new Database('data/fantasy-lpf.sqlite', { readonly: true });

const gameweeks = db.prepare(`
  SELECT
    g.week_number AS week,
    g.status,
    g.deadline_at AS deadline,
    (SELECT COUNT(*) FROM matches m WHERE m.gameweek_id = g.id) AS matches,
    (SELECT COUNT(*) FROM matches m WHERE m.gameweek_id = g.id
      AND m.score_status IN ('CONFIRMED', 'CORRECTED')) AS confirmed,
    (SELECT COUNT(*) FROM matches m WHERE m.gameweek_id = g.id
      AND m.score_status NOT IN ('CONFIRMED', 'CORRECTED')) AS unconfirmed,
    (SELECT COUNT(*) FROM player_match_stats s
      JOIN matches m ON m.id = s.match_id WHERE m.gameweek_id = g.id) AS stats,
    (SELECT COUNT(*) FROM player_fantasy_points p WHERE p.gameweek_id = g.id) AS pointRows,
    (SELECT COUNT(*) FROM pricing_runs r WHERE r.as_of_gameweek_id = g.id
      AND r.status = 'COMPLETED') AS completedPricingRuns
  FROM gameweeks g
  ORDER BY g.week_number
`).all();

const observations = db.prepare(`
  SELECT source, entity_type AS entityType, COUNT(*) AS count, MAX(observed_at) AS latest
  FROM source_observations
  GROUP BY source, entity_type
  ORDER BY source, entity_type
`).all();

const syncRuns = db.prepare(`
  SELECT source, job, status, records_found AS recordsFound,
    records_created AS recordsCreated, records_updated AS recordsUpdated,
    conflicts, finished_at AS finishedAt
  FROM sync_runs
  ORDER BY finished_at DESC
  LIMIT 12
`).all();

const externalIds = db.prepare(`
  SELECT 'club' AS entity, source, COUNT(*) AS count
  FROM club_external_ids GROUP BY source
  UNION ALL
  SELECT 'player', source, COUNT(*) FROM player_external_ids GROUP BY source
  UNION ALL
  SELECT 'match', source, COUNT(*) FROM match_external_ids GROUP BY source
  ORDER BY entity, source
`).all();

const statCoverage = db.prepare(`
  SELECT COUNT(*) AS rows,
    SUM(CASE WHEN minutes IS NULL THEN 1 ELSE 0 END) AS missingMinutes,
    SUM(CASE WHEN saves IS NULL THEN 1 ELSE 0 END) AS missingSaves,
    SUM(CASE WHEN assist_status NOT IN ('CONFIRMED', 'CORRECTED') THEN 1 ELSE 0 END) AS unconfirmedAssists
  FROM player_match_stats
`).get();

const playersWithoutCurrentPricing = db.prepare(`
  SELECT p.name, p.position, c.name AS club, tp.price_cents AS priceCents,
    tp.pricing_status AS pricingState
  FROM tournament_players tp
  JOIN players p ON p.id = tp.player_id
  LEFT JOIN clubs c ON c.id = p.club_id
  WHERE tp.tournament_id = 'apertura-2026' AND tp.active = 1
    AND tp.pricing_status <> 'CURRENT'
  ORDER BY p.position, p.name
`).all();

const lpfByPage = Object.entries(db.prepare(`
  SELECT source_url AS sourceUrl FROM source_observations
  WHERE source = 'LPF' AND entity_type = 'player'
`).all().reduce((counts, row) => {
  const path = new URL(row.sourceUrl).pathname;
  counts[path] = (counts[path] ?? 0) + 1;
  return counts;
}, {})).map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path));

process.stdout.write(`${JSON.stringify({
  gameweeks, observations, syncRuns, externalIds, statCoverage, playersWithoutCurrentPricing, lpfByPage,
}, null, 2)}\n`);
db.close();
