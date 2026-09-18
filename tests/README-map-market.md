# Map prediction validation

Run `npm test` (Node.js 20+). The 36 tests cover the existing PandaScore result recovery and the new map market using transactional database doubles. They do not replace a PostgreSQL integration test.

Map odds are configured by an admin for BO3 (2/3) or BO5 (3/4/5), with no default odds. Stake is 1–1,000,000 entertainment points, odds 1–100 with up to four decimals. Existing predictions keep locked odds. Exact request retries do not relock at a different price. A changed choice or stake locks current odds after the user confirms them.

Winning return includes stake and is rounded down. Losing picks release frozen points without a second deduction. Old zero-stake picks remain zero-stake and receive no payouts. All modifications, settlement, and reversal run in transactions with a locked match row.

Winner and map results are separate markets. Missing or 0:0 scores never imply an actual map count. Automatic map settlement requires complete, ordered, non-forfeit played-game evidence and a valid series winner. Otherwise admin confirms the actual count after winner settlement. Manual reversal suspends automatic map settlement until admin confirms a replacement result. Whole-match reversal reverses both markets in the same transaction.

Migration v18 is additive and runs during existing startup initialization. No live odds are populated automatically. User histories, leaderboard counts and admin counts include both markets. Deleting a manual match with either type of prediction is blocked.

Not included in this change: cancellation/postponement refunds, live score subscriptions, and the remaining stage-three visual cleanup. Existing historical winner conflicts remain protected.

Local UI verification used fixture data only, including map-only user history and closed-odds display. No production predictions were placed during development.
