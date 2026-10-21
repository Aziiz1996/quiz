const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildServer,phoneValid}=require('../server/verify.cjs');
const env={PUBLIC_ORIGIN:'https://aziiz1996.github.io',TWILIO_ACCOUNT_SID:'ACtest',TWILIO_AUTH_TOKEN:'test',TWILIO_VERIFY_SERVICE_SID:'VAtest'};
async function run(task){const server=buildServer(env,async url=>({ok:true,json:async()=>({status:url.endsWith('VerificationCheck')?'approved':'pending'})}));await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await task('http://127.0.0.1:'+server.address().port)}finally{await new Promise(r=>server.close(r))}}
function req(body,origin=env.PUBLIC_ORIGIN){return {method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}}
test('phone numbers must be E164',()=>{assert.ok(phoneValid('+966512345678'));assert.ok(!phoneValid('0512345678'))});
test('disallow unknown origins',()=>run(async base=>assert.equal((await fetch(base+'/api/verify/start',req({phone:'+966512345678'},'https://invalid.example'))).status,403)));
test('start creates pending request',()=>run(async base=>assert.deepEqual(await (await fetch(base+'/api/verify/start',req({phone:'+966512345678'}))).json(),{status:'pending'})));
test('check confirms number but grants no access',()=>run(async base=>assert.deepEqual(await (await fetch(base+'/api/verify/check',req({phone:'+966512345678',code:'123456'}))).json(),{verified:true})));
test('bad code rejected',()=>run(async base=>assert.equal((await fetch(base+'/api/verify/check',req({phone:'+966512345678',code:'abc'}))).status,400)));