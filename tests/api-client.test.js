const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createClient}=require('../api-client');
const response=(status,data,type='application/json')=>({status,ok:status>=200&&status<300,headers:{get:()=>type},json:async()=>data});
test('arquivo local informa como conectar sem tentar fetch',async()=>{
  let called=false;const api=createClient({protocol:()=> 'file:',fetchImpl:async()=>{called=true;}});
  await assert.rejects(api('records'),{code:'FILE_PROTOCOL'});assert.equal(called,false);
});
test('falha de rede não é apresentada como erro de login',async()=>{
  const api=createClient({protocol:()=> 'http:',fetchImpl:async()=>{throw new TypeError('NetworkError when attempting to fetch resource.');}});
  await assert.rejects(api('records'),error=>error.code==='NETWORK_ERROR'&&!error.message.includes('chave'));
});
test('servidor estático e sessão expirada possuem mensagens distintas',async()=>{
  const api=fetchImpl=>createClient({protocol:()=> 'http:',fetchImpl});
  await assert.rejects(api(async()=>response(404,null,'text/html'))('records'),{code:'API_UNAVAILABLE'});
  await assert.rejects(api(async()=>response(401,{error:'Entre'}))('records'),{code:'AUTH_REQUIRED'});
  await assert.rejects(api(async()=>response(401,{error:'Chave incorreta'}))('login',{method:'POST',body:'{}'}),{code:'INVALID_CREDENTIALS',status:401});
  await assert.rejects(api(async()=>response(409,{error:'Contrato já assinado'}))('records'),{code:'HTTP_ERROR',message:'Contrato já assinado'});
});
test('requisição com sessão e resposta JSON preserva dados',async()=>{
  const api=createClient({protocol:()=> 'http:',fetchImpl:async(url,options)=>{
    assert.equal(url,'/api/records');assert.equal(options.credentials,'same-origin');
    assert.equal(options.headers['Content-Type'],'application/json');
    return response(201,{id:'PT-TESTE'});
  }});
  assert.deepEqual(await api('records',{method:'POST',body:'{}'}),{id:'PT-TESTE'});
});
test('timeout cancela requisição e informa indisponibilidade',async()=>{
  const api=createClient({protocol:()=> 'http:',timeoutMs:5,fetchImpl:(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))))});
  await assert.rejects(api('records'),{code:'TIMEOUT'});
});
