import Database from 'better-sqlite3';
import path from 'node:path';
import process from 'node:process';

const TO_MILLIONS = 100_000_000;
const TOURNAMENT_ID = process.argv[2] ?? 'apertura-2026';
const POSITION_ORDER = ['GK', 'DEF', 'MID', 'FWD'];
const QUOTAS = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const DEFAULT_RANGES = {
  GK: [4, 9], DEF: [4, 10], MID: [4.5, 14], FWD: [5, 18],
};

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(process.cwd(), 'data', 'fantasy-lpf.sqlite');
const db = new Database(databasePath, { readonly: true, fileMustExist: true });

function quantile(values, probability) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = (ordered.length - 1) * probability;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return ordered[lower + 1] === undefined
    ? ordered[lower]
    : ordered[lower] + fraction * (ordered[lower + 1] - ordered[lower]);
}

function summarize(values, includeAverage = true) {
  const result = {
    count: values.length,
    min: quantile(values, 0),
    median: quantile(values, 0.5),
    p25: quantile(values, 0.25),
    p75: quantile(values, 0.75),
    p90: quantile(values, 0.9),
    p95: quantile(values, 0.95),
    max: quantile(values, 1),
  };
  if (includeAverage) result.average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return result;
}

function rounded(value, digits = 3) {
  return value === null ? null : Number(value.toFixed(digits));
}

function percentileMidrank(values, target) {
  const less = values.filter(value => value < target).length;
  const equal = values.filter(value => value === target).length;
  return values.length ? (less + equal / 2) / values.length : 0.5;
}

const rawPlayers = db.prepare(`
  SELECT p.id, p.name, p.position, p.club_id AS clubId, c.name AS clubName,
    tp.price_cents AS currentPriceCents, tp.active
  FROM tournament_players tp
  JOIN players p ON p.id = tp.player_id
  JOIN clubs c ON c.id = p.club_id
  WHERE tp.tournament_id = ? AND tp.active = 1 AND p.active = 1
    AND p.position IN ('GK', 'DEF', 'MID', 'FWD')
`).all(TOURNAMENT_ID);

const pointRows = db.prepare(`
  SELECT pfp.player_id AS playerId, pfp.gameweek_id AS gameweekId, gw.week_number AS weekNumber,
    SUM(pfp.total_points) AS points,
    SUM(CASE WHEN pfp.participation_points > 0 THEN 1 ELSE 0 END) AS appearances
  FROM player_fantasy_points pfp
  JOIN gameweeks gw ON gw.id = pfp.gameweek_id
  WHERE gw.tournament_id = ?
  GROUP BY pfp.player_id, pfp.gameweek_id, gw.week_number
`).all(TOURNAMENT_ID);

const scoredWeeks = [...new Set(pointRows.map(row => Number(row.weekNumber)))].sort((a, b) => b - a);
const recentWeeks = new Set(scoredWeeks.slice(0, 3));
const pointsByPlayer = new Map();
for (const row of pointRows) {
  const current = pointsByPlayer.get(row.playerId) ?? { seasonPoints: 0, appearances: 0, recentPoints: 0 };
  current.seasonPoints += Number(row.points);
  current.appearances += Number(row.appearances);
  if (recentWeeks.has(Number(row.weekNumber))) current.recentPoints += Number(row.points);
  pointsByPlayer.set(row.playerId, current);
}

const clubMatchCounts = new Map(db.prepare(`
  SELECT p.club_id AS clubId, COUNT(DISTINCT pfp.match_id) AS matches
  FROM player_fantasy_points pfp
  JOIN players p ON p.id = pfp.player_id
  JOIN gameweeks gw ON gw.id = pfp.gameweek_id
  WHERE gw.tournament_id = ?
  GROUP BY p.club_id
`).all(TOURNAMENT_ID).map(row => [row.clubId, Number(row.matches)]));

const players = rawPlayers.map(player => {
  const points = pointsByPlayer.get(player.id) ?? { seasonPoints: 0, appearances: 0, recentPoints: 0 };
  const eligibleMatches = clubMatchCounts.get(player.clubId) ?? 0;
  return {
    ...player,
    currentPrice: Number(player.currentPriceCents) / TO_MILLIONS,
    seasonPoints: points.seasonPoints,
    appearances: points.appearances,
    recentForm: scoredWeeks.length ? points.recentPoints / Math.min(3, scoredWeeks.length) : 0,
    pointsPerAppearance: points.appearances ? points.seasonPoints / points.appearances : 0,
    participationRate: eligibleMatches ? Math.min(points.appearances / eligibleMatches, 1) : 0,
  };
});

function proposedPrices(config = {}) {
  const ranges = config.ranges ?? DEFAULT_RANGES;
  const gamma = config.gamma ?? 1.3;
  const shrinkageAppearances = config.shrinkageAppearances ?? 4;
  const weights = config.weights ?? { season: 0.5, recent: 0.3, ppa: 0.15, participation: 0.05 };
  const output = [];
  for (const position of POSITION_ORDER) {
    const group = players.filter(player => player.position === position);
    const season = group.map(player => player.seasonPoints);
    const recent = group.map(player => player.recentForm);
    const ppa = group.map(player => player.pointsPerAppearance);
    const raw = group.map(player => ({
      player,
      performanceIndex:
        weights.season * percentileMidrank(season, player.seasonPoints)
        + weights.recent * percentileMidrank(recent, player.recentForm)
        + weights.ppa * percentileMidrank(ppa, player.pointsPerAppearance)
        + weights.participation * player.participationRate,
    }));
    const positionalMedian = quantile(raw.map(value => value.performanceIndex), 0.5) ?? 0.5;
    for (const value of raw) {
      const confidence = Math.min(value.player.appearances / shrinkageAppearances, 1);
      const adjustedPerformance = value.performanceIndex * confidence + positionalMedian * (1 - confidence);
      const premium = Math.pow(Math.max(0, Math.min(1, adjustedPerformance)), gamma);
      const [minimum, maximum] = ranges[position];
      const unrounded = minimum + (maximum - minimum) * premium;
      const proposedPrice = Math.round(unrounded * 10) / 10;
      output.push({ ...value.player, performanceIndex: value.performanceIndex, confidence, adjustedPerformance, proposedPrice });
    }
  }
  return output;
}

function optimizeTeam(candidates, objective = 'points') {
  const clubs = [...new Set(candidates.map(player => player.clubId))];
  let states = new Map([['0,0,0,0', { points: 0, cost: 0, selection: [] }]]);
  for (const clubId of clubs) {
    const byPosition = Object.fromEntries(POSITION_ORDER.map(position => [position,
      candidates.filter(player => player.clubId === clubId && player.position === position)
        .sort((a, b) => objective === 'cost'
          ? a.proposedPrice - b.proposedPrice || b.seasonPoints - a.seasonPoints
          : objective === 'price'
            ? b.proposedPrice - a.proposedPrice || b.seasonPoints - a.seasonPoints
            : b.seasonPoints - a.seasonPoints || a.proposedPrice - b.proposedPrice)]));
    const options = [];
    for (let gk = 0; gk <= Math.min(3, byPosition.GK.length, QUOTAS.GK); gk += 1) {
      for (let def = 0; def <= Math.min(3 - gk, byPosition.DEF.length, QUOTAS.DEF); def += 1) {
        for (let mid = 0; mid <= Math.min(3 - gk - def, byPosition.MID.length, QUOTAS.MID); mid += 1) {
          for (let fwd = 0; fwd <= Math.min(3 - gk - def - mid, byPosition.FWD.length, QUOTAS.FWD); fwd += 1) {
            const selection = [
              ...byPosition.GK.slice(0, gk), ...byPosition.DEF.slice(0, def),
              ...byPosition.MID.slice(0, mid), ...byPosition.FWD.slice(0, fwd),
            ];
            options.push({ counts: [gk, def, mid, fwd], selection,
              points: selection.reduce((sum, player) => sum + player.seasonPoints, 0),
              cost: selection.reduce((sum, player) => sum + player.proposedPrice, 0) });
          }
        }
      }
    }
    const next = new Map();
    for (const [key, state] of states) {
      const counts = key.split(',').map(Number);
      for (const option of options) {
        const combined = counts.map((count, index) => count + option.counts[index]);
        if (combined.some((count, index) => count > QUOTAS[POSITION_ORDER[index]])) continue;
        const nextKey = combined.join(',');
        const candidate = { points: state.points + option.points, cost: state.cost + option.cost,
          selection: [...state.selection, ...option.selection] };
        const previous = next.get(nextKey);
        const isBetter = objective === 'cost'
          ? !previous || candidate.cost < previous.cost || (candidate.cost === previous.cost && candidate.points > previous.points)
          : objective === 'price'
            ? !previous || candidate.cost > previous.cost || (candidate.cost === previous.cost && candidate.points > previous.points)
            : !previous || candidate.points > previous.points || (candidate.points === previous.points && candidate.cost < previous.cost);
        if (isBetter) next.set(nextKey, candidate);
      }
    }
    states = next;
  }
  return states.get(POSITION_ORDER.map(position => QUOTAS[position]).join(','));
}

