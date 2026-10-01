# Map selection prediction

Each user chooses one map per match. Membership in the complete final veto list is a win, including a decider that was never played. This market does not predict played-map count, order, or map winner. Supported formats: BO1, BO3, BO5.

## Operations

- Apply migration_v25 through the existing `db:init` startup. It adds separate records without rewriting or deleting the old `map_predictions` table.
- Admin → match → 地图选择: enable the event's actual eligible maps with individually configured odds and a closing time BEFORE veto information becomes public. The catalogue is not an assertion of the current tournament pool. Nothing is open by default.
- Both the configured deadline and existing ten-minute pre-match deadline are enforced by the server. Manual locking is irreversible; expired markets cannot be reopened. If the veto is published early, lock immediately.
- Once the match is finished, verify the complete final list (exactly BO1/3/5 distinct names), including the unplayed decider, and record a source URL. Missing or incomplete evidence stays pending. The URL is an administrator's audit reference, not automatic source verification.
- No automatic settlement uses `games` or the series score: those can omit an unplayed decider. Automated source integration is intentionally not claimed by this release.
- Undo restores the original frozen stake and keeps the market locked. Refunds and whole-match undo include this market atomically. Audit records capture configuration, results and affected users.
- Old map-count API submissions and odds updates return 410. Old records retain their original rules and administrative settlement/undo.

## Validation

`node tests/map-selection-postgres.test.cjs` uses an isolated @electric-sql/pglite database; set PGLITE_TEST_MODULE to an installed package location if needed. It applies the full schema and repeat migration, tests duplicate submission, odds changes, changing stakes, unplayed-decider wins, excluded-map losses, both result directions, atomic rollback, audit failure, cutoff enforcement and mixed-market refunds. It never accesses production data.

Existing sync, map-count, lifecycle, authorization, audit and legacy-undo checks must also pass. Browser checks use a read-only local fixture and do not submit production predictions.
