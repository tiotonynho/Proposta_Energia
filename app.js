const months=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const monthlyHsp=[5.18,5.61,5.09,5.19,4.82,4.66,4.98,5.70,5.38,5.33,4.94,5.13];
const form=document.querySelector('#quoteForm');
const grid=document.querySelector('#consumptionGrid');
let currentStep=1;
let lastResult=null;

months.forEach((month,index)=>{grid.insertAdjacentHTML('beforeend',`<label>${month}<input class="consumption" type="number" min="0" step="1" value="400" aria-label="Consumo ${month}"></label>`)});

const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
const number=(value,digits=2)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);
const field=name=>form.elements[name];
const values=()=>Object.fromEntries(new FormData(form));

function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view'));
  document.querySelector(`#${id}`).classList.add('active-view');
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
  const titles={dashboard:'Visão geral',quote:'Novo orçamento',clients:'Clientes',settings:'Configurações',proposal:'Proposta gerada'};
  document.querySelector('#pageTitle').textContent=titles[id]||'SolarPro';
  window.scrollTo({top:0,behavior:'smooth'});
}

function updateAverage(){
  const list=[...document.querySelectorAll('.consumption')].map(i=>Number(i.value)||0);
  const avg=list.reduce((a,b)=>a+b,0)/12;
  const available=Number(field('connection').value)||0;
  document.querySelector('#averageConsumption').textContent=`${number(avg,0)} kWh`;
  document.querySelector('#compensableConsumption').textContent=`${number(Math.max(avg-available,0),0)} kWh`;
}

function setStep(step){
  currentStep=step;
  document.querySelectorAll('.step-panel').forEach(p=>p.classList.toggle('active',Number(p.dataset.step)===step));
  document.querySelectorAll('.step').forEach((s,i)=>s.classList.toggle('active',i<step));
  document.querySelector('#prevStep').classList.toggle('hidden',step===1);
  document.querySelector('#nextStep').textContent=step===3?'Gerar proposta →':'Continuar →';
}

function calculate(){
  const d=values();
  const consumption=[...document.querySelectorAll('.consumption')].map(i=>Number(i.value)||0);
  const average=consumption.reduce((a,b)=>a+b,0)/12;
  const availability=Number(d.connection);
  const targetMonthly=Math.max(average-availability,0);
  const hsp=Number(d.hsp);
  const performance=Number(d.performance);
  const modulePower=Number(d.modulePower);
  const requiredKwp=targetMonthly/(hsp*30.4*performance);
  const modules=Math.max(1,Math.ceil(requiredKwp*1000/modulePower));
  const installedKwp=modules*modulePower/1000;
  const generation=monthlyHsp.map(h=>h*30.4*performance*installedKwp);
  const annualGeneration=generation.reduce((a,b)=>a+b,0);
  const tariff=Number(d.tariff);
  const annualSavings=annualGeneration*tariff;
  const kitCost=Number(d.kitCost);
  const investment=kitCost*(1+Number(d.margin)+Number(d.installationRate)+Number(d.engineeringRate));
  const payback=investment/annualSavings;
  return {...d,consumption,average,targetMonthly,modules,installedKwp,generation,annualGeneration,annualSavings,investment,payback,area:modules*2.645};
}

function buildProposal(r){
  const date=new Intl.DateTimeFormat('pt-BR',{dateStyle:'long'}).format(new Date());
  const connection=field('connection').selectedOptions[0].textContent;
  document.querySelector('#pDate').textContent=date;
  document.querySelector('#pClientCover').textContent=r.clientName;
  document.querySelector('#pPowerCover').textContent=`${number(r.installedKwp)} kWp`;
  document.querySelector('#pSavingsCover').textContent=money(r.annualSavings);
  document.querySelector('#pClient').textContent=r.clientName;
  document.querySelector('#pAddress').textContent=`${r.address}, ${r.city}/${r.state}`;
  document.querySelector('#pInstallation').textContent=r.installation||'Não informada';
  document.querySelector('#pConnection').textContent=`Ligação ${connection.toLowerCase()}`;
  document.querySelector('#pPower').textContent=`${number(r.installedKwp)} kWp`;
  document.querySelector('#pModules').textContent=`${r.modules} × ${r.modulePower} W`;
  document.querySelector('#pGeneration').textContent=`${number(r.annualGeneration,0)} kWh`;
  document.querySelector('#pArea').textContent=`${number(r.area)} m²`;
  document.querySelector('#pMonthlyAverage').textContent=`${number(r.annualGeneration/12,0)} kWh/mês`;
  document.querySelector('#pInvestment').textContent=money(r.investment);
  document.querySelector('#pPayback').textContent=`${number(r.payback)} anos`;
  document.querySelector('#pAnnualSavings').textContent=money(r.annualSavings);
  document.querySelector('#pMonthlySavings').textContent=money(r.annualSavings/12);
  const max=Math.max(...r.generation);
  document.querySelector('#generationChart').innerHTML=r.generation.map((v,i)=>`<div class="bar-wrap" title="${months[i]}: ${number(v,0)} kWh"><div class="bar" style="height:${v/max*92}%"></div><span class="bar-label">${months[i]}</span></div>`).join('');
  document.querySelector('#pEquipment').innerHTML=[`${r.modules} módulos fotovoltaicos de ${r.modulePower} W`,`Microinversor compatível com ${number(r.installedKwp)} kWp`,'Projeto de engenharia e homologação','Estrutura de fixação completa','Proteções elétricas e conectores','Monitoramento de geração via Wi‑Fi'].map(x=>`<li>${x}</li>`).join('');
}

document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.view)));
document.querySelectorAll('#newQuoteTop,#heroNew,#panelNew,.openQuote').forEach(btn=>btn.addEventListener('click',()=>showView('quote')));
document.querySelectorAll('.consumption').forEach(i=>i.addEventListener('input',updateAverage));
field('connection').addEventListener('change',updateAverage);
document.querySelector('#prevStep').addEventListener('click',()=>setStep(Math.max(1,currentStep-1)));
document.querySelector('#nextStep').addEventListener('click',()=>{
  if(currentStep===1&&!form.reportValidity())return;
  if(currentStep<3){setStep(currentStep+1);return;}
  lastResult=calculate(); buildProposal(lastResult); showView('proposal');
});
document.querySelector('#editQuote').addEventListener('click',()=>{showView('quote');setStep(3)});
document.querySelector('#printProposal').addEventListener('click',()=>window.print());
updateAverage();
const preview=new URLSearchParams(location.search).get('preview');
if(preview==='quote')showView('quote');
if(preview==='proposal'){
  lastResult=calculate();
  buildProposal(lastResult);
  showView('proposal');
}
