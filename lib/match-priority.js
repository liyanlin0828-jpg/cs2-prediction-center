'use strict';
// Editorial display priorities, NOT live audience metrics or competitive rankings.
// Maintain aliases explicitly: academy, female and former rosters must not inherit a main team's score.
const teamGroups=[
  {score:80,names:['Vitality','Team Vitality','NAVI','Natus Vincere','FaZe','FaZe Clan','G2','G2 Esports','Spirit','Team Spirit','MOUZ','FURIA','FURIA Esports','Falcons','Team Falcons']},
  {score:60,names:['Astralis','Liquid','Team Liquid','Virtus.pro','VP','Heroic','The MongolZ','MongolZ','Lynn Vision','Lynn Vision Gaming','Rare Atom']},
  {score:40,names:['NiP','Ninjas in Pyjamas','fnatic','ENCE','BIG','Complexity','Complexity Gaming','paiN','paiN Gaming','MIBR','Imperial','Imperial Esports','3DMAX','GamerLegion','B8','NRG','NRG Esports','100 Thieves','FlyQuest']}
];
const eventRules=[
  {score:100,pattern:'(^|[^a-z])major([^a-z]|$)'},
  {score:80,pattern:'(^|[^a-z])(iem|intel extreme masters|esl pro league|esports world cup)([^a-z]|$)|blast (premier|rivals|open|bounty)|pgl|starseries'},
  {score:30,pattern:'esl challenger|blast rising|dreamhack'},
  {score:20,pattern:'(^|[^a-z])cct([^a-z]|$)'}
];
const normalize=name=>name.toLowerCase().replace(/[^a-z0-9]/g,'');
const teams=Object.fromEntries(teamGroups.flatMap(g=>g.names.map(name=>[normalize(name),g.score])));
const literal=value=>"'"+value.replace(/'/g,"''")+"'";
function scoreSql(){
  const team=column=>`COALESCE((${literal(JSON.stringify(teams))}::jsonb ->> regexp_replace(lower(COALESCE(m.${column},'')),'[^a-z0-9]','','g'))::int,0)`;
  const event=`CASE ${eventRules.map(r=>`WHEN m.event_name ~* ${literal(r.pattern)} THEN ${r.score}`).join(' ')} ELSE 0 END`;
  // Qualifiers/open qualifiers should not receive the full main-event priority.
  return `((${event}) / CASE WHEN m.event_name ~* 'qualif|rising|academy' THEN 2 ELSE 1 END + ${team('team_a')} + ${team('team_b')})`;
}
function orderSql(mode){
  if(mode==='asc')return 'm.starts_at ASC,m.id ASC';
  if(mode==='desc')return 'm.starts_at DESC,m.id ASC';
  return "CASE WHEN m.status='postponed' THEN 1 ELSE 0 END,popularity_score DESC,m.starts_at ASC,m.id ASC";
}
module.exports={scoreSql,orderSql};
