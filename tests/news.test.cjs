const assert=require('node:assert/strict'),fs=require('node:fs');
const {parseFeed,createNewsService}=require('../lib/news');
const {PGlite}=require(process.env.PGLITE_TEST_MODULE||'@electric-sql/pglite');
const rss='<rss><channel><item><guid>1</guid><title>Team &amp; player</title><link>https://www.hltv.org/news/1/test</link><pubDate>Mon, 21 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>';
const steam=JSON.stringify({appnews:{appid:730,newsitems:[{gid:'2',title:'Update',feedname:'steam_community_announcements',url:'https://steamcommunity.com/announcements/2',date:1789950000}]}});
(async()=>{
 assert.equal(parseFeed(rss,'hltv')[0].title,'Team & player');
 assert.equal(parseFeed(rss.replace('https://www.hltv.org/news/1/test','javascript:alert(1)'),'hltv').length,0);
 assert.throws(()=>parseFeed('<html>blocked</html>','hltv'));
 assert.equal(parseFeed(steam.replace('steam_community_announcements','unrelated'),'steam').length,0);
 const db=new PGlite();try{
  await db.exec(fs.readFileSync(require('node:path').join(__dirname,'../db/migration_v21.sql'),'utf8'));
  let calls=0,fail=false;
  const news=createNewsService(db,async url=>{calls++;if(fail&&url.includes('hltv'))throw new Error('fixture outage');return {ok:true,text:async()=>url.includes('hltv')?rss:steam}});
  await Promise.all([news.sync(),news.sync()]);assert.equal(calls,2);assert.equal((await news.read()).items.length,2);
  await news.sync();assert.equal(calls,2);
  await db.query("UPDATE news_feeds SET checked_at=NOW()-INTERVAL '2 hours'");fail=true;await news.sync();
  const result=await news.read();assert.equal(result.items.length,2);assert.equal(result.sources.find(s=>s.id==='hltv').stale,true);assert.equal(result.sources.find(s=>s.id==='steam').stale,false);
  console.log('PASS: parser, safe links, official-only filter, durable cache, refresh intervals, single-flight and source isolation');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
