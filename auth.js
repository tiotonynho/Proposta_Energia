const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const cleanUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,active:!!u.active,mustChangePassword:!!u.must_change_password});
async function passwordHash(password){
  if(typeof password!=='string'||password.length<10||password.length>200)throw fail('Use uma senha de 10 a 200 caracteres.');
  const salt=crypto.randomBytes(16).toString('hex');
  return salt+':'+Buffer.from(await scrypt(password,salt,64)).toString('hex');
}
async function verify(password,stored){
  const [salt,expected]=stored.split(':');
  const result=await scrypt(typeof password==='string'&&password.length<=200?password:'',salt,64);
  return crypto.timingSafeEqual(result,Buffer.from(expected,'hex'));
}
function createAuth(db,{publicUrl,body}){
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','seller')),active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);`);
  const attempts=new Map();
  const token=req=>(req.headers.cookie||'').match(/(?:^|;\s*)solarpro=([^;]+)/)?.[1];
  const getUser=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const configured=()=>db.prepare('SELECT count(*) AS n FROM users').get().n>0;
  function localSetup(req){
    return !publicUrl&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
      && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host||'');
  }
  function cookie(res,value,maxAge){
    res.setHeader('Set-Cookie',`solarpro=${value}; HttpOnly; SameSite=Strict; Path=/${maxAge!==undefined?'; Max-Age='+maxAge:''}${publicUrl?.startsWith('https:')?'; Secure':''}`);
  }
  function session(req,res,user,remember){
    const previous=token(req);if(previous)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(previous));
    const raw=crypto.randomBytes(32).toString('base64url'),seconds=remember?30*86400:8*3600;
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(raw),user.id,Date.now()+seconds*1000);
    cookie(res,raw,remember?seconds:undefined);
  }
  function requireUser(req,allowPasswordChange=false){
    const raw=token(req);
    const found=raw?db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(raw),Date.now()):null;
    const user=found?getUser(found.user_id):null;
    if(!user?.active)throw fail('Entre com seu e-mail e senha.',401);
    if(user.must_change_password&&!allowPasswordChange)throw fail('Altere sua senha provisória para continuar.',403);
    return user;
  }
  function throttle(req){
    const now=Date.now();
    for(const [key,item] of attempts)if(item.until<=now)attempts.delete(key);
    const ip=req.socket.remoteAddress,item=attempts.get(ip)||{count:0,until:now+600000};
    if(item.count>=10)throw fail('Muitas tentativas. Aguarde 10 minutos.',429);
    item.count++;attempts.set(ip,item);
  }
  function identity(data){
    const name=typeof data.name==='string'?data.name.trim():'';
    const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
    if(!name||name.length>120||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('Informe nome e e-mail válidos.');
    return {name,email};
  }
  async function handle(req,res,route,reply){
    if(route==='/api/auth/status'&&req.method==='GET'){
      reply(200,{needsSetup:!configured(),setupAllowed:localSetup(req)});return true;
    }
    if(route==='/api/auth/setup'&&req.method==='POST'){
      if(configured())throw fail('A conta inicial já foi configurada.',409);
      if(!localSetup(req))throw fail('A configuração inicial deve ser feita no computador do servidor, pelo endereço local, antes da publicação.',403);
      throttle(req);const data=await body(req),profile=identity(data),encoded=await passwordHash(data.password);
      db.exec('BEGIN IMMEDIATE');
      let user;
      try{
        if(configured())throw fail('A conta inicial já foi configurada.',409);
        const id=crypto.randomUUID();
        db.prepare('INSERT INTO users(id,name,email,password_hash,role) VALUES (?,?,?,?,?)').run(id,profile.name,profile.email,encoded,'admin');
        db.prepare('UPDATE records SET owner_id=? WHERE owner_id IS NULL').run(id);
        db.exec('COMMIT');user=getUser(id);
      }catch(error){db.exec('ROLLBACK');throw error;}
      session(req,res,user,false);reply(201,{user:cleanUser(user)});return true;
    }
    if(route==='/api/login'&&req.method==='POST'){
      throttle(req);const data=await body(req),email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
      let user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
      // Match the work factor even for an unknown email.
      const dummy='00000000000000000000000000000000:'+ '00'.repeat(64);
      const checkedHash=user?.password_hash||dummy;
      const valid=await verify(data.password,checkedHash);
      user=user?getUser(user.id):null;
      if(!valid||!user?.active||user.password_hash!==checkedHash)throw fail('E-mail ou senha incorretos.',401);
      // A password reset while verification was in flight must invalidate this login.
      attempts.delete(req.socket.remoteAddress);session(req,res,user,data.remember===true);
      reply(200,{user:cleanUser(user)});return true;
    }
    if(route==='/api/logout'&&req.method==='POST'){
      const raw=token(req);if(raw)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(raw));
      cookie(res,'',0);reply(200,{ok:true});return true;
    }
    if(route==='/api/auth/me'&&req.method==='GET'){
      reply(200,{user:cleanUser(requireUser(req,true))});return true;
    }
    if(route==='/api/auth/password'&&req.method==='POST'){
      const data=await body(req),user=requireUser(req,true);throttle(req);
      if(!await verify(data.currentPassword,user.password_hash))throw fail('Senha atual incorreta.',400);
      if(data.currentPassword===data.password)throw fail('Escolha uma senha diferente da atual.');
      const encoded=await passwordHash(data.password);
      requireUser(req,true);
      db.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?').run(encoded,user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      session(req,res,getUser(user.id),data.remember===true);attempts.delete(req.socket.remoteAddress);
      reply(200,{user:cleanUser(getUser(user.id))});return true;
    }
    if(route==='/api/users'||/^\/api\/users\/[^/]+$/.test(route)){
      const user=requireUser(req);if(user.role!=='admin')throw fail('Acesso exclusivo do administrador.',403);
      if(route==='/api/users'&&req.method==='GET'){reply(200,db.prepare('SELECT * FROM users ORDER BY name').all().map(cleanUser));return true;}
      if(route==='/api/users'&&req.method==='POST'){
        const data=await body(req),profile=identity(data),encoded=await passwordHash(data.password);
        requireUser(req);
        if(!['admin','seller'].includes(data.role))throw fail('Perfil inválido.');
        if(db.prepare('SELECT id FROM users WHERE email=?').get(profile.email))throw fail('Já existe uma conta com esse e-mail.',409);
        const id=crypto.randomUUID();
        db.prepare('INSERT INTO users(id,name,email,password_hash,role,must_change_password) VALUES (?,?,?,?,?,1)').run(id,profile.name,profile.email,encoded,data.role);
        reply(201,{user:cleanUser(getUser(id))});return true;
      }
      if(route!=='/api/users'&&req.method==='PATCH'){
        const data=await body(req),id=route.split('/').pop(),target=getUser(id);
        if(!target)throw fail('Usuário não encontrado.',404);
        if(id===user.id)throw fail('Use Minha conta para alterar sua senha. Não é possível desativar sua própria conta.');
        if(typeof data.active!=='boolean'&&typeof data.password!=='string')throw fail('Informe a alteração desejada.');
        const encoded=data.password!==undefined?await passwordHash(data.password):null;
        requireUser(req);
        if(encoded)db.prepare('UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?').run(encoded,id);
        if(typeof data.active==='boolean')db.prepare('UPDATE users SET active=? WHERE id=?').run(data.active?1:0,id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
        reply(200,{user:cleanUser(getUser(id))});return true;
      }
      throw fail('Método não permitido.',405);
    }
    return false;
  }
  return {handle,requireUser};
}
module.exports={createAuth};