function paretoPrune(states) {
  const groups = new Map();
  for (const state of states.values()) {
    const countsKey = state.counts.join(',');
    const group = groups.get(countsKey) ?? [];
    group.push(state);
    groups.set(countsKey, group);
  }
  const output = new Map();
  for (const group of groups.values()) {
    group.sort((a, b) => a.costUnits - b.costUnits || b.points - a.points);
    let bestPoints = -Infinity;
    for (const state of group) {
      if (state.points <= bestPoints) continue;
      bestPoints = state.points;
      output.set(`${state.counts.join(',')},${state.costUnits}`, state);
    }
  }
  return output;
}

function optimizeTeamUnderBudget(candidates, budget = 100) {
  const budgetUnits = Math.round(budget * 10);
  const clubs = [...new Set(candidates.map(player => player.clubId))];
  let global = new Map([['0,0,0,0,0', {
    counts: [0, 0, 0, 0], costUnits: 0, points: 0, selection: [],
  }]]);
  for (const clubId of clubs) {
    let local = new Map([['0,0,0,0,0', {
      counts: [0, 0, 0, 0], costUnits: 0, points: 0, selection: [],
    }]]);
    for (const player of candidates.filter(candidate => candidate.clubId === clubId)) {
      const next = new Map(local);
      const positionIndex = POSITION_ORDER.indexOf(player.position);
      for (const state of local.values()) {
        if (state.selection.length >= 3 || state.counts[positionIndex] >= QUOTAS[player.position]) continue;
        const counts = [...state.counts];
        counts[positionIndex] += 1;
        const costUnits = state.costUnits + Math.round(player.proposedPrice * 10);
        if (costUnits > budgetUnits) continue;
        const candidate = {
          counts, costUnits, points: state.points + player.seasonPoints,
          selection: [...state.selection, player],
        };
        const key = `${counts.join(',')},${costUnits}`;
        const previous = next.get(key);
        if (!previous || candidate.points > previous.points) next.set(key, candidate);
      }
      local = next;
    }
    local = paretoPrune(local);
    const combined = new Map();
    for (const prior of global.values()) {
      for (const option of local.values()) {
        const counts = prior.counts.map((count, index) => count + option.counts[index]);
        if (counts.some((count, index) => count > QUOTAS[POSITION_ORDER[index]])) continue;
        const costUnits = prior.costUnits + option.costUnits;
        if (costUnits > budgetUnits) continue;
        const candidate = {
          counts, costUnits, points: prior.points + option.points,
          selection: [...prior.selection, ...option.selection],
        };
        const key = `${counts.join(',')},${costUnits}`;
        const previous = combined.get(key);
        if (!previous || candidate.points > previous.points) combined.set(key, candidate);
      }
    }
    global = paretoPrune(combined);
  }
  const quotaKey = POSITION_ORDER.map(position => QUOTAS[position]).join(',');
  return [...global.values()]
    .filter(state => state.counts.join(',') === quotaKey)
    .sort((a, b) => b.points - a.points || b.costUnits - a.costUnits)[0];
}

