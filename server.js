// Hues & Cues – asymmetrical party game. Zero dependencies: just `node server.js`.
const http=require('http'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000;
const GIVER_CAP=3;            // max points the clue giver can earn per round
const COLS=30,ROWS=16,MIN_PLAYERS=3,MAX_PLAYERS=30;
const LET='ABCDEFGHIJKLMNOP';
const P=new Map(),hosts=new Set();let nextIdx=0;
const G={phase:'lobby',per:1,order:[],ri:0,total:0,giver:null,target:null,parts:[],done:new Set(),guesses:[],rs:{}};
const lbl=(r,c)=>LET[r]+(c+1);
const color=(r,c)=>`hsl(${c*12},${r?90:75}%,${86-r*4.4}%)`;
const ip=()=>{for(const l of Object.values(os.networkInterfaces()))for(const i of l)if(i.family==='IPv4'&&!i.internal)return i.address;return'localhost'};
const board=()=>[...P.values()].sort((a,b)=>b.score-a.score).map(p=>({name:p.name,score:p.score}));
const LIVE=['clue1','guess1','clue2','guess2'];

function startRound(){
  G.giver=G.order[G.ri%G.order.length];
  G.parts=[...P.values()].filter(p=>p.res&&p.id!==G.giver).map(p=>p.id);
  G.target={r:Math.floor(Math.random()*ROWS),c:Math.floor(Math.random()*COLS)};
  G.guesses=[];G.done=new Set();G.rs={};G.phase='clue1';
}
function nextRound(){if(++G.ri>=G.total)G.phase='end';else startRound();}
function check(){
  if(G.phase!=='guess1'&&G.phase!=='guess2')return;
  if(!G.parts.every(i=>G.done.has(i)))return;
  G.done=new Set();
  if(G.phase==='guess1')G.phase='clue2';else reveal();
}
function reveal(){
  let hits=0;G.parts.forEach(i=>G.rs[i]=0);
  for(const x of G.guesses){
    const d=Math.max(Math.abs(x.r-G.target.r),Math.abs(x.c-G.target.c));
    G.rs[x.pid]=(G.rs[x.pid]||0)+(d===0?3:d===1?2:d===2?1:0);
    if(d<=1)hits++;
  }
  G.rs[G.giver]=Math.min(GIVER_CAP,hits);
  for(const[id,pts]of Object.entries(G.rs))if(P.has(id))P.get(id).score+=pts;
  G.phase='reveal';
}

function hostView(){
  const g=P.get(G.giver),ph=G.phase;
  const waiting=ph==='guess1'||ph==='guess2'?G.parts.filter(i=>!G.done.has(i)):(ph==='clue1'||ph==='clue2')?[G.giver]:[];
  return{type:'host',phase:ph,url:`http://${ip()}:${PORT}`,ri:G.ri,total:G.total,giver:g&&g.name,
    players:[...P.values()].map(p=>({id:p.id,name:p.name,score:p.score,on:!!p.res})),
    waiting:waiting.filter(i=>P.has(i)).map(i=>({id:i,name:P.get(i).name})),
    tokens:G.guesses.map(x=>{const p=P.get(x.pid);return{r:x.r,c:x.c,n:x.n,idx:p?p.idx:0,i:p?p.name[0].toUpperCase():'?'}}),
    target:ph==='reveal'?{r:G.target.r,c:G.target.c,label:lbl(G.target.r,G.target.c)}:null,
    rs:ph==='reveal'?Object.entries(G.rs).filter(([id])=>P.has(id)).map(([id,pts])=>({name:P.get(id).name,pts})).sort((a,b)=>b.pts-a.pts):[],
    board:board()};
}
function playerView(p){
  const ph=G.phase,isG=p.id===G.giver,g=P.get(G.giver);
  const t=G.target&&((isG&&LIVE.includes(ph))||ph==='reveal')?{label:lbl(G.target.r,G.target.c),color:color(G.target.r,G.target.c)}:null;
  return{type:'player',phase:ph,me:{name:p.name,score:p.score},giver:g&&g.name,isGiver:isG,
    inRound:isG||G.parts.includes(p.id),locked:G.done.has(p.id),target:t,
    mine:G.guesses.filter(x=>x.pid===p.id).map(x=>lbl(x.r,x.c)),pts:G.rs[p.id]||0,taken:G.guesses.map(x=>[x.r,x.c]),ri:G.ri,total:G.total,board:board()};
}
const send=(res,o)=>res.write('data:'+JSON.stringify(o)+'\n\n');
function broadcast(){for(const h of hosts)send(h,hostView());for(const p of P.values())if(p.res)send(p.res,playerView(p));}

function join(b){
  let p=P.get(b.id);
  if(!p){
    const name=String(b.name||'').trim().slice(0,16);
    if(!name)return{error:'Enter a name'};
    p=[...P.values()].find(q=>q.name.toLowerCase()===name.toLowerCase());
    if(p&&p.res)return{error:'That name is taken – pick another'};
    if(!p){
      if(P.size>=MAX_PLAYERS)return{error:'Game is full (30 players)'};
      p={id:crypto.randomBytes(6).toString('hex'),name,score:0,idx:nextIdx++,res:null};P.set(p.id,p);
    }
  }
  return{id:p.id,name:p.name};
}
function act(b){
  const ph=G.phase,live=LIVE.includes(ph);
  switch(b.action){
    case'start':{
      if(ph!=='lobby')return'Already started';
      const ids=[...P.values()].filter(p=>p.res).map(p=>p.id);
      if(ids.length<MIN_PLAYERS)return`Need at least ${MIN_PLAYERS} players`;
      G.per=Math.max(1,Math.min(5,+b.per||1));G.order=ids;G.total=ids.length*G.per;G.ri=0;
      for(const p of P.values())p.score=0;
      startRound();return;}
    case'ready':
      if(b.id!==G.giver||(ph!=='clue1'&&ph!=='clue2'))return'Not now';
      G.phase=ph==='clue1'?'guess1':'guess2';check();return;
    case'guess':{
      if(!['guess1','guess2'].includes(ph)||!G.parts.includes(b.id)||G.done.has(b.id))return'You can\'t guess right now';
      const m=/^([A-P])\s*(\d{1,2})$/i.exec(String(b.cell||'').trim());
      if(!m||+m[2]<1||+m[2]>COLS)return'Enter a letter A–P and a number 1–30, like G14';
      const r=LET.indexOf(m[1].toUpperCase()),c=+m[2]-1;
      if(G.guesses.some(x=>x.r===r&&x.c===c))return`${lbl(r,c)} is already taken – pick another cell`;
      G.guesses.push({pid:b.id,n:ph==='guess1'?1:2,r,c});G.done.add(b.id);check();return;}
    case'skip':if(live){G.parts=G.parts.filter(i=>i!==b.pid);check();}return;
    case'skipround':if(live)nextRound();return;
    case'next':if(ph==='reveal')nextRound();return;
    case'again':if(ph==='end'){for(const p of[...P.values()]){p.score=0;if(!p.res)P.delete(p.id);}G.phase='lobby';}return;
  }
}

http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname==='/events'){
    const isHost=u.searchParams.has('host'),p=P.get(u.searchParams.get('id'));
    if(!isHost&&!p){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});
    if(isHost)hosts.add(res);else p.res=res;
    req.on('close',()=>{
      if(isHost)hosts.delete(res);
      else if(p.res===res){p.res=null;if(G.phase==='lobby')P.delete(p.id);}
      broadcast();
    });
    return broadcast();
  }
  if(req.method==='POST'&&u.pathname==='/api'){
    let s='';req.on('data',d=>s+=d);
    req.on('end',()=>{
      let b={};try{b=JSON.parse(s)}catch{}
      const out=b.action==='join'?join(b):{error:act(b)};
      out.ok=!out.error;
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(out));
      broadcast();
    });
    return;
  }
  const f={'/':'player.html','/host':'host.html'}[u.pathname];
  if(!f){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(fs.readFileSync(path.join(__dirname,'public',f)));
}).listen(PORT,'0.0.0.0',()=>console.log(`\nHues & Cues running.\n  Host screen (laptop): http://localhost:${PORT}/host\n  Players join at:      http://${ip()}:${PORT}\n`));
setInterval(()=>{for(const h of hosts)h.write(':\n\n');for(const p of P.values())if(p.res)p.res.write(':\n\n');},15000);
