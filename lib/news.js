'use strict';
const SOURCES=[
 {id:'esi',label:'Esports Insider',category:'esports',interval:10*60*1000,url:'https://esportsinsider.com/feed'},
 {id:'steam',label:'CS2 官方',category:'official',interval:10*60*1000,url:'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=730&count=20&maxlength=1&feeds=steam_community_announcements'}
];
function decode(s){return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(all,x)=>{if(x[0]==='#'){const n=x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):Number(x.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):''}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[x.toLowerCase()]})}
function safeUrl(value,source){try{const u=new URL(value);const hosts={esi:['esportsinsider.com','www.esportsinsider.com'],steam:['store.steampowered.com','steamcommunity.com','steamstore-a.akamaihd.net']}[source]||[];return u.protocol==='https:'&&!u.username&&!u.password&&hosts.includes(u.hostname)?u.href:null}catch{return null}}
function parseFeed(text,source){
 let raw;
 if(source==='steam'){
  const data=JSON.parse(text);if(data.appnews?.appid!==730||!Array.isArray(data.appnews.newsitems))throw new Error('Invalid Steam feed');
  raw=data.appnews.newsitems.filter(x=>x.feedname==='steam_community_announcements').map(x=>({id:String(x.gid),title:x.title,url:x.url,date:Number(x.date)*1000}));
 }else{
  if(!/<rss\b/i.test(text)||!/<\/channel>/i.test(text)||/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Invalid RSS feed');
  const field=(s,k)=>{const v=s.match(new RegExp('<'+k+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+k+'>','i'))?.[1]||'';return decode(v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim())};
  raw=[...text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
   .filter(([,x])=>source!=='esi'||[...x.matchAll(/<category\b[^>]*>[\s\S]*?<\/category>/gi)].some(([tag])=>/^counter-strike(?: 2)?$/i.test(field(tag,'category'))))
   .map(([,x])=>({id:field(x,'guid')||field(x,'link'),title:field(x,'title'),url:field(x,'link'),date:Date.parse(field(x,'pubDate'))}));
 }
 const seen=new Set();return raw.flatMap(x=>{
  const url=safeUrl(x.url,source),title=String(x.title||'').trim().slice(0,300);
  if(!url||!title||!x.id||!Number.isFinite(x.date)||x.date<=0||seen.has(url))return [];
  seen.add(url);return [{id:source+':'+x.id,title,url,publishedAt:new Date(x.date).toISOString(),source,category:source==='steam'?'official':'esports'}];
 }).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,30);
}
function createNewsService(pool,fetcher=fetch){
 let running=null;
 async function sync({retryFailed=false}={}){
  if(running)return running;
  running=(async()=>{
   for(const source of SOURCES){
    const row=(await pool.query('SELECT * FROM news_feeds WHERE source=$1',[source.id])).rows[0];
    if(retryFailed&&!row?.failed)continue;
    if(row?.checked_at&&Date.now()-new Date(row.checked_at).getTime()<(retryFailed?60000:source.interval))continue;
    try{
     const response=await fetcher(source.url,{signal:AbortSignal.timeout(12000),headers:{Accept:source.id==='steam'?'application/json':'application/rss+xml'}});
     if(!response.ok)throw new Error('News source HTTP '+response.status);
     const text=await response.text();if(text.length>2000000)throw new Error('News feed too large');
     const fresh=parseFeed(text,source.id);if(!fresh.length&&source.id!=='esi')throw new Error('Empty news feed');
     // A general RSS feed may temporarily contain no CS2 articles. Retain older CS2 headlines.
     const seen=new Set();
     const items=[...fresh,...(row?.items||[])].filter(item=>{if(seen.has(item.url))return false;seen.add(item.url);return true}).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,30);
     await pool.query('INSERT INTO news_feeds(source,items,checked_at,success_at,failed) VALUES($1,$2::jsonb,NOW(),NOW(),false) ON CONFLICT(source) DO UPDATE SET items=EXCLUDED.items,checked_at=NOW(),success_at=NOW(),failed=false',[source.id,JSON.stringify(items)]);
    }catch(e){
     console.warn('[News]',source.id,e.message);
     await pool.query('INSERT INTO news_feeds(source,checked_at,failed) VALUES($1,NOW(),true) ON CONFLICT(source) DO UPDATE SET checked_at=NOW(),failed=true',[source.id]);
    }
   }
  })().finally(()=>{running=null});return running;
 }
 async function read(){
  const rows=(await pool.query('SELECT * FROM news_feeds')).rows.filter(r=>SOURCES.some(s=>s.id===r.source));
  return {items:rows.flatMap(r=>r.items).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)),sources:SOURCES.map(s=>{const r=rows.find(x=>x.source===s.id);return {id:s.id,label:s.label,successAt:r?.success_at||null,stale:!r?.success_at||r.failed||Date.now()-new Date(r.success_at).getTime()>s.interval*2}})};
 }
 return {sync,read};
}
module.exports={createNewsService,parseFeed,safeUrl,SOURCES};