function balancedTeam(candidates) {
  const byPosition = Object.fromEntries(POSITION_ORDER.map(position => [position, candidates.filter(player => player.position === position)]));
  const stars = new Set();
  const valuePicks = new Set();
  for (const position of POSITION_ORDER) {
    const ranked = [...byPosition[position]].sort((a, b) => b.adjustedPerformance - a.adjustedPerformance || b.seasonPoints - a.seasonPoints);
    ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.1))).forEach(player => stars.add(player.id));
    [...ranked]
      .filter(player => !stars.has(player.id))
      .sort((a, b) => (b.seasonPoints / b.proposedPrice) - (a.seasonPoints / a.proposedPrice) || a.proposedPrice - b.proposedPrice)
      .slice(0, Math.max(2, Math.ceil(ranked.length * 0.25)))
      .forEach(player => valuePicks.add(player.id));
  }
  const selected = [...optimizeTeam(candidates, 'points').selection];
  const totals = () => ({
    cost: selected.reduce((sum, player) => sum + player.proposedPrice, 0),
    points: selected.reduce((sum, player) => sum + player.seasonPoints, 0),
    starCount: selected.filter(player => stars.has(player.id)).length,
    valueCount: selected.filter(player => valuePicks.has(player.id)).length,
  });
  const swapCandidates = (predicate) => {
    const clubCounts = new Map();
    selected.forEach(player => clubCounts.set(player.clubId, (clubCounts.get(player.clubId) ?? 0) + 1));
    const selectedIds = new Set(selected.map(player => player.id));
    const swaps = [];
    selected.forEach((out, index) => {
      for (const incoming of byPosition[out.position]) {
        if (selectedIds.has(incoming.id)) continue;
        const incomingClubCount = (clubCounts.get(incoming.clubId) ?? 0) - (incoming.clubId === out.clubId ? 1 : 0);
        if (incomingClubCount >= 3) continue;
        const swap = {
          index, out, incoming,
          saving: out.proposedPrice - incoming.proposedPrice,
          pointsLoss: out.seasonPoints - incoming.seasonPoints,
          starDelta: Number(stars.has(incoming.id)) - Number(stars.has(out.id)),
          valueDelta: Number(valuePicks.has(incoming.id)) - Number(valuePicks.has(out.id)),
        };
        if (predicate(swap)) swaps.push(swap);
      }
    });
    return swaps;
  };
  for (let step = 0; step < 100; step += 1) {
    const state = totals();
    if (state.cost <= 100 && state.starCount <= 4) break;
    const mustRemoveStar = state.starCount > 4;
    const options = swapCandidates(swap => swap.saving > 0
      && state.starCount + swap.starDelta >= 2
      && state.starCount + swap.starDelta <= (mustRemoveStar ? state.starCount - 1 : 4));
    if (!options.length) return null;
    options.sort((a, b) => (a.pointsLoss / a.saving) - (b.pointsLoss / b.saving)
      || a.pointsLoss - b.pointsLoss || b.saving - a.saving);
    const choice = options[0];
    selected[choice.index] = choice.incoming;
  }
  for (let step = 0; step < 20 && totals().valueCount < 3; step += 1) {
    const state = totals();
    const options = swapCandidates(swap => swap.valueDelta > 0
      && state.cost - swap.saving <= 100
      && state.starCount + swap.starDelta >= 2 && state.starCount + swap.starDelta <= 4);
    if (!options.length) return null;
    options.sort((a, b) => a.pointsLoss - b.pointsLoss || b.saving - a.saving);
    selected[options[0].index] = options[0].incoming;
  }
  for (let step = 0; step < 30 && totals().cost < 95; step += 1) {
    const state = totals();
    const options = swapCandidates(swap => swap.saving < 0
      && state.cost - swap.saving <= 100
      && state.starCount + swap.starDelta >= 2 && state.starCount + swap.starDelta <= 4
      && state.valueCount + swap.valueDelta >= 3);
    if (!options.length) break;
    options.sort((a, b) => (b.incoming.seasonPoints - b.out.seasonPoints) - (a.incoming.seasonPoints - a.out.seasonPoints)
      || a.saving - b.saving);
    selected[options[0].index] = options[0].incoming;
  }
  for (let step = 0; step < 100; step += 1) {
    const state = totals();
    const options = swapCandidates(swap => swap.pointsLoss < 0
      && state.cost - swap.saving <= 100
      && state.starCount + swap.starDelta >= 2 && state.starCount + swap.starDelta <= 4
      && state.valueCount + swap.valueDelta >= 3);
    if (!options.length) break;
    options.sort((a, b) => a.pointsLoss - b.pointsLoss || b.saving - a.saving);
    selected[options[0].index] = options[0].incoming;
  }
  const state = totals();
  return state.cost >= 95 && state.cost <= 100 && state.starCount >= 2 && state.starCount <= 4 && state.valueCount >= 3
    ? { selection: selected, ...state }
    : null;
}

