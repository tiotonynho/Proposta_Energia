(function(root){
  class ApiError extends Error{
    constructor(message,code,status=0){super(message);this.name='ApiError';this.code=code;this.status=status;}
  }
  function createClient({fetchImpl=(...args)=>fetch(...args),protocol=()=>location.protocol,timeoutMs=15000}={}){
    return async function request(path,options={}){
      if(!['http:','https:'].includes(protocol())){
        throw new ApiError('A plataforma foi aberta como arquivo. Para gerar links, abra o endereço do servidor SolarPro no navegador. Abrir o index.html diretamente não conecta os contratos.','FILE_PROTOCOL');
      }
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetchImpl('/api/'+path,{...options,credentials:'same-origin',signal:controller.signal,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
        if(!(response.headers.get('content-type')||'').includes('application/json')){
          throw new ApiError('Este endereço está servindo apenas os arquivos da plataforma, sem a API de contratos. Abra o endereço exibido ao iniciar o servidor SolarPro com node server.js.','API_UNAVAILABLE',response.status);
        }
        let data;
        try{data=await response.json();}catch(error){
          if(controller.signal.aborted)throw error;
          throw new ApiError('O servidor retornou uma resposta inválida. Tente novamente.','INVALID_RESPONSE',response.status);
        }
        if(!response.ok){
          if(response.status===401&&path==='login')throw new ApiError('E-mail ou senha incorretos. Confira seus dados e tente novamente.','INVALID_CREDENTIALS',401);
          if(response.status===401){
            if(typeof window!=='undefined'&&path!=='auth/me')window.dispatchEvent(new Event('authrequired'));
            throw new ApiError('Entre com seu e-mail e senha para continuar.','AUTH_REQUIRED',401);
          }
          throw new ApiError(typeof data?.error==='string'?data.error:'Não foi possível concluir a operação. Tente novamente.','HTTP_ERROR',response.status);
        }
        return data;
      }catch(error){
        if(error instanceof ApiError)throw error;
        throw new ApiError(controller.signal.aborted
          ?'O servidor demorou para responder. Verifique se ele está em execução e tente novamente.'
          :'Não foi possível conectar ao servidor de contratos. Confira sua conexão e se o servidor SolarPro está em execução no endereço aberto.',
        controller.signal.aborted?'TIMEOUT':'NETWORK_ERROR');
      }finally{clearTimeout(timer);}
    };
  }
  const api={ApiError,createClient};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SolarApi=api;
})(typeof window==='undefined'?globalThis:window);
