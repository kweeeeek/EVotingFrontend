// Netlify Function: ligtas na tulay ng mobile kiosk papunta sa EVoting API.
// Dito lang nakatago ang KIOSK_SECRET (Netlify env var); hindi ito nakikita ng browser.
// Apat na tawag lang ang pinapayagan: voter-verify, candidates, position-rules, votes.
// Ang candidates at position-rules ay pareho para sa lahat ng voter, kaya naka-cache sa memory.
const BASE=(process.env.API_BASE||'https://api.eballotsacdeco.site').replace(/\/+$/,'')+'/api/v1';
const TTL=Number(process.env.CACHE_SECONDS??60)*1000; // segundo ng cache (0 = patayin ang cache)
const STALE=10*60*1000;                               // kung bumagsak ang API, ibalik ang lumang kopya hanggang 10 minuto
const cache=new Map();                                // path -> {t, body}
let kTok=null,kExp=0;

async function kiosk(force){
  if(!force&&kTok&&Date.now()<kExp)return kTok;
  const r=await fetch(BASE+'/auth/kiosk-login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kioskId:process.env.KIOSK_ID||'MOBILE-KIOSK-01',deviceSecret:process.env.KIOSK_SECRET||''})});
  if(r.status===401)throw Object.assign(new Error('creds'),{creds:true});
  if(!r.ok)throw new Error('kiosk-login '+r.status);
  const j=await r.json();kTok=j.accessToken;kExp=Date.now()+(j.expiresIn-120)*1000;return kTok;
}
const out=(text,status,tag)=>new Response(text,{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...(tag?{'X-Cache':tag}:{})}});
const err=(m,s,d)=>out(JSON.stringify({error:m,detail:d}),s);

export default async req=>{
  const p=new URL(req.url).pathname.replace(/^\/api\/v1/,'');
  const voterTok=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  let body,useKiosk=false;
  if(req.method==='POST'&&p==='/auth/voter-verify'){
    const b=await req.json().catch(()=>({}));
    body={accountCode:String(b.accountCode??'').trim().slice(0,64)};useKiosk=true;
  }else if(req.method==='POST'&&p==='/votes'){
    body=await req.json().catch(()=>null);if(!body)return err('Bad request.',400);
  }else if(req.method==='GET'&&/^\/events\/\d+\/candidates$/.test(p)){
    if(!voterTok)return err('Unauthorized.',401); // voter token ang gagamitin sa API
  }else if(req.method==='GET'&&/^\/events\/\d+\/position-rules$/.test(p)){useKiosk=true;}
  else return err('Not found.',404);

  const get=req.method==='GET',hit=get&&cache.get(p);
  if(hit&&Date.now()-hit.t<TTL)return out(hit.body,200,'HIT');
  const stale=()=>hit&&Date.now()-hit.t<STALE?out(hit.body,200,'STALE'):null;
  const call=t=>fetch(BASE+p,{method:req.method,body:body?JSON.stringify(body):undefined,
    headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})}});
  try{
    let r=await call(useKiosk?await kiosk(false):voterTok);
    if(useKiosk&&r.status===401)r=await call(await kiosk(true));
    if(get&&r.ok){
      let text=await r.text();
      if(p.endsWith('/candidates'))text=JSON.stringify(JSON.parse(text).map(({photoBase64,...c})=>c)); // alisin ang mga larawan
      if(cache.size>50)cache.clear();
      cache.set(p,{t:Date.now(),body:text});
      return out(text,200,'MISS');
    }
    if(r.status>=500)return stale()||out(await r.text(),r.status);
    return out(await r.text(),r.status);
  }catch(e){
    const why=`${e.message||e}${e.cause?.code?' '+e.cause.code:''}`;
    console.error('proxy',req.method,p,why);
    return stale()||(e.creds?err('Kiosk credentials rejected.',401):err('API unreachable.',502,why));
  }
};
export const config={path:'/api/v1/*'};
