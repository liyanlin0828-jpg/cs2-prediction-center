# 取消、延期与本金退还

取消比赛：只退还未结算的胜负／总地图数预测本金。同一事务锁定比赛、两类预测及用户，保留原下注与赔率，记录 refunded、refund_points、refunded_at，净盈亏为零。重复请求不再增加积分；已有胜负或地图结算时拒绝退分，需要管理员先核查并撤销结算。

正式延期：暂停下注，保留冻结本金。管理员可以选择延期退本金。尚未退分的 PandaScore 比赛在收到不同的未来开赛时间后恢复预测，或在官方 running 时进入比赛中；手动比赛由管理员填写新时间恢复。普通改期仍更新原赛程，不自动退分。

已退分比赛永久关闭原预测，不自动重新扣分或派彩。若需要重新开放，应创建新的比赛记录。无下注历史的记录仍会标记退分完成，避免后续重新开放。

自动同步先查最近 past，再按未结算 external_id 补查 past；仍缺失的记录每批最多 100 个 ID 查询官方所有状态列表 /matches。只有明确 canceled 才自动退分，缺失记录绝不推断取消。finished + 有效 winner_id 的原有胜负结算继续保留。

前台显示延期暂停、退分原因与本金，已退分不计胜率。后台提供取消退分、延期保留、延期退分和手动比赛恢复入口。

部署时自动运行 migration_v19.sql，仅增加字段，不会在迁移中退分或修改既有余额。

验证：
- `node --check` 检查所有变更 JS。
- `node tests/pandascore-sync.test.cjs`：22 项通过。
- `node tests/map-market.test.cjs`：19 项通过。
- `node tests/match-lifecycle.test.cjs`：14 项通过。
- 浏览器本地夹具验证延期按钮禁用、两类历史记录、已退本金筛选及后台入口。

测试边界：本地事务测试使用可回滚的模拟数据库，包含写入失败、余额不一致、重复退分、结算后取消冲突及来源校验；没有真实 PostgreSQL 并发压力测试，也没有对生产账户执行测试下注或人为退分。

官方语义参考：https://developers.pandascore.co/docs/matches-lifecycle
所有状态列表：https://developers.pandascore.co/reference/get_matches