const proposed = proposedPrices();
const dream = optimizeTeam(proposed, 'points');
const cheapest = optimizeTeam(proposed, 'cost');
const balanced = balancedTeam(proposed);
const currentAudit = Object.fromEntries(POSITION_ORDER.map(position => {
  const values = players.filter(player => player.position === position).map(player => player.currentPrice);
  return [position, { ...Object.fromEntries(Object.entries(summarize(values)).map(([key, value]) => [key, rounded(value)])), numberOfDistinctPrices: new Set(values).size }];
}));
const pointsAudit = Object.fromEntries(POSITION_ORDER.map(position => {
  const values = players.filter(player => player.position === position).map(player => player.seasonPoints);
  const summary = summarize(values, false);
  return [position, Object.fromEntries(['min', 'median', 'p75', 'p90', 'p95', 'max'].map(key => [key, rounded(summary[key])]))];
}));
const proposedAudit = Object.fromEntries(POSITION_ORDER.map(position => {
  const values = proposed.filter(player => player.position === position).map(player => player.proposedPrice);
  return [position, { ...Object.fromEntries(Object.entries(summarize(values)).map(([key, value]) => [key, rounded(value)])), numberOfDistinctPrices: new Set(values).size }];
}));

function compactPlayer(player) {
  return {
    id: player.id, name: player.name, position: player.position, club: player.clubName,
    points: player.seasonPoints, appearances: player.appearances,
    currentPrice: rounded(player.currentPrice, 1), proposedPrice: rounded(player.proposedPrice, 1),
    recentForm: rounded(player.recentForm), pointsPerAppearance: rounded(player.pointsPerAppearance),
    participationRate: rounded(player.participationRate), adjustedPerformance: rounded(player.adjustedPerformance),
  };
}

const gammaAnalysis = [];
for (const gamma of [1.1, 1.3, 1.5, 1.75, 2, 2.5]) {
  for (const shrinkageAppearances of [3, 4, 6, 8]) {
    const scenario = proposedPrices({ gamma, shrinkageAppearances });
    const prices = new Map(scenario.map(player => [player.id, player.proposedPrice]));
    gammaAnalysis.push({
      gamma, shrinkageAppearances,
      dreamCost: rounded(dream.selection.reduce((sum, player) => sum + prices.get(player.id), 0), 1),
      allPlayerMedian: rounded(quantile(scenario.map(player => player.proposedPrice), 0.5), 1),
      allPlayerP90: rounded(quantile(scenario.map(player => player.proposedPrice), 0.9), 1),
    });
  }
}

const rangeScenarios = {
  original: DEFAULT_RANGES,
  moderate: { GK: [4, 8.5], DEF: [4, 9], MID: [4.5, 12], FWD: [5, 15] },
  compressed: { GK: [4, 8], DEF: [4, 8.5], MID: [4.5, 11], FWD: [5, 14] },
};
const rangeAnalysis = Object.entries(rangeScenarios).map(([name, ranges]) => {
  const scenario = proposedPrices({ ranges });
  const prices = new Map(scenario.map(player => [player.id, player.proposedPrice]));
  const minimum = optimizeTeam(scenario, 'cost');
  return {
    name, ranges,
    dreamCost: rounded(dream.selection.reduce((sum, player) => sum + prices.get(player.id), 0), 1),
    minimumValidTeamCost: rounded(minimum.cost, 1),
  };
});

const recommendedScenario = proposedPrices({ ranges: DEFAULT_RANGES, gamma: 2, shrinkageAppearances: 6 });
const recommendedDream = optimizeTeam(recommendedScenario, 'points');
const recommendedBalanced = balancedTeam(recommendedScenario);
const productionCandidates = proposed.map(player => ({ ...player, proposedPrice: player.currentPrice }));
const productionDream = optimizeTeam(productionCandidates, 'points');
const productionStarTeam = optimizeTeam(productionCandidates, 'price');
const productionBalanced = balancedTeam(productionCandidates);
const productionBudgetOptimal = optimizeTeamUnderBudget(productionCandidates);

const recentWeightAnalysis = [0.2, 0.3, 0.4].map(recent => {
  const season = 0.8 - recent;
  const scenario = proposedPrices({ weights: { season, recent, ppa: 0.15, participation: 0.05 } });
  const prices = new Map(scenario.map(player => [player.id, player.proposedPrice]));
  return { seasonWeight: season, recentWeight: recent, dreamCost: rounded(dream.selection.reduce((sum, player) => sum + prices.get(player.id), 0), 1) };
});

const tableCounts = Object.fromEntries(['players', 'tournament_players', 'gameweeks', 'matches', 'player_match_stats', 'player_fantasy_points', 'squad_players', 'transfers', 'transfer_items']
  .map(table => [table, Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total)]));
