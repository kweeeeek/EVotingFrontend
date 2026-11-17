const TTL_DEFAULT=60, STALE=6e5;
const cache=new Map();
let kTok=null, kExp=0;

function getBase(e){
  return (e.API_BASE||'https://api.eballotsacdeco.site').replace(/\/+$/,'')+'/api/v1'
}

async function kiosk(e,f){
  if(!f&&kTok&&Date.now()<kExp) return kTok;
  const B=getBase(e);
  const r=await fetch(B+'/auth/kiosk-login',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kioskId:e.KIOSK_ID||'MOBILE-KIOSK-01', deviceSecret:e.KIOSK_SECRET||''})
  });
  if(r.status===401) throw Object.assign(new Error('creds'),{creds:true});
  if(!r.ok) throw new Error('kiosk-login '+r.status);
  const j=await r.json();
  kTok=j.accessToken;
  kExp=Date.now()+(j.expiresIn-120)*1e3;
  return kTok
}

// Security headers on every answer. camera=(self) because the page reads the Registration QR with the phone's camera.
const SEC={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
  'Permissions-Policy':'camera=(self), microphone=(), geolocation=(), payment=()','Cross-Origin-Opener-Policy':'same-origin'};
const out=(t,s,g)=>new Response(t,{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...SEC,...(g?{'X-Cache':g}:{})}});
// A server error is never relayed as-is: its body can carry internal details. The page only needs to know it should retry.
const upstreamFailed=()=>err('The server had a problem. Please try again.',502);
const err=(m,s,d)=>out(JSON.stringify({error:m,detail:d}),s);

async function handleApi(r,e){
  const B=getBase(e),
  TTL=Number(e.CACHE_SECONDS??TTL_DEFAULT)*1e3,
  p=new URL(r.url).pathname.replace(/^\/api\/v1/,''),
  vt=(r.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  let body, uk=false;
  if(r.method==='POST' && p==='/auth/voter-verify'){
    const b=await r.json().catch(()=>({}));
    body={accountCode:String(b.accountCode??'').trim().slice(0,64)};
    uk=true
  } else if(r.method==='POST' && p==='/votes'){
    body=await r.json().catch(()=>null);
    if(!body) return err('Bad request.',400)
  } else if(r.method==='GET' && /^\/events\/\d+\/candidates$/.test(p)){
    if(!vt) return err('Unauthorized.',401)
  } else if(r.method==='GET' && /^\/events\/\d+\/position-rules$/.test(p)){
    uk=true
  } else return err('Not found.',404);

  const get=r.method==='GET', hit=get && cache.get(p);
  if(hit && Date.now()-hit.t<TTL) return out(hit.body,200,'HIT');
  const stale=()=>hit && Date.now()-hit.t<STALE ? out(hit.body,200,'STALE') : null;
  const call=t=>fetch(B+p,{method:r.method, body:body?JSON.stringify(body):undefined, headers:{'Content-Type':'application/json', ...(t?{Authorization:'Bearer '+t}:{})}});

  try{
    let res=await call(uk ? await kiosk(e,false) : vt);
    if(uk && res.status===401) res=await call(await kiosk(e,true));
    if(get && res.ok){
      let text=await res.text();
      if(p.endsWith('/candidates')) text=JSON.stringify(JSON.parse(text).map(({photoBase64,...c})=>c));
      if(cache.size>50) cache.clear();
      cache.set(p,{t:Date.now(),body:text});
      return out(text,200,'MISS')
    }
    if(res.status>=500) return stale()||(res.status===503?err('The server is busy. Please try again.',503):upstreamFailed());
    return out(await res.text(),res.status)
  } catch(e2){
    // The reason (host names, socket errors) goes to the Worker log only, never to the browser.
    console.error('proxy', r.method, p, e2.message||String(e2), e2.cause?.code||'');
    return stale()||(e2.creds?err('Kiosk credentials rejected.',401):err('API unreachable.',502))
  }
}

async function proxyAssets(request, env){
  const url=new URL(request.url);
  let path=url.pathname;
  if(path==='/favicon.ico') path='/logo.webp';
  const assetUrl=new URL(path, url.origin);
  assetUrl.search=url.search;
  const r=await env.ASSETS.fetch(new Request(assetUrl, request));
  const headers=new Headers(r.headers);
  headers.set('Cache-Control', path==='/'||path.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
  for(const [k,v] of Object.entries(SEC)) headers.set(k,v);
  return new Response(r.body, {status:r.status, headers});
}

export default{
  async fetch(request, env){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/v1')) return handleApi(request, env);
    return proxyAssets(request, env);
  }
};
