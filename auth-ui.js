(()=>{
  const api=SolarApi.createClient(),$=s=>document.querySelector(s);
  const node=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
  let current=null,needsSetup=false,setupAllowed=false,previousUser=null,rememberLogin=false;
  const gate=document.createElement('section');gate.id='authGate';gate.className='auth-gate';
  gate.innerHTML=`<div class="auth-card"><div class="brand"><span class="brand-mark">S</span><span>SolarPro</span></div><span class="section-kicker">ÁREA COMERCIAL</span><h1 id="authTitle">Conectando à plataforma</h1><p id="authDescription">Verificando seu acesso…</p>
    <form id="authForm" hidden><label id="authNameLabel" hidden>Seu nome<input name="name" autocomplete="name" maxlength="120"></label><label>E-mail<input name="email" type="email" autocomplete="username" required maxlength="254"></label><label>Senha<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><label id="authConfirmLabel" hidden>Confirme a senha<input name="confirm" type="password" autocomplete="new-password" maxlength="200"></label><label class="check-label" id="rememberLabel"><input type="checkbox" name="remember">Manter conectado por 30 dias</label><button class="primary" id="authSubmit">Entrar</button></form>
    <form id="firstPasswordForm" hidden><label>Senha provisória<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>Nova senha<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></label><label>Confirme a nova senha<input name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></label><button class="primary">Salvar senha e continuar</button></form>
    <p id="authMessage" role="status"></p><button class="ghost" id="authRetry" hidden>Tentar novamente</button><p class="field-help" id="passwordHelp">Esqueceu sua senha? Solicite uma senha provisória ao administrador.</p></div>`;
  document.body.append(gate);
  function lock(){
    document.body.classList.add('auth-locked');gate.hidden=false;
    $('main').inert=true;$('.sidebar').inert=true;
  }
  function unlock(){document.body.classList.remove('auth-locked');gate.hidden=true;$('main').inert=false;$('.sidebar').inert=false;}
  function displayLogin(){
    lock();$('#firstPasswordForm').hidden=true;
    $('#authTitle').textContent=needsSetup?'Configure sua equipe':'Bem-vindo ao SolarPro';
    $('#authDescription').textContent=needsSetup?'Crie a conta administradora. Depois, cadastre os vendedores pelo menu Equipe.':'Entre com seu e-mail e senha para acessar seus clientes e propostas.';
    $('#authForm').hidden=needsSetup&&!setupAllowed;
    $('#authNameLabel').hidden=!needsSetup;$('#authConfirmLabel').hidden=!needsSetup;
    const form=$('#authForm');form.elements.name.required=needsSetup;form.elements.confirm.required=needsSetup;
    form.elements.password.minLength=needsSetup?10:1;form.elements.password.autocomplete=needsSetup?'new-password':'current-password';
    $('#rememberLabel').hidden=needsSetup;$('#passwordHelp').hidden=needsSetup;
    $('#authSubmit').textContent=needsSetup?'Criar conta administradora':'Entrar';
    if(needsSetup&&!setupAllowed)$('#authMessage').textContent='A primeira conta deve ser criada pelo endereço local no computador do servidor, antes de publicar a plataforma.';
  }
  function authenticated(user){
    if(previousUser&&previousUser!==user.id){location.reload();return;}
    previousUser=user.id;current=user;window.SolarAuth.user=user;
    if(user.mustChangePassword){
      lock();$('#authForm').hidden=true;$('#firstPasswordForm').hidden=false;
      $('#authTitle').textContent='Escolha sua senha';$('#authDescription').textContent='Substitua a senha provisória antes de acessar a plataforma.';
      $('#authMessage').textContent='';$('#passwordHelp').hidden=true;return;
    }
    unlock();
    $('.sidebar-footer strong').textContent=user.name;
    $('.sidebar-footer small').textContent=user.role==='admin'?'Administrador':'Vendedor';
    $('.sidebar-footer .avatar').textContent=user.name.split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase();
    teamNav.hidden=user.role!=='admin';
    const settings=$('[data-view="settings"]');if(settings)settings.hidden=user.role!=='admin';
    window.dispatchEvent(new CustomEvent('authchanged',{detail:user}));
  }
  async function start(){
    lock();$('#authMessage').textContent='';$('#authRetry').hidden=true;
    try{
      const status=await api('auth/status');needsSetup=status.needsSetup;setupAllowed=status.setupAllowed;
      if(needsSetup){displayLogin();return;}
      try{authenticated((await api('auth/me')).user);}catch(error){if(error.status===401)displayLogin();else throw error;}
    }catch(error){$('#authForm').hidden=true;$('#authMessage').textContent=error.message;$('#authRetry').hidden=false;}
  }
  $('#authRetry').onclick=start;
  window.SolarAuth={user:null,requireLogin:()=>{if(!gate.hidden)return;displayLogin();$('#authMessage').textContent='Sua sessão terminou. Entre novamente para continuar.';}};
  window.addEventListener('authrequired',()=>window.SolarAuth.requireLogin());
  $('#authForm').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
    try{
      if(needsSetup&&form.elements.password.value!==form.elements.confirm.value)throw new Error('As senhas não conferem.');
      const data=Object.fromEntries(new FormData(form));data.remember=form.elements.remember.checked;
      rememberLogin=data.remember;
      const result=await api(needsSetup?'auth/setup':'login',{method:'POST',body:JSON.stringify(data)});
      form.reset();$('#authMessage').textContent='';authenticated(result.user);
    }catch(error){$('#authMessage').textContent=error.message;}finally{button.disabled=false;}
  };
  async function changePassword(form){
    if(form.elements.password.value!==form.elements.confirm.value)throw new Error('As senhas não conferem.');
    const result=await api('auth/password',{method:'POST',body:JSON.stringify({...Object.fromEntries(new FormData(form)),remember:rememberLogin})});
    form.reset();authenticated(result.user);
  }
  $('#firstPasswordForm').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
    try{await changePassword(form);}catch(error){$('#authMessage').textContent=error.message;}finally{button.disabled=false;}
  };
  const account=document.createElement('section');account.id='account';account.className='view';
  account.innerHTML=`<div class="panel"><h2>Minha conta</h2><p>Troque sua senha. As demais sessões serão encerradas.</p><form id="passwordForm" class="account-form"><label>Senha atual<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>Nova senha<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></label><label>Confirme a nova senha<input name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></label><button class="primary">Alterar senha</button></form><p id="accountMessage" role="status"></p><button class="ghost" id="logoutButton">Sair da conta</button></div>`;
  $('main').append(account);
  const accountNav=node('button','','nav-item');accountNav.dataset.view='account';accountNav.setAttribute('aria-label','Minha conta');
  accountNav.append(node('span','♙'),document.createTextNode(' Minha conta'));accountNav.onclick=()=>showView('account');$('.sidebar nav').append(accountNav);
  $('#passwordForm').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
    try{await changePassword(form);$('#accountMessage').textContent='Senha atualizada. Use a nova senha no próximo acesso.';}catch(error){$('#accountMessage').textContent=error.message;}finally{button.disabled=false;}
  };
  $('#logoutButton').onclick=async()=>{
    try{await api('logout',{method:'POST'});location.reload();}catch(error){$('#accountMessage').textContent=error.message;}
  };
  const team=document.createElement('section');team.id='team';team.className='view';
  team.innerHTML=`<div class="panel"><span class="section-kicker">ADMINISTRAÇÃO</span><h2>Equipe comercial</h2><p>Cadastre o acesso individual de cada pessoa. A senha provisória será trocada no primeiro login.</p><form id="userForm"><div class="form-grid"><label>Nome<input name="name" required maxlength="120" autocomplete="off"></label><label>E-mail<input name="email" type="email" required maxlength="254" autocomplete="off"></label><label>Perfil<select name="role"><option value="seller">Vendedor</option><option value="admin">Administrador</option></select></label><label>Senha provisória<input name="password" type="password" minlength="10" maxlength="200" required autocomplete="new-password"></label></div><button class="primary">Cadastrar acesso</button></form><p id="teamMessage" role="status"></p><div id="teamList"></div></div>`;
  $('main').append(team);
  const teamNav=node('button','','nav-item');teamNav.hidden=true;teamNav.dataset.view='team';teamNav.setAttribute('aria-label','Equipe');
  teamNav.append(node('span','♧'),document.createTextNode(' Equipe'));teamNav.onclick=()=>{showView('team');loadTeam();};$('.sidebar nav').append(teamNav);
  async function loadTeam(){
    try{
      const users=await api('users');$('#teamList').replaceChildren();
      for(const user of users){
        const row=node('div','','team-row'),info=node('div');info.append(node('strong',user.name),node('small',user.email+' · '+(user.role==='admin'?'Administrador':'Vendedor')+' · '+(user.active?'Ativo':'Desativado')));row.append(info);
        if(user.id!==current.id){
          const toggle=node('button',user.active?'Desativar acesso':'Reativar acesso','ghost');
          toggle.onclick=async()=>{toggle.disabled=true;try{await api('users/'+user.id,{method:'PATCH',body:JSON.stringify({active:!user.active})});await loadTeam();}catch(error){$('#teamMessage').textContent=error.message;toggle.disabled=false;}};row.append(toggle);
          const reset=document.createElement('form');reset.className='reset-password';
          const label=node('label','Nova senha provisória'),input=document.createElement('input');input.type='password';input.name='password';input.minLength=10;input.maxLength=200;input.required=true;input.autocomplete='new-password';label.append(input);
          const submit=node('button','Redefinir senha','ghost');reset.append(label,submit);
          reset.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{await api('users/'+user.id,{method:'PATCH',body:JSON.stringify({password:input.value})});reset.reset();$('#teamMessage').textContent='Senha provisória atualizada. Informe a nova senha ao usuário.';}catch(error){$('#teamMessage').textContent=error.message;}finally{submit.disabled=false;}};
          const expand=document.createElement('details');expand.append(node('summary','Redefinir senha'),reset);row.append(expand);
        }
        $('#teamList').append(row);
      }
    }catch(error){$('#teamMessage').textContent=error.message;}
  }
  $('#userForm').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
    try{await api('users',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.reset();$('#teamMessage').textContent='Acesso criado. Informe o endereço da plataforma e a senha provisória ao usuário.';await loadTeam();}
    catch(error){$('#teamMessage').textContent=error.message;}finally{button.disabled=false;}
  };
  start();
})();