const availability = {
  ...tableCounts,
  activeTournamentPlayers: players.length,
  playersWithFantasyPoints: players.filter(player => pointsByPlayer.has(player.id)).length,
  playersWithAppearance: players.filter(player => player.appearances > 0).length,
  scoredGameweeks: scoredWeeks.sort((a, b) => a - b),
  currentOwners: Number(db.prepare('SELECT COUNT(DISTINCT fantasy_team_id) AS total FROM squad_players').get().total),
  distinctOwnedPlayers: Number(db.prepare('SELECT COUNT(DISTINCT player_id) AS total FROM squad_players').get().total),
};

const result = {
  generatedAt: new Date().toISOString(), tournamentId: TOURNAMENT_ID, databasePath,
  methodology: {
    quantiles: 'R-7 linear interpolation', recentForm: `average fantasy points across latest ${Math.min(3, scoredWeeks.length)} scored gameweeks, with missing player-weeks treated as zero`,
    participationRate: 'appearances divided by distinct scored matches observed for the player current club',
    balancedTeam: 'deterministic local search from the exact maximum-points team; requires 2-4 top-decile adjusted-performance stars, at least 3 value-pick candidates, $95M-$100M, quotas and max 3 per club',
  },
  availability,
  currentPriceDistribution: currentAudit,
  fantasyPointDistribution: pointsAudit,
  proposedPriceDistribution: proposedAudit,
  top20ProposedPrices: [...proposed].sort((a, b) => b.proposedPrice - a.proposedPrice || b.seasonPoints - a.seasonPoints).slice(0, 20).map(compactPlayer),
  top20Points: [...proposed].sort((a, b) => b.seasonPoints - a.seasonPoints || a.proposedPrice - b.proposedPrice).slice(0, 20).map(compactPlayer),
  valuePicks: [...proposed].filter(player => player.seasonPoints > 0).sort((a, b) => (b.seasonPoints / b.proposedPrice) - (a.seasonPoints / a.proposedPrice)).slice(0, 20).map(compactPlayer),
  dreamTeam: { points: dream.points, cost: rounded(dream.selection.reduce((sum, player) => sum + player.proposedPrice, 0), 1), players: dream.selection.map(compactPlayer) },
  minimumCostTeam: { points: cheapest.points, cost: rounded(cheapest.cost, 1), players: cheapest.selection.map(compactPlayer) },
  balancedTeam: balanced ? { ...balanced, cost: rounded(balanced.cost, 1), selection: undefined, players: balanced.selection.map(compactPlayer) } : null,
  recommendedScenario: {
    config: { ranges: DEFAULT_RANGES, gamma: 2, shrinkageAppearances: 6 },
    dreamTeam: { points: recommendedDream.points, cost: rounded(recommendedDream.cost, 1) },
    balancedTeam: recommendedBalanced ? { ...recommendedBalanced, cost: rounded(recommendedBalanced.cost, 1), selection: undefined,
      players: recommendedBalanced.selection.map(compactPlayer) } : null,
  },
  productionScenario: {
    dreamTeam: {
      points: productionDream.points,
      cost: rounded(productionDream.cost, 1),
      players: productionDream.selection.map(compactPlayer),
    },
    starTeam: {
      points: productionStarTeam.points,
      cost: rounded(productionStarTeam.cost, 1),
      players: productionStarTeam.selection.map(compactPlayer),
    },
    balancedTeam: productionBalanced ? {
      ...productionBalanced,
      cost: rounded(productionBalanced.cost, 1),
      selection: undefined,
      players: productionBalanced.selection.map(compactPlayer),
    } : null,
    budgetOptimalTeam: productionBudgetOptimal ? {
      points: productionBudgetOptimal.points,
      cost: rounded(productionBudgetOptimal.costUnits / 10, 1),
      players: productionBudgetOptimal.selection.map(compactPlayer),
    } : null,
    topPrices: [...productionCandidates]
      .sort((a, b) => b.currentPrice - a.currentPrice || b.seasonPoints - a.seasonPoints)
      .slice(0, 15).map(compactPlayer),
    topPoints: [...productionCandidates]
      .sort((a, b) => b.seasonPoints - a.seasonPoints || a.currentPrice - b.currentPrice)
      .slice(0, 15).map(compactPlayer),
    valuePicks: [...productionCandidates]
      .filter(player => player.seasonPoints > 0)
      .sort((a, b) => (b.seasonPoints / b.currentPrice) - (a.seasonPoints / a.currentPrice)
        || a.currentPrice - b.currentPrice)
      .slice(0, 15).map(compactPlayer),
  },
  gammaAnalysis,
  rangeAnalysis,
  recentWeightAnalysis,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
db.close();
