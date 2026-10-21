/* Yakıt Defteri — istemci uygulaması */
(function(){
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- dil ---------- */
// Metinler Türkçe yazılır; İngilizce karşılıkları i18n.js içindeki YD_EN sözlüğündedir.
let LANG=store.get('yd-lang')==='en'?'en':'tr';
const EN=window.YD_EN||{}, TR=Object.fromEntries(Object.entries(EN).map(([k,v])=>[v,k]));
const t=(s,v)=>{let r=LANG==='en'&&EN[s]!=null?EN[s]:s; if(v) r=r.replace(/\{(\w+)\}/g,(m,k)=>v[k]??m); return r};
const MONTHS={tr:[['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'],['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık']],
  en:[['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],['January','February','March','April','May','June','July','August','September','October','November','December']]};
const nf=(d)=>new Intl.NumberFormat(LANG==='en'?'en-US':'tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d});
let f0,f1,f2,AY,AYU;
function setFormats(){f0=nf(0);f1=nf(1);f2=nf(2);[AY,AYU]=MONTHS[LANG]}
setFormats();
// Türkçede "1.234,56", İngilizcede "1,234.56"; tek ayraçlı "45,5" ve "45.5" iki dilde de ondalık sayılır
const parse=v=>{v=String(v??'').trim().replace(/\s/g,''); if(!v) return NaN;
  const th=LANG==='en'?',':'.', dc=LANG==='en'?'.':',';
  if(v.includes(th)&&v.includes(dc)) v=v.split(th).join('');
  else if(new RegExp('^\\d{1,3}(\\'+th+'\\d{3})+$').test(v)) v=v.split(th).join('');
  v=v.replace(',','.'); const n=parseFloat(v);return isFinite(n)?n:NaN};
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fmtDate=d=>LANG==='en'?`${AYU[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`:`${d.getDate()} ${AYU[d.getMonth()]} ${d.getFullYear()}`;
// Sayfadaki sabit metinleri seçili dile çevirir (asıl Türkçe metin TR sözlüğünden geri bulunur)
function translateDom(){
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n;
  while((n=w.nextNode())){
    const k=n.nodeValue.trim(); if(!k||n.parentElement.closest('script,style')) continue;
    const base=TR[k]??k, out=t(base); if(out!==k) n.nodeValue=n.nodeValue.replace(k,out);
  }
  $$('[placeholder],[aria-label]').forEach(el=>['placeholder','aria-label'].forEach(a=>{const v=el.getAttribute(a); if(v){const o=t(TR[v]??v); if(o!==v) el.setAttribute(a,o)}}));
  document.documentElement.lang=LANG; document.title=t('Yakıt Defteri');
  $$('[data-lang]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.lang===LANG));
}

const CFG=window.YAKIT_CONFIG||{};
const sb=(window.supabase&&CFG.supabaseUrl&&CFG.supabaseKey)?window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey):null;
const S={user:null,cars:[],car:null,recovering:false};
let fills=[];

/* ---------- hesaplar ---------- */
// Tüketim iki full dolum arasında hesaplanır; aradaki kısmi dolumların litresi de eklenir.
function enrich(arr){
  arr.sort((a,b)=>a.odo-b.odo||a.date-b.date);
  let lastFull=0,pL=0,pT=0;
  arr.forEach((f,i)=>{
    if(!(f.total>0)) f.total=+(f.liters*f.price).toFixed(2);
    f.km=i?f.odo-arr[i-1].odo:null; f.cons=null; f.tlkm=null; f.segKm=null;
    if(i===0) return;
    pL+=f.liters; pT+=f.total;
    if(f.full){const km=f.odo-arr[lastFull].odo; if(km>0) Object.assign(f,{segKm:km,segL:pL,segT:pT,cons:pL/km*100,tlkm:pT/km}); pL=0;pT=0;lastFull=i}
  });
  return arr;
}
function stats(list=fills){
  const rows=list.filter(f=>f.cons!=null);
  const km=rows.reduce((s,f)=>s+f.segKm,0), lt=rows.reduce((s,f)=>s+f.segL,0), tl=rows.reduce((s,f)=>s+f.segT,0);
  const months={};
  list.slice(1).forEach(f=>{const k=f.date.getFullYear()+'-'+f.date.getMonth();(months[k]??={y:f.date.getFullYear(),m:f.date.getMonth(),km:0,tl:0,lt:0});const M=months[k];M.km+=f.km;M.tl+=f.total;M.lt+=f.liters});
  return {avg:km?lt/km*100:0,tlkm:km?tl/km:0,rows,months:Object.values(months).sort((a,b)=>a.y-b.y||a.m-b.m),
    spend:list.reduce((s,f)=>s+f.total,0),liters:list.reduce((s,f)=>s+f.liters,0)};
}

/* ---------- grafikler ---------- */
function lineChart(vals,labels,{avg,dec=1,unit=''}={}){
  if(vals.length<2) return `<p class="muted" style="margin:6px 0">${t('Grafik için en az iki değer gerekiyor.')}</p>`;
  const W=340,H=150,L=34,R=12,T=14,B=22;
  const lo=Math.min(...vals,avg||Infinity),hi=Math.max(...vals,avg||-Infinity);
  const pad=(hi-lo)*0.15||1, y0=lo-pad, y1=hi+pad;
  const x=i=>L+(W-L-R)*(i/(vals.length-1)), y=v=>T+(H-T-B)*(1-(v-y0)/(y1-y0));
  let g='';
  for(let k=0;k<=3;k++){const v=y0+(y1-y0)*k/3;g+=`<line class="grid" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L-6}" y="${y(v)+3}" text-anchor="end">${nf(dec).format(v)}</text>`}
  const pts=vals.map((v,i)=>`${x(i)},${y(v)}`).join(' ');
  g+=`<polygon class="area" points="${x(0)},${H-B} ${pts} ${x(vals.length-1)},${H-B}"/>`;
  if(avg) g+=`<line class="avg" x1="${L}" x2="${W-R}" y1="${y(avg)}" y2="${y(avg)}"/><text x="${W-R}" y="${y(avg)-5}" text-anchor="end" style="fill:var(--accent)">${t('ort.')} ${nf(dec).format(avg)}</text>`;
  g+=`<polyline class="line" points="${pts}"/>`;
  vals.forEach((v,i)=>{ if(i<vals.length-1) g+=`<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="2.6"><title>${labels[i]}: ${nf(dec).format(v)}${unit}</title></circle>`});
  const li=vals.length-1; g+=`<circle class="end" cx="${x(li)}" cy="${y(vals[li])}" r="5"/><text class="lbl" x="${x(li)-8}" y="${y(vals[li])-9}" text-anchor="end">${nf(dec).format(vals[li])}</text>`;
  const step=Math.ceil(labels.length/5);
  labels.forEach((l,i)=>{if((i%step===0&&li-i>=step/2)||i===li) g+=`<text x="${x(i)}" y="${H-6}" text-anchor="middle">${l}</text>`});
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
function barChart(vals,labels,fmt){
  const W=340,H=160,L=8,R=8,T=20,B=22; const hi=Math.max(...vals)*1.1||1; const n=vals.length; const bw=(W-L-R)/Math.max(n,3);
  let g=`<line class="grid" x1="${L}" x2="${W-R}" y1="${H-B}" y2="${H-B}"/>`;
  vals.forEach((v,i)=>{const h=(H-T-B)*v/hi, x=L+i*bw+bw*0.18, w=bw*0.64;
    g+=`<rect class="bar${i===n-1?' cur':''}" x="${x}" y="${H-B-h}" width="${w}" height="${h}" rx="4"/><text class="lbl" x="${x+w/2}" y="${H-B-h-5}" text-anchor="middle">${fmt(v)}</text><text x="${x+w/2}" y="${H-6}" text-anchor="middle">${labels[i]}</text>`});
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
function gauge(val){
  const min=4,max=10, a0=-210,a1=30, fr=Math.max(0,Math.min(1,(val-min)/(max-min)));
  const pol=(a,r)=>[80+r*Math.cos(a*Math.PI/180),80+r*Math.sin(a*Math.PI/180)];
  const arc=(s,e,r)=>{const [x0,y0]=pol(s,r),[x1,y1]=pol(e,r);return `M${x0} ${y0} A${r} ${r} 0 ${e-s>180?1:0} 1 ${x1} ${y1}`};
  let ticks=''; for(let v=min;v<=max;v++){const a=a0+(a1-a0)*(v-min)/(max-min);const [x0,y0]=pol(a,58),[x1,y1]=pol(a,52);const [tx,ty]=pol(a,44);
    ticks+=`<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="var(--muted)" stroke-width="1.5"/>`+(v%2===0&&v>min&&v<max?`<text x="${tx}" y="${ty+3}" text-anchor="middle" fill="var(--muted)" font-family="var(--f-num)" font-size="9">${v}</text>`:'')}
  const ae=a0+(a1-a0)*fr; const [nx,ny]=pol(ae,62);
  return `<svg viewBox="0 0 160 140"><path d="${arc(a0,a1,66)}" stroke="var(--surface2)" stroke-width="9" fill="none" stroke-linecap="round"/><path d="${arc(a0,ae,66)}" stroke="var(--accent)" stroke-width="9" fill="none" stroke-linecap="round"/>${ticks}<circle cx="${nx}" cy="${ny}" r="5" fill="var(--fg)" stroke="var(--surface)" stroke-width="2"/></svg>
  <div class="read"><b>${f1.format(val)}</b><span>L / 100 km · ${t('ort.')}</span></div>`;
}

/* ---------- panel ---------- */
let monthMode='km';
function rowHTML(f,avg,i){
  const dd=f.date;
  const pill=i===0?`<span class="pill base">${t('Başlangıç')}</span>`:!f.full?`<span class="pill base">${t('Kısmi')}</span>`:f.cons==null?'':`<span class="pill ${f.cons<=avg?'good':'bad'}">${f1.format(f.cons)} L</span>`;
  return `<button class="row" data-edit="${esc(f.id)}" aria-label="${t('Kaydı düzenle')}"><div class="date"><b>${dd.getDate()}</b><small>${AY[dd.getMonth()]}</small></div>
  <div class="mid"><b>${f2.format(f.liters)} L · ${f2.format(f.price)} ₺/L</b><div class="num">${f0.format(f.odo)} km${f.km?` · +${f0.format(f.km)} km`:''}</div></div>
  <div class="right"><b>${f0.format(f.total)} ₺</b><div>${pill}</div></div></button>`;
}
function render(){
  if(!S.car) return;
  const now=new Date();
  $('#dashMonth').textContent=`${AYU[now.getMonth()]} ${now.getFullYear()}`;
  $('#dashTitle').textContent=S.car.name||t('Yakıt Defteri');
  $('#carBtn .plate').textContent=S.car.plate;
  $('#listPlate').textContent=S.car.plate+' · '+t('tüm dolumlar');
  const st=stats(); const rows=st.rows; const last=rows[rows.length-1];
  $('#dashEmpty').hidden=fills.length>0;
  $('#dashData').hidden=fills.length===0;
  $('#dashWait').hidden=!(fills.length>0&&!rows.length);
  $('#clusterBox').hidden=!rows.length; $('#consPanel').hidden=!rows.length;
  $('#pricePanel').hidden=fills.length<2; $('#monthPanel').hidden=!st.months.length;
  if(rows.length){
    $('#gauge').innerHTML=gauge(st.avg);
    $('#lastCons').textContent=f1.format(last.cons)+' L';
    const dv=last.cons-st.avg; const el=$('#lastDelta');
    if(rows.length>1){el.className='delta '+(dv>0?'up':'down'); el.textContent=(dv>0?'▲ ':'▼ ')+f1.format(Math.abs(dv))+' '+t('ortalamaya göre')} else el.textContent='';
    $('#tlkm').textContent=f2.format(st.tlkm)+' ₺';
    $('#tlkmSub').textContent=t('son depo')+' '+f2.format(last.tlkm)+' ₺';
    const cv=rows.map(f=>f.cons), cl=rows.map(f=>f.date.getDate()+' '+AY[f.date.getMonth()]);
    $('#consChart').innerHTML=lineChart(cv,cl,{avg:st.avg,unit:' L/100km'});
    $('#consRange').textContent=cv.length>1?t('en iyi {a} · en kötü {b}',{a:f1.format(Math.min(...cv)),b:f1.format(Math.max(...cv))}):'';
  }
  if(fills.length){
    const key=now.getFullYear()+'-'+now.getMonth();
    const cur=st.months.find(m=>m.y+'-'+m.m===key)||{km:0,tl:0};
    const pmD=new Date(now.getFullYear(),now.getMonth()-1,1); const pm=st.months.find(m=>m.y===pmD.getFullYear()&&m.m===pmD.getMonth());
    const total=fills[fills.length-1].odo-fills[0].odo;
    const partials=fills.filter((f,i)=>i&&!f.full).length;
    $('#tiles').innerHTML=[
      [t('Bu ay km'),f0.format(cur.km),pm?`${AYU[pm.m]}: ${f0.format(pm.km)} km`:''],
      [t('Bu ay harcama'),f0.format(cur.tl)+' ₺',pm?`${AYU[pm.m]}: ${f0.format(pm.tl)} ₺`:''],
      [t('Toplam yol'),f0.format(total)+' km',t('{n} dolum',{n:fills.length})+(partials?' · '+t('{n} kısmi',{n:partials}):'')],
      [t('Toplam harcama'),f0.format(st.spend)+' ₺',f0.format(st.liters)+' '+t('L yakıt')],
    ].map(([k,v,s])=>`<div class="tile"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join('');
    const pv=fills.map(f=>f.price), pl=fills.map(f=>f.date.getDate()+' '+AY[f.date.getMonth()]);
    $('#priceChart').innerHTML=lineChart(pv,pl,{dec:2,unit:' ₺'});
    $('#priceRange').textContent=fills.length>1?`${pv[pv.length-1]>=pv[0]?'+':''}${f1.format((pv[pv.length-1]/pv[0]-1)*100)}% ${t('ilk kayıttan beri')}`:'';
    renderMonth(st);
  }
  const rev=fills.map((f,i)=>[f,i]).reverse();
  $('#recent').innerHTML=rev.slice(0,4).map(([f,i])=>rowHTML(f,st.avg,i)).join('');
  $('#allList').innerHTML=rev.map(([f,i])=>rowHTML(f,st.avg,i)).join('');
  $('#allList').hidden=!fills.length; $('#listEmpty').hidden=!!fills.length;
  renderCar();
}
function renderMonth(st){
  st=st||stats();
  if(!st.months.length){$('#monthChart').innerHTML='';return}
  const v=st.months.slice(-6).map(m=>m[monthMode]), l=st.months.slice(-6).map(m=>AY[m.m]);
  const fmt=monthMode==='tl'?(x=>f1.format(x/1000)+'k'):(x=>f0.format(x));
  $('#monthChart').innerHTML=barChart(v,l,fmt)+`<div style="font-size:12px;color:var(--muted)">${monthMode==='tl'?t('₺ (bin)'):monthMode==='lt'?t('Litre'):'Km'} · ${t('son 6 ay, turuncu: son ay')}</div>`;
}
$$('#monthPanel .seg button').forEach(b=>b.addEventListener('click',()=>{$$('#monthPanel .seg button').forEach(x=>x.setAttribute('aria-pressed',x===b));monthMode=b.dataset.m;renderMonth()}));
function renderCar(){
  const c=S.car; if(!c) return;
  $('#carTitle').textContent=c.name||c.plate;
  const rows=[[t('Plaka'),esc(c.plate)],[t('Yakıt türü'),esc(t(c.fuel))],[t('Depo hacmi'),c.tank?c.tank+' L':'–']];
  if(fills.length){rows.push([t('Başlangıç km'),f0.format(fills[0].odo)+' km'],[t('İlk kayıt'),fmtDate(fills[0].date)])}
  $('#carInfo').innerHTML=rows.map(([k,v])=>`<div class="row"><div class="mid"><b>${k}</b></div><div class="right num">${v}</div></div>`).join('');
  $('#accEmail').textContent=S.user?.email||'';
}

/* ---------- gezinme ---------- */
function show(id,scrollTo){
  closeSheet();
  $$('.screen').forEach(s=>s.hidden=s.id!==id);
  $('#tabs').hidden=!['dash','list','add','car'].includes(id);
  $$('.tab').forEach(t=>{const on=t.dataset.go===id&&!t.dataset.scroll&&id!=='add'; on?t.setAttribute('aria-current','page'):t.removeAttribute('aria-current')});
  if(id==='add') resetAdd();
  if(scrollTo){const el=document.getElementById(scrollTo); if(el&&!el.hidden) el.scrollIntoView({behavior:'smooth',block:'center'})} else window.scrollTo(0,0);
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-go]'); if(b){e.preventDefault();show(b.dataset.go,b.dataset.scroll);return}
  const r=e.target.closest('[data-edit]'); if(r){openEdit(r.dataset.edit);return}
  const a=e.target.closest('[data-act]'); if(a){({export:doExport,cars:openCars,addcar:()=>openSetup(true),editcar:openEditCar})[a.dataset.act]?.()}
});
let tt; function toast(msg){let t=$('.toast'); if(!t){t=document.createElement('div');t.className='toast';t.setAttribute('role','status');document.body.appendChild(t)} t.textContent=msg;t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,2800)}
function dbErr(e){console.error(e);return navigator.onLine===false?t('İnternet bağlantısı yok. Bağlanınca tekrar dene.'):t('Kaydedilemedi. Tekrar dene.')}

/* ---------- alt panel ---------- */
function openSheet(html){$('#sheet').innerHTML=html;$('#sheetBg').hidden=false;document.body.style.overflow='hidden'}
function closeSheet(){$('#sheetBg').hidden=true;document.body.style.overflow=''}
$('#sheetBg').addEventListener('click',e=>{if(e.target.id==='sheetBg'||e.target.closest('[data-close]'))closeSheet()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet()});
const sheetHead=h=>`<div class="sheet-head"><h2>${h}</h2><button class="back" data-close aria-label="${t('Kapat')}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;

/* ---------- giriş / hesap ---------- */
let authMode='login';
function setAuthMode(m){
  authMode=m;
  $$('#authSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===m));
  $('#aPass2F').hidden=m!=='signup';
  $('#aPass').autocomplete=m==='signup'?'new-password':'current-password';
  $('#aBtn').textContent=t(m==='signup'?'Hesap oluştur':'Giriş yap');
  $('#aForgot').hidden=m!=='login';
  $('#aErr').hidden=true;$('#aInfo').hidden=true;$('#aInfo').className='infobox';
}
$$('#authSeg button').forEach(b=>b.addEventListener('click',()=>setAuthMode(b.dataset.mode)));
const aErr=m=>{$('#aErr').textContent=m;$('#aErr').hidden=false;$('#aInfo').hidden=true};
const aInfo=m=>{$('#aInfo').textContent=m;$('#aInfo').hidden=false;$('#aErr').hidden=true};
// Yeşil başarı kutusu: formu temizler, giriş sekmesine geçer
function aSuccess(title,text,email){
  setAuthMode('login');
  $('#aPass').value='';$('#aPass2').value='';$('#aEmail').value=email||'';
  const box=$('#aInfo'); box.className='okbox'; box.innerHTML=`<b>${esc(title)}</b>${esc(text)}`; box.hidden=false; $('#aErr').hidden=true;
  box.scrollIntoView({block:'nearest'});
}
function authMsg(e){
  const c=e?.code||'', m=(e?.message||'').toLowerCase();
  if(c==='invalid_credentials'||m.includes('invalid login')) return t('E-posta ya da şifre hatalı.');
  if(c==='email_not_confirmed'||m.includes('not confirmed')) return t('E-postanı henüz doğrulamadın. Gelen kutundaki linke tıkla.');
  if(c==='user_already_exists'||m.includes('already registered')) return t('Bu e-postayla bir hesap zaten var. Giriş yapmayı dene.');
  if(c==='weak_password'||m.includes('password')) return t('Şifre en az 8 karakter olmalı.');
  if(c==='over_email_send_rate_limit'||m.includes('rate limit')) return t('Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar dene.');
  if(c==='signup_disabled') return t('Yeni hesap açma şu an kapalı.');
  return t('Bir sorun oldu. Bağlantını kontrol edip tekrar dene.');
}
const redirectUrl=()=>location.origin+location.pathname;
$('#authForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const email=$('#aEmail').value.trim(), pass=$('#aPass').value;
  if(!/^\S+@\S+\.\S+$/.test(email)) return aErr(t('Geçerli bir e-posta yaz.'));
  if(pass.length<8) return aErr(t('Şifre en az 8 karakter olmalı.'));
  const btn=$('#aBtn'); btn.disabled=true;
  try{
    if(authMode==='signup'){
      if(pass!==$('#aPass2').value) return aErr(t('Şifreler aynı değil.'));
      const {data,error}=await sb.auth.signUp({email,password:pass,options:{emailRedirectTo:redirectUrl()}});
      if(error) throw error;
      // Supabase, kayıtlı bir e-posta için hata vermez; kimliksiz bir kullanıcı döndürür
      if(data.user&&Array.isArray(data.user.identities)&&data.user.identities.length===0){
        setAuthMode('login'); $('#aEmail').value=email;
        return aErr(t('Bu e-postayla zaten bir hesap var. Giriş yap ya da "Şifremi unuttum"a dokun.'));
      }
      if(!data.session) aSuccess(t('✓ Doğrulama e-postası gönderildi'),t('{email} adresine bir e-posta gönderdik. İçindeki "Confirm your mail" linkine tıkla, sonra buradan e-posta ve şifrenle giriş yap. E-posta birkaç dakika içinde gelmezse spam klasörüne bak.',{email}),email);
    } else {
      const {error}=await sb.auth.signInWithPassword({email,password:pass});
      if(error) throw error;
    }
  }catch(err){aErr(authMsg(err))}
  finally{btn.disabled=false}
});
$('#aForgot').addEventListener('click',async()=>{
  const email=$('#aEmail').value.trim();
  if(!/^\S+@\S+\.\S+$/.test(email)) return aErr(t('Önce e-postanı yaz, sonra "Şifremi unuttum"a dokun.'));
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:redirectUrl()});
  if(error) return aErr(authMsg(error));
  aSuccess(t('✓ Şifre yenileme e-postası gönderildi'),t('{email} adresine gelen linke tıkla ve yeni şifreni belirle. Gelmezse spam klasörüne bak.',{email}),email);
});
$('#npForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const a=$('#np1').value,b=$('#np2').value, er=m=>{$('#npErr').textContent=m;$('#npErr').hidden=false};
  if(a.length<8) return er(t('Şifre en az 8 karakter olmalı.'));
  if(a!==b) return er(t('Şifreler aynı değil.'));
  const {error}=await sb.auth.updateUser({password:a});
  if(error) return er(authMsg(error));
  S.recovering=false; toast(t('Şifren değişti')); startSession(S.user);
});
$('#logout').addEventListener('click',async()=>{await sb.auth.signOut();});

/* ---------- veri katmanı ---------- */
const toFill=x=>({id:x.id,date:new Date(x.date+'T12:00'),odo:+x.odo,liters:+x.liters,price:+x.price,total:+x.total,full:x.full_tank!==false});
async function loadCars(){
  const {data,error}=await sb.from('cars').select('*').order('created_at');
  if(error) throw error;
  S.cars=data;
}
async function loadFills(){
  const {data,error}=await sb.from('fills').select('*').eq('car_id',S.car.id).order('odo');
  if(error){toast(t('Kayıtlar yüklenemedi'));$('#syncPill').textContent=t('Bağlantı yok');$('#syncPill').className='pill bad';return}
  $('#syncPill').textContent=t('Bağlı');$('#syncPill').className='pill good';
  fills=enrich(data.map(toFill)); render();
}
async function selectCar(id){
  const c=S.cars.find(c=>c.id===id)||S.cars[0]; if(!c) return;
  if(S.car?.id!==c.id){fills=[];}
  S.car=c; store.set('yd-car',c.id); render();
  await loadFills();
}
async function startSession(user){
  S.user=user;
  if(S.recovering){show('newpass');return}
  $('#bootMsg').textContent=t('Kayıtların yükleniyor…'); show('boot');
  try{await loadCars()}catch(e){console.error(e);$('#bootMsg').textContent=t('Kayıtlar yüklenemedi. Sayfayı yenileyip tekrar dene.');return}
  if(!S.cars.length){openSetup(false);return}
  await selectCar(store.get('yd-car'));
  show('dash');
}

/* araç ekleme */
function openSetup(cancelable){
  $('#setupTitle').textContent=t(cancelable?'Yeni araç':'Aracını ekle');
  $('#cCancel').hidden=!cancelable; $('#carForm').reset(); $('#cErr').hidden=true;
  show('setup');
}
$('#cCancel').addEventListener('click',()=>show('car'));
$('#carForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const plate=$('#cPlate').value.trim().toLocaleUpperCase('tr-TR');
  if(!plate){$('#cErr').textContent=t('Plakayı yaz.');$('#cErr').hidden=false;return}
  const body={plate,name:$('#cName').value.trim()||null,fuel:$('#cFuel').value,tank:parse($('#cTank').value)||null};
  $('#cSave').disabled=true;
  try{
    const {data,error}=await sb.from('cars').insert(body).select().single(); if(error) throw error;
    S.cars.push(data); await selectCar(data.id); show('dash'); toast(t('Araç kaydedildi'));
  }catch(err){$('#cErr').textContent=dbErr(err);$('#cErr').hidden=false}
  finally{$('#cSave').disabled=false}
});

/* araç seç */
function openCars(){
  const st=stats();
  openSheet(sheetHead(t('Araçlarım'))+`<div class="list">`+S.cars.map(c=>
    `<button class="row carrow" data-car="${esc(c.id)}" aria-pressed="${c===S.car}"><span class="radio"></span>
    <div class="mid"><b>${esc(c.plate)}</b><div>${esc(c.name||'')}${c.name?' · ':''}${esc(t(c.fuel))}</div></div><div class="right">${c===S.car&&st.rows.length?`<b>${f1.format(st.avg)}</b><div style="font-size:11px;color:var(--muted)">L/100km</div>`:''}</div></button>`).join('')+`</div>
  <button class="btn ghost" data-act="addcar">+ ${t('Araç ekle')}</button>`);
  $$('[data-car]').forEach(b=>b.addEventListener('click',async()=>{closeSheet();show('dash');await selectCar(b.dataset.car);toast(t('{p} seçildi',{p:S.car.plate}))}));
}

/* araç düzenle / sil */
function openEditCar(){
  const c=S.car; if(!c) return;
  const fuels=['Benzin','Motorin','LPG','Hibrit'];
  openSheet(sheetHead(t('Aracı düzenle'))+`
  <div class="field"><label for="ecPlate">${t('Plaka')}</label><input id="ecPlate" value="${esc(c.plate)}" autocomplete="off" style="text-transform:uppercase"></div>
  <div class="field"><label for="ecName">${t('Araç adı (isteğe bağlı)')}</label><input id="ecName" value="${esc(c.name||'')}"></div>
  <div class="grid2">
    <div class="field"><label for="ecFuel">${t('Yakıt')}</label><select id="ecFuel">${fuels.map(f=>`<option value="${f}"${f===c.fuel?' selected':''}>${t(f)}</option>`).join('')}</select></div>
    <div class="field"><label for="ecTank">${t('Depo (L)')}</label><input class="num" id="ecTank" inputmode="numeric" value="${c.tank??''}"></div>
  </div>
  <p class="err" id="ecErr" hidden></p>
  <button class="btn" id="ecSave">${t('Kaydet')}</button>
  <button class="btn danger" id="ecDel">${t('Aracı sil')}</button>`);
  const err=m=>{$('#ecErr').textContent=m;$('#ecErr').hidden=false};
  $('#ecSave').addEventListener('click',async()=>{
    const plate=$('#ecPlate').value.trim().toLocaleUpperCase('tr-TR');
    if(!plate) return err(t('Plakayı yaz.'));
    const body={plate,name:$('#ecName').value.trim()||null,fuel:$('#ecFuel').value,tank:parse($('#ecTank').value)||null};
    $('#ecSave').disabled=true;
    const {data,error}=await sb.from('cars').update(body).eq('id',c.id).select().single();
    if(error){err(dbErr(error));$('#ecSave').disabled=false;return}
    Object.assign(c,data); closeSheet(); render(); toast(t('Araç bilgileri güncellendi'));
  });
  let armed=false;
  $('#ecDel').addEventListener('click',async()=>{
    if(!armed){armed=true;$('#ecDel').textContent=t('Emin misin? {n} kayıt da silinecek. Silmek için tekrar dokun',{n:fills.length});$('#ecDel').classList.add('armed');return}
    const {error}=await sb.from('cars').delete().eq('id',c.id);
    if(error) return err(dbErr(error));
    S.cars=S.cars.filter(x=>x.id!==c.id); S.car=null; fills=[]; closeSheet(); toast(t('Araç silindi'));
    if(!S.cars.length){openSetup(false);return}
    await selectCar(S.cars[0].id); show('dash');
  });
}

/* kayıt düzenle / sil */
function openEdit(id){
  const f=fills.find(x=>x.id===id); if(!f) return;
  openSheet(sheetHead(t('Kaydı düzenle'))+`
  <div class="grid2">
    <div class="field"><label for="eDate">${t('Tarih')}</label><input id="eDate" type="date" value="${iso(f.date)}"></div>
    <div class="field"><label for="eOdo">Km</label><input class="num" id="eOdo" inputmode="numeric" value="${f0.format(f.odo)}"></div>
    <div class="field"><label for="eLit">${t('Litre')}</label><input class="num" id="eLit" inputmode="decimal" value="${f2.format(f.liters)}"></div>
    <div class="field"><label for="ePrice">${t('TL / litre')}</label><input class="num" id="ePrice" inputmode="decimal" value="${f2.format(f.price)}"></div>
  </div>
  <div class="field"><label for="eTot">${t('Toplam TL')}</label><input class="num" id="eTot" inputmode="decimal" value="${f2.format(f.total)}"></div>
  <label class="check"><input type="checkbox" id="eFull" ${f.full?'checked':''}> ${t('Depoyu fulledim')}</label>
  <p class="err" id="eErr" hidden></p>
  <button class="btn" id="eSave">${t('Değişiklikleri kaydet')}</button>
  <button class="btn danger" id="eDel">${t('Kaydı sil')}</button>`);
  const err=m=>{$('#eErr').textContent=m;$('#eErr').hidden=false};
  $('#eSave').addEventListener('click',async()=>{
    const odo=Math.round(parse($('#eOdo').value)),l=parse($('#eLit').value),p=parse($('#ePrice').value),tot=parse($('#eTot').value);
    if(!(odo>=0)) return err(t('Km geçerli bir sayı olmalı.'));
    if(fills.some(x=>x!==f&&x.odo===odo)) return err(t('Bu km ile başka bir kayıt var.'));
    if(!(l>0&&p>0)) return err(t('Litre ve litre fiyatı sıfırdan büyük olmalı.'));
    $('#eSave').disabled=true;
    const {error}=await sb.from('fills').update({date:$('#eDate').value||iso(f.date),odo,liters:+l.toFixed(2),price:+p.toFixed(2),total:+(tot>0?tot:l*p).toFixed(2),full_tank:$('#eFull').checked}).eq('id',f.id);
    if(error){err(dbErr(error));$('#eSave').disabled=false;return}
    closeSheet();toast(t('Kayıt güncellendi'));loadFills();
  });
  let armed=false;
  $('#eDel').addEventListener('click',async()=>{
    if(!armed){armed=true;$('#eDel').textContent=t('Emin misin? Silmek için tekrar dokun');$('#eDel').classList.add('armed');return}
    const {error}=await sb.from('fills').delete().eq('id',f.id);
    if(error) return err(dbErr(error));
    closeSheet();toast(t('Kayıt silindi'));loadFills();
  });
}

/* dışa aktar */
function csv(){
  const head=t('Tarih;Km;Litre;TL/Litre;Toplam TL;Depo;L/100km;TL/km');
  return [head,...fills.map(f=>[iso(f.date),f.odo,f2.format(f.liters),f2.format(f.price),f2.format(f.total),f.full?t('Full'):t('Kısmi'),f.cons!=null?f2.format(f.cons):'',f.tlkm!=null?f2.format(f.tlkm):''].join(';'))].join('\r\n');
}
function doExport(){
  if(!fills.length) return toast(t('Dışa aktarılacak kayıt yok'));
  const name=`yakit-${S.car.plate.replace(/\s+/g,'')}-${iso(new Date())}.csv`;
  const url=URL.createObjectURL(new Blob(['﻿'+csv()],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}

/* ---------- fotoğraf okuma ---------- */
// Fotoğrafı küçültüp JPEG'e çevirir (iPhone HEIC dahil, tarayıcı açabiliyorsa)
async function toJpeg(file,maxSide=1600){
  try{
    const bmp=await createImageBitmap(file,{imageOrientation:'from-image'});
    const k=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
    const c=document.createElement('canvas');c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    return await new Promise(r=>c.toBlob(b=>r(b||file),'image/jpeg',0.85));
  }catch(e){return file}
}
const toB64=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=rej;r.readAsDataURL(blob)});

// 1. yol: sunucudaki okuma servisi (Gemini)
async function readOnServer(blob,kind){
  const {data,error}=await sb.functions.invoke('read-image',{body:{kind,mime:blob.type||'image/jpeg',image:await toB64(blob)}});
  if(error){let code='';try{code=(await error.context?.json?.())?.error}catch(e){} const er=new Error(code||'server');er.code=code;throw er}
  return data;
}
// 2. yol (yedek): telefonda okuma, sadece fiş için
let tessP=null;
function loadTesseract(){
  if(window.Tesseract) return Promise.resolve();
  return tessP??=new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)});
}
const num=s=>parse(String(s).replace(/[*\s]/g,''));
function parseReceiptText(text){
  const lines=text.toLocaleUpperCase('tr-TR').split(/\n/).map(l=>l.trim()).filter(Boolean);
  const out={price_per_liter:null,liters:null,total:null};
  const N='(\\d+(?:[.]\\d{3})*[,.]\\d{1,3})';
  for(const l of lines){
    let m=l.match(new RegExp(N+'\\s*(?:LT|L|LİTRE)\\s*[X×*]\\s*'+N));
    if(m){out.liters??=num(m[1]);out.price_per_liter??=num(m[2]);continue}
    if(/TOPKDV|KDV/.test(l)) continue;
    if(/TOPLAM|TUTAR/.test(l)&&(m=l.match(new RegExp(N+'(?!.*\\d)')))) {out.total=num(m[1]);continue}
    if(/B[İI]R[İI]M|F[İI]YAT|TL\/L/.test(l)&&(m=l.match(new RegExp(N)))) {out.price_per_liter??=num(m[1]);continue}
    if(/L[İI]TRE|M[İI]KTAR|\bLT\b/.test(l)&&(m=l.match(new RegExp(N)))) {out.liters??=num(m[1]);continue}
  }
  return out;
}
async function readOnDevice(blob,onStatus){
  onStatus(t('● Telefonda okunuyor, biraz sürebilir…'));
  await loadTesseract();
  const {data}=await window.Tesseract.recognize(blob,'tur');
  return parseReceiptText(data.text||'');
}
async function scan(file,box,kind){
  const url=URL.createObjectURL(file);
  box.hidden=false;
  box.innerHTML=`<div class="scanbox"><img src="${url}" alt="${t('Seçilen fotoğraf')}"><div class="scanline"></div></div><div style="margin-top:8px"><span class="ocr-badge busy">${t('● Okunuyor, birkaç saniye sürebilir…')}</span></div>`;
  const badge=(t,ok,warn)=>{const b=box.querySelector('.ocr-badge');b.className='ocr-badge'+(ok?'':' busy');b.style.color=warn?'var(--warn)':'';b.textContent=t};
  const done=()=>box.querySelector('.scanline')?.remove();
  const img=await toJpeg(file);
  try{const r=await readOnServer(img,kind);done();badge(t('✓ Okundu, değerleri kontrol et'),true);return r}
  catch(e){
    if(kind==='receipt'){
      try{const r=await readOnDevice(img,t=>badge(t,false));done();
        const n=['price_per_liter','liters','total'].filter(k=>r[k]>0).length;
        if(n){badge(t('✓ Telefonda okundu. Değerleri fişle mutlaka karşılaştır'),true);return r}
      }catch(e2){console.error(e2)}
    }
    done();
    badge(t(e.code==='daily_limit'?'Bugünkü okuma sınırına ulaştın. Değerleri elle gir.':'Fotoğraf okunamadı. Değerleri elle gir ya da başka fotoğraf dene.'),false,true);
    return null;
  }
}
function setVal(id,v,dec){if(v!=null&&isFinite(v)&&v>0){$('#'+id).value=nf(dec).format(v);$('#'+id).closest('.field').classList.add('ok');return true}return false}
$('#rcFile').addEventListener('change',async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  $('#rcCapture').hidden=true;
  const r=await scan(f,$('#rcScan'),'receipt');
  $('#rcCapture').hidden=false; $('#rcText').textContent=t('Okuma yanlışsa başka bir fotoğraf seçebilir ya da değerleri düzeltebilirsin.');
  if(!r) return;
  let p=+r.price_per_liter,l=+r.liters,t=+r.total;
  if(!(l>0)&&p>0&&t>0) l=t/p; if(!(t>0)&&p>0&&l>0) t=p*l; if(!(p>0)&&l>0&&t>0) p=t/l;
  setVal('price',p,2);setVal('liters',l,2);setVal('total',t,2);
  if(r.date&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)){const d=new Date(r.date+'T12:00');if(d<=new Date()&&d>new Date(Date.now()-60*864e5)) $('#date').value=r.date}
  validate1();
});
$('#odoFile').addEventListener('change',async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  const r=await scan(f,$('#odoScan'),'odometer');
  if(r&&setVal('odo',Math.round(+r.odometer_km),0)) validate2();
});

/* ---------- yeni kayıt akışı ---------- */
let curStep=1;
function setStep(n){curStep=n;['s1','s2','s3'].forEach((s,i)=>{const el=$('#'+s);el.hidden=i!==n-1;el.style.display=i===n-1?'flex':'none'});
  $$('.steps span').forEach((s,i)=>s.classList.toggle('on',i<n));
  $('#stepLbl').textContent=t('Adım {n} / 3',{n})+` · ${S.car?.plate||''}`; $('#stepTitle').textContent=t(['Yakıt fişi','Kilometre','Özet'][n-1]);
  if(n===3) buildSummary(); window.scrollTo(0,0)}
function resetAdd(){['price','liters','total','odo'].forEach(i=>$('#'+i).value='');$$('#add .field').forEach(f=>f.classList.remove('ok'));
  $('#rcScan').hidden=true;$('#odoScan').hidden=true;$('#rcCapture').hidden=false;$('#full').checked=true;$('#saveErr').hidden=true;
  $('#rcText').textContent=t('Litre fiyatı, litre ve toplam tutar fişten okunur. Kaydetmeden önce kontrol edebilirsin.');
  $('#date').value=iso(new Date()); validate1();validate2();setStep(1)}
function autoCalc(changed){
  const p=parse($('#price').value),l=parse($('#liters').value),t=parse($('#total').value);
  if(changed!=='total'&&p>0&&l>0) $('#total').value=f2.format(p*l);
  else if(changed==='total'&&p>0&&t>0) $('#liters').value=f2.format(t/p);
  validate1();
}
['price','liters','total'].forEach(id=>$('#'+id).addEventListener('input',()=>{$('#'+id).closest('.field').classList.remove('ok');autoCalc(id)}));
function validate1(){
  const p=parse($('#price').value),l=parse($('#liters').value),tot=parse($('#total').value);
  const ok=p>0&&l>0&&tot>0; $('#to2').disabled=!ok;
  const off=ok?Math.abs(p*l-tot)/tot:0;
  $('#mismatch').hidden=!(off>0.015);
  if(off>0.015) $('#mismatch').textContent=t('Litre fiyatı × litre = {a} ₺, ama toplam {b} ₺. Değerlerden biri yanlış okunmuş olabilir, fişle karşılaştır.',{a:f2.format(p*l),b:f2.format(tot)});
}
$('#to2').addEventListener('click',()=>setStep(2));
$('#back1').addEventListener('click',()=>setStep(1));
$('#back2').addEventListener('click',()=>setStep(2));
const lastOdo=()=>fills.length?fills[fills.length-1].odo:null;
$('#odo').addEventListener('input',()=>{$('#fOdo').classList.remove('ok');validate2()});
function validate2(){const v=parse($('#odo').value);const lo=lastOdo();const ok=v>0&&(lo==null||v>lo);
  $('#to3').disabled=!ok;
  const bad=v>0&&!ok;
  $('#odoHint').textContent=lo==null?t('İlk kayıt: aracın şu anki km değeri'):bad?t('Km son kayıttan ({n}) büyük olmalı',{n:f0.format(lo)}):t('Son kayıt: {n} km',{n:f0.format(lo)})+(ok?` · +${f0.format(v-lo)} km`:'');
  $('#odoHint').style.color=bad?'var(--warn)':''}
$('#to3').addEventListener('click',()=>setStep(3));

function draft(){const l=parse($('#liters').value),p=parse($('#price').value),t=parse($('#total').value);
  return {date:$('#date').value||iso(new Date()),odo:Math.round(parse($('#odo').value)),liters:+l.toFixed(2),price:+p.toFixed(2),total:+(t>0?t:l*p).toFixed(2),full:$('#full').checked}}
function buildSummary(){
  const d=draft(); const st=stats();
  const f={...d,id:'__new',date:new Date(d.date+'T12:00')};
  const sim=enrich([...fills.map(x=>({...x})),f]).find(x=>x.id==='__new');
  const set=(a,b,c,v)=>{$('#sumKm').textContent=a;$('#sumTlkm').textContent=b;$('#sumVs').textContent=c;$('#sumVs').style.color=v||''};
  if(!fills.length){
    $('#sumCons').textContent=t('Başlangıç kaydı'); set('–','–','–');
    $('#sumNote').hidden=false; $('#sumNote').textContent=t('Bu ilk kaydın. Bir sonraki full dolumda ilk tüketim hesabın çıkacak.');
  } else if(sim.cons!=null){
    $('#sumCons').textContent=f1.format(sim.cons)+' L / 100 km';
    const dv=sim.cons-st.avg;
    set(f0.format(sim.segKm)+' km',f2.format(sim.tlkm)+' ₺',st.rows.length?(dv>0?'+':'')+f1.format(dv)+' L':t('ilk ölçüm'),st.rows.length?(dv>0?'var(--warn)':'var(--good)'):'');
    const merged=sim.segKm!==sim.km;
    $('#sumNote').hidden=!merged; $('#sumNote').textContent=t('Arada kısmi dolum olduğu için tüketim son full dolumdan bu yana alınan tüm yakıtla hesaplandı.');
  } else {
    $('#sumCons').textContent=t('Kısmi dolum'); set(f0.format(d.odo-lastOdo())+' km','–','–');
    $('#sumNote').hidden=false; $('#sumNote').textContent=t('Depo fullenmediği için tüketim şimdi hesaplanmaz. Bir sonraki full dolumda bu litre de hesaba katılır.');
  }
  $('#sumGrid').innerHTML=[[t('Litre'),f2.format(d.liters)+' L'],[t('Litre fiyatı'),f2.format(d.price)+' ₺'],[t('Toplam'),f2.format(d.total)+' ₺'],['Km',f0.format(d.odo)]]
    .map(([k,v])=>`<div class="tile"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}
$('#save').addEventListener('click',async()=>{
  const b=$('#save'); b.disabled=true; $('#saveErr').hidden=true;
  const d=draft();
  const {error}=await sb.from('fills').insert({car_id:S.car.id,date:d.date,odo:d.odo,liters:d.liters,price:d.price,total:d.total,full_tank:d.full});
  b.disabled=false;
  if(error){$('#saveErr').textContent=dbErr(error);$('#saveErr').hidden=false;return}
  show('dash'); toast(t('Kaydedildi')); loadFills();
});

/* ---------- dil seçimi ---------- */
function setLang(l){
  if(l===LANG) return;
  LANG=l; store.set('yd-lang',l); setFormats(); closeSheet(); translateDom();
  $('#aBtn').textContent=t(authMode==='signup'?'Hesap oluştur':'Giriş yap');
  $('#setupTitle').textContent=t($('#cCancel').hidden?'Aracını ekle':'Yeni araç');
  if(S.car) render();
  if(!$('#add').hidden){$('#stepLbl').textContent=t('Adım {n} / 3',{n:curStep})+` · ${S.car?.plate||''}`;$('#stepTitle').textContent=t(['Yakıt fişi','Kilometre','Özet'][curStep-1]);validate1();validate2();if(curStep===3)buildSummary()}
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-lang]'); if(b) setLang(b.dataset.lang)});
translateDom();

/* ---------- başlat ---------- */
if(!sb){$('#bootMsg').textContent=t('Uygulama ayarları eksik. Kurulum tamamlanınca burası açılacak.');show('boot');return}
let started=null;
sb.auth.onAuthStateChange((event,session)=>{
  if(event==='PASSWORD_RECOVERY'){S.recovering=true;S.user=session?.user;show('newpass');return}
  const u=session?.user||null;
  if(!u){started=null;S.user=null;S.cars=[];S.car=null;fills=[];setAuthMode('login');show('auth');return}
  if(started===u.id) {S.user=u;return}
  started=u.id;
  setTimeout(()=>startSession(u),0); // Supabase: callback içinde başka istek beklemeyelim
});
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
