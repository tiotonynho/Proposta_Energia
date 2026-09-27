const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Core=require('./contract-core');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function createServer({dataDir=path.join(__dirname,'.data'),password=process.env.SOLARPRO_ADMIN_PASSWORD,publicUrl=process.env.PUBLIC_URL}={}){
  fs.mkdirSync(dataDir,{recursive:true});
  if(!password){
    const file=path.join(dataDir,'admin-key.txt');
    if(!fs.existsSync(file))fs.writeFileSync(file,crypto.randomBytes(24).toString('base64url'),{mode:0o600});
    password=fs.readFileSync(file,'utf8').trim();
  }
  const db=new DatabaseSync(path.join(dataDir,'contracts.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, token TEXT UNIQUE, body TEXT NOT NULL)');
  const sessions=new Map(),attempts=new Map();
  const read=id=>{const row=db.prepare('SELECT body FROM records WHERE id=?').get(id);return row?JSON.parse(row.body):null;};
  const save=r=>db.prepare('UPDATE records SET body=? WHERE id=?').run(JSON.stringify(r),r.id);
  const fail=(message,status=400)=>Object.assign(new Error(message),{status});
  async function body(req){
    let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>500000)throw fail('Conteúdo muito grande.',413);}
    try{return JSON.parse(text||'{}');}catch{throw fail('JSON inválido.');}
  }
  const server=http.createServer(async(req,res)=>{
    const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    try{
      const url=new URL(req.url,'http://localhost'),route=url.pathname;
      if(req.method!=='GET'&&req.headers.origin){
        const expected=publicUrl?new URL(publicUrl).origin:'http://'+req.headers.host;
        if(req.headers.origin!==expected)throw fail('Origem não autorizada.',403);
      }
      if(route==='/api/login'&&req.method==='POST'){
        const ip=req.socket.remoteAddress,now=Date.now(),limit=attempts.get(ip)||{count:0,until:now+600000};
        if(limit.until<now){limit.count=0;limit.until=now+600000;}
        if(limit.count>=10)throw fail('Muitas tentativas. Aguarde 10 minutos.',429);
        const data=await body(req);
        if(!crypto.timingSafeEqual(Buffer.from(hash(String(data.password||''))),Buffer.from(hash(password)))){
          limit.count++;attempts.set(ip,limit);throw fail('Chave de acesso incorreta.',401);
        }
        attempts.delete(ip);
        const token=crypto.randomBytes(32).toString('base64url');sessions.set(token,now+8*3600000);
        res.setHeader('Set-Cookie',`solarpro=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${publicUrl?.startsWith('https:')?'; Secure':''}`);
        return reply(200,{ok:true});
      }
      if(route.startsWith('/api/public/')){
        const [,token,action]=route.match(/^\/api\/public\/([A-Za-z0-9_-]{43})(?:\/(accept|sign))?$/)||[];
        if(!token)throw fail('Link inválido.',404);
        const row=db.prepare('SELECT body FROM records WHERE token=?').get(hash(token));
        if(!row)throw fail('Link não encontrado.',404);
        let r=JSON.parse(row.body);
        if(r.expiresAt<Date.now()&&r.status==='pending')throw fail('Proposta expirada. Solicite um novo link.',410);
        if(req.method==='GET'&&!action){
          const p=r.proposal;
          return reply(200,{id:r.id,status:r.status,proposal:{clientName:p.clientName,address:p.address,city:p.city,state:p.state,installedKwp:p.installedKwp,annualGeneration:p.annualGeneration,investment:p.investment,annualSavings:p.annualSavings,equipment:Core.equipment(p)},contract:r.contract?{text:r.contract.text,revision:r.contract.revision,hash:r.contract.hash}:null,signature:r.signature||null,events:r.signature?r.audit:[]});
        }
        if(req.method!=='POST')throw fail('Método não permitido.',405);
        const data=await body(req);
        r=read(r.id);
        if(r.expiresAt<Date.now()&&r.status==='pending')throw fail('Proposta expirada. Solicite um novo link.',410);
        for(const key of ['name','document','email'])if(typeof data[key]!=='string'||!data[key].trim()||data[key].length>250)throw fail('Preencha nome, documento e e-mail.');
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw fail('E-mail inválido.');
        if(!/^(\d{11}|\d{14})$/.test(data.document.replace(/\D/g,'')))throw fail('Informe CPF com 11 dígitos ou CNPJ com 14 dígitos.');
        if(data.confirmed!==true)throw fail('Confirme sua concordância.');
        const now=new Date().toISOString();
        if(action==='accept'){
          if(r.status!=='pending')throw fail('Esta proposta já recebeu aceite.',409);
          if(r.proposal.document&&r.proposal.document.replace(/\D/g,'')!==data.document.replace(/\D/g,''))throw fail('O documento deve corresponder ao contratante da proposta.');
          const accepted=Core.accept(r.proposal,{name:data.name,document:data.document,email:data.email,date:now,channel:'Link da proposta',evidence:'Aceite eletrônico pelo link individual',confirmed:true},r.id);
          Object.assign(r,accepted);
          r.audit=[{event:'proposal.accepted',date:now,ip:req.socket.remoteAddress,agent:req.headers['user-agent']||'',proposalHash:hash(JSON.stringify(r.proposal))}];
          save(r);return reply(200,{ok:true});
        }
        if(action==='sign'){
          if(r.status!=='prepared'||!r.contract)throw fail('Contrato indisponível para assinatura.',409);
          if(data.hash!==r.contract.hash)throw fail('O contrato mudou. Recarregue e revise a nova versão.',409);
          if(data.document.replace(/\D/g,'')!==r.acceptance.document.replace(/\D/g,''))throw fail('Informe o documento usado no aceite da proposta.');
          r.signature={name:data.name,document:data.document,email:data.email,date:now,hash:r.contract.hash,method:'Assinatura eletrônica simples por link; identidade autodeclarada'};
          r.audit.push({event:'contract.signed',date:now,ip:req.socket.remoteAddress,agent:req.headers['user-agent']||'',hash:r.contract.hash});
          r.status='signed';save(r);return reply(200,{ok:true});
        }
        throw fail('Operação inválida.',404);
      }
      if(route.startsWith('/api/')){
        const cookie=(req.headers.cookie||'').match(/(?:^|;\s*)solarpro=([^;]+)/)?.[1];
        if(!cookie||!(sessions.get(cookie)>Date.now()))throw fail('Entre com a chave de acesso do servidor.',401);
        if(route==='/api/records'&&req.method==='GET')return reply(200,db.prepare('SELECT body FROM records ORDER BY rowid').all().map(row=>JSON.parse(row.body)));
        if(route==='/api/records'&&req.method==='POST'){
          const {proposal}=await body(req);
          Core.accept(proposal,{name:'Validação',document:'Validação',date:new Date().toISOString(),channel:'Validação',evidence:'Validação',confirmed:true},'validation');
          const token=crypto.randomBytes(32).toString('base64url'),id='PT-'+new Date().getFullYear()+'-'+crypto.randomBytes(5).toString('hex').toUpperCase();
          const r={id,proposal,status:'pending',acceptance:null,contract:null,expiresAt:Date.now()+3*86400000,publicPath:'/cliente.html#'+token};
          db.prepare('INSERT INTO records VALUES (?,?,?)').run(id,hash(token),JSON.stringify(r));return reply(201,r);
        }
        const match=route.match(/^\/api\/records\/([A-Z0-9-]+)\/contract$/);
        if(match&&req.method==='PUT'){
          const data=await body(req);
          const r=read(match[1]);if(!r)throw fail('Registro não encontrado.',404);
          if(!r.acceptance||r.status==='signed')throw fail('Contrato sem aceite ou já assinado. Alterações não permitidas.',409);
          if(typeof data.text!=='string'||!data.text.trim()||!data.details||data.reviewed!==true)throw fail('Revise o contrato antes de publicar.');
          if(data.previousRevision!==(r.contract?.revision||0))throw fail('Outra versão foi salva. Reabra o contrato.',409);
          r.history=[...(r.history||[]),...(r.contract?[r.contract]:[])];
          r.contract={text:data.text,details:data.details,revision:(r.contract?.revision||0)+1,savedAt:new Date().toISOString(),hash:hash(data.text)};
          r.status='prepared';save(r);return reply(200,r);
        }
        throw fail('Rota não encontrada.',404);
      }
      const files=['index.html','app.js','styles.css','theme-portico.css','contracts.css','contracts.js','contract-template.js','contract-core.js','cliente.html','cliente.js'];
      const file=route==='/'?'index.html':route.slice(1);
      if(req.method!=='GET'||!files.includes(file))throw fail('Não encontrado.',404);
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
      res.end(fs.readFileSync(path.join(__dirname,file)));
    }catch(error){reply(error.status||400,{error:error.status||error.message?.startsWith('Preencha')?error.message:'Não foi possível concluir a operação. Confira os dados e tente novamente.'});}
  });
  server.on('close',()=>db.close());return server;
}
if(require.main===module){
  const port=Number(process.env.PORT||8080),host=process.env.HOST||'127.0.0.1';
  createServer().listen(port,host,()=>console.log('SolarPro em http://'+host+':'+port+' · Chave administrativa em .data/admin-key.txt (ou SOLARPRO_ADMIN_PASSWORD).'));
}
module.exports={createServer};
