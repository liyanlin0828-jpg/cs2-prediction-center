'use strict';
// Decorate only an administrator's transaction. The audit insert precedes the
// actual COMMIT so any audit failure rolls the original operation back as well.
function auditedPool(pool,actorId,action,kind,targetId){
  return {async connect(){
    const client=await pool.connect();let before,actor;
    async function snapshot(lock=false){
      if(kind==='user')return {users:(await client.query('SELECT id,username,points,locked_points FROM users WHERE id=$1'+(lock?' FOR UPDATE':''),[targetId])).rows};
      const match=(await client.query('SELECT * FROM matches WHERE id=$1'+(lock?' FOR UPDATE':''),[targetId])).rows[0]||null;
      const predictions=(await client.query('SELECT * FROM predictions WHERE match_id=$1 ORDER BY user_id,id',[targetId])).rows;
      const maps=(await client.query('SELECT * FROM map_predictions WHERE match_id=$1 ORDER BY user_id,id',[targetId])).rows;
      const ids=[...new Set([...predictions,...maps].map(p=>p.user_id))];
      const users=(await client.query('SELECT id,username,points,locked_points FROM users WHERE id=ANY($1::int[]) ORDER BY id'+(lock?' FOR UPDATE':''),[ids])).rows;
      return {match,predictions,maps,users};
    }
    return {
      release:()=>client.release(),
      async query(sql,params){
        const command=typeof sql==='string'?sql.trim().toUpperCase():'';
        if(command==='BEGIN'){
          const result=await client.query(sql,params);
          actor=(await client.query('SELECT username FROM users WHERE id=$1',[actorId])).rows[0]?.username;
          if(!actor)throw new Error('管理员不存在，操作未执行');
          before=await snapshot(true);return result;
        }
        if(command==='COMMIT'){
          const after=await snapshot();
          if(JSON.stringify(before)!==JSON.stringify(after))await client.query(
            'INSERT INTO admin_audit_logs(actor_id,actor_name,action,target_kind,target_id,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',
            [actorId,actor,action,kind,targetId,JSON.stringify(before),JSON.stringify(after)]);
        }
        return client.query(sql,params);
      }
    };
  }};
}
module.exports={auditedPool};
