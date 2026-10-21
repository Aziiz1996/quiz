const http=require('node:http');const crypto=require('node:crypto');
const hits=new Map(),windowMs=900000;
function phoneValid(p){return typeof p==='string' && /^\+[1-9]\d{7,14}$/.test(p)}
function buildServer(env=process.env,send=fetch){
const origin=env.PUBLIC_ORIGIN||'https://aziiz1996.github.io';
return http.createServer(async(req,res)=>{
const accepted=req.headers.origin===origin;
function reply(status,body){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...(accepted?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})});res.end(JSON.stringify(body))}
if(req.url==='/health')return reply(200,{ok:true});
if(req.method==='OPTIONS'){if(!accepted)return reply(403,{error:'Forbidden'});res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end()}
if(!accepted)return reply(403,{error:'Forbidden'});
if(req.method!=='POST'||!['/api/verify/start','/api/verify/check'].includes(req.url))return reply(404,{error:'Not found'});
if(!env.TWILIO_ACCOUNT_SID||!env.TWILIO_AUTH_TOKEN||!env.TWILIO_VERIFY_SERVICE_SID)return reply(503,{error:'Not configured'});
try{
let raw='';for await(const c of req){raw+=c;if(raw.length>4096)return reply(413,{error:'Too large'})}
const {phone,code}=JSON.parse(raw),check=req.url.endsWith('/check');
if(!phoneValid(phone)||check&&!/^\d{4,10}$/.test(code||''))return reply(400,{error:'Invalid input'});
const key=crypto.createHash('sha256').update(req.socket.remoteAddress+req.url+phone).digest('hex'),now=Date.now();
let item=hits.get(key);if(!item||now-item.time>windowMs)item={time:now,n:0};
if(++item.n>(check?8:3))return reply(429,{error:'Too many attempts'});hits.set(key,item);
const route=check?'VerificationCheck':'Verifications',form=new URLSearchParams({To:phone,...(check?{Code:code}:{Channel:'sms'})});
const auth=Buffer.from(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN).toString('base64');
const response=await send('https://verify.twilio.com/v2/Services/'+encodeURIComponent(env.TWILIO_VERIFY_SERVICE_SID)+'/'+route,{method:'POST',headers:{Authorization:'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(10000)});
const result=await response.json();if(!response.ok)return reply(502,{error:'Provider rejected request'});
return reply(200,check?{verified:result.status==='approved'}:{status:'pending'});
}catch{return reply(400,{error:'Request failed'})}
})}
if(require.main===module)buildServer().listen(Number(process.env.PORT)||3000);
module.exports={buildServer,phoneValid};