# CS2 赛事预测中心 V2

V2 是可部署的全栈版本，包含前台、管理员后台、PostgreSQL、JWT 登录、自动积分结算，以及 PandaScore CS2 赛事同步。

## 主要功能

### 用户端
- 注册 / 登录
- JWT 会话
- 密码 bcrypt 哈希
- 浏览未来比赛
- 每场比赛仅允许一次预测
- 个人预测历史
- 积分、胜率、共享排行榜

### 管理端
访问 `/admin.html`

- 仪表盘统计
- 用户列表
- 手动添加比赛
- 比赛列表
- 一键选择胜方并自动结算
- PandaScore 未来 CS2 比赛同步

### PandaScore
服务器调用：
`GET https://api.pandascore.co/csgo/matches/upcoming`

Token 必须写在服务器 `.env` 的 `PANDASCORE_TOKEN` 中，前端不会拿到 Token。

## 本地运行

1. Node.js 20+
2. PostgreSQL 15+

创建数据库：

```sql
CREATE DATABASE cs2_prediction;
```

复制环境变量：

```bash
cp .env.example .env
```

修改 `.env`：

```env
PORT=3000
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/cs2_prediction
JWT_SECRET=请改成足够长的随机字符串
NODE_ENV=development
PANDASCORE_TOKEN=你的_PandaScore_Token
```

安装并初始化：

```bash
npm install
npm run db:init
npm start
```

打开：
- 前台 `http://localhost:3000`
- 后台 `http://localhost:3000/admin.html`

默认管理员：
- username: `admin`
- password: `Admin123!`

**正式上线前必须修改管理员密码。**

## 从 V1 数据库升级

如果数据库已经运行过 V1，请额外执行：

```bash
psql "$DATABASE_URL" -f db/migration_v2.sql
```

## Docker

```bash
docker compose up -d db
docker compose run --rm web npm run db:init
docker compose up -d web
```

## Render 部署

项目附带 `render.yaml`。在 Render 创建 Blueprint，连接 Git 仓库后：
1. Render 自动创建 Web Service + PostgreSQL
2. 设置 `PANDASCORE_TOKEN`
3. 首次启动会自动执行数据库初始化，无需手动建表
4. 打开 Render 提供的公网域名

## 积分规则（可在代码中调整）
- 新用户：1000
- 首次预测：+50
- 猜中：+100
- 猜错：-50
- 用户积分最低为 0

## 生产环境继续建议
- 邮箱验证 / 忘记密码
- 登录速率限制
- CSRF/CSP 等安全头
- 管理员操作审计日志
- 定时同步赛事和自动读取赛果
- 正式域名 + HTTPS
- 数据库自动备份

本系统目前是娱乐积分预测，不包含真钱充值、提现或赌博功能。


## V2.1 Render 一键部署改进

- `npm start` 会先自动运行 `npm run db:init`
- 生产环境必须设置 `ADMIN_PASSWORD`
- 管理员用户名固定为 `admin`
- 数据库表和演示赛事会在首次启动时自动创建
- 重启时初始化脚本是幂等的，不会重复创建管理员
