# Canonical LPF ingestion

This server-only pipeline fetches source pages, stores source observations, reconciles identities conservatively and upserts canonical entities. It never assigns Fantasy prices or points.

Run a read-only acquisition with:

```sh
npx tsx scripts/sync-lpf-data.ts --dry-run
```

Use `--full` only when the full normalized payload is needed. Set `LPF_ROSTER_URLS` to a comma-separated list of official club roster pages (`/team/.../plantilla/` or `/list/<club>/`). `LPF_ROSTER_URL` remains available for one page. The global LPF list contains records without enough tournament/club context; those remain auditable observations and are not activated as selectable players.

For persistence, `server/db.ts` must export `canonicalDataRepository`, implementing `CanonicalDataRepository` from `repository.ts`. The database implementation must provide transactions and these unique keys:

- external identities: `(source, external_id)` per entity type;
- source observations: `(source, entity_type, external_entity_id, parser_version, content_hash)`;
- player match stats: canonical `(player_id, match_id)` plus retained source provenance;
- lineup entries: canonical `(match_id, player_id)`;
- match events: stable source event identity plus canonical match/player links;
- sync runs: `run_id`.

Every entity upsert also creates or updates its external-ID link. A zero-record response never deactivates existing players. Deactivation must be a separate, reviewed workflow based on multiple successful observations.

`demoPlayersDetected` remains `null` because determining whether a canonical row is demo data requires explicit provenance in the database. Reporting zero without such evidence would be false.

LPF is authoritative for its roster fields. Secondary pages are currently conservative probes: if they render client-side, block automation or expose no stable public entity contract, they retain response evidence and report `PARTIAL`, `BLOCKED` or `NOT_VERIFIED`. They do not infer player or match records from page titles or marketing text.
