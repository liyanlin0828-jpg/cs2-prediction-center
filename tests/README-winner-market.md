# Independent winner tickets (v26)

Each accepted request creates one immutable winner ticket. A retry uses the same user/request ID and identical match, team, stake and odds; it returns the existing ticket even after closure. Reusing the ID with different contents fails. The match and user rows are locked in the same transaction as the debit and insert. Existing tickets are retained by the migration.

The homepage requires explicit odds confirmation and describes additional tickets as new stakes. Match cards show the most recent ticket; the profile lists every ticket. Winner settlement, reversal, refunds, admin audit and totals continue using the predictions table.

Live acceptance is deliberately hard-disabled at the HTTP route (`false`). No provider ingestion, subscription or production live market has been enabled. The internal gate requires an explicitly enabled caller, running match, matching teams/ID, connected/open provider quote, version and an unexpired observation within 10 seconds. This is a conservative placeholder, not a verified provider latency guarantee. Validate actual suspension/recovery semantics and replace the freshness policy before enabling live bets.

Validation: syntax checks; existing PandaScore/lifecycle/admin-auth tests; isolated PGlite winner-market and legacy-undo suites. The new database test covers repeated migration, serialized concurrent retries, immutable odds across additional tickets, changed-price rejection, closure retries, disabled/stale/disconnected/suspended live quotes, multi-ticket refund and actual settlement/undo/re-settlement.

Set PGLITE_TEST_MODULE to an installed @electric-sql/pglite package and run `node tests/winner-market-postgres.test.cjs`. PGlite serializes connections; real PostgreSQL concurrent integration tests remain required before enabling in-play acceptance. Do not test transactions against production accounts.
