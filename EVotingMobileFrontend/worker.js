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

const out=(t,s,g)=>new Response(t,{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...(g?{'X-Cache':g}:{})}});
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
    if(res.status>=500) return stale()||out(await res.text(),res.status);
    return out(await res.text(),res.status)
  } catch(e2){
    const why=e2.message||e2+(e2.cause?.code?' '+e2.cause.code:'');
    return stale()||(e2.creds?err('Kiosk credentials rejected.',401):err('API unreachable.',502,why))
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
  headers.set('Cache-Control','public, max-age=3600');
  return new Response(r.body, {status:r.status, headers});
}

async function debugProxy(request, env){
  const url=new URL(request.url);
  const results={};
  for(const p of ['/','/index.html','/logo.webp','/bg.webp']){
    try{
      const r=await env.ASSETS.fetch(new Request(new URL(p, url.origin)));
      results[p]={status:r.status, type:r.headers.get('content-type'), len:r.headers.get('content-length')};
    }catch(e){results[p]={error:e.message};}
  }
  return new Response(JSON.stringify(results,null,2),{headers:{'Content-Type':'application/json'}});
}

export default{
  async fetch(request, env){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/v1')) return handleApi(request, env);
    if(url.pathname==='/__debug') return debugProxy(request, env);
    return proxyAssets(request, env);
  }
};
