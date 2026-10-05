(function(){
'use strict';

const CONFIG=window.BOOK_CONFIG||{};
const SNAPSHOT=window.BOOK_SNAPSHOT||{};
const W=595,H=842,SCALE=3;
const C={navy:'#123f60',navy2:'#0b3554',teal:'#1492a4',tealLight:'#70d0d8',paper:'#f6f7f8',ink:'#123f60',body:'#405461',muted:'#667984',line:'#ccd8dd',gold:'#d4ad4d',coral:'#d8795e',white:'#ffffff',tag:'#e5f0f3'};
const flipbook=document.getElementById('flipbook');
const viewer=document.querySelector('.viewer');
const loading=document.getElementById('loading');
const loadingText=document.getElementById('loadingText');
const progress=document.getElementById('progress');
const current=document.getElementById('current');
const total=document.getElementById('total');
const dataMode=document.getElementById('dataMode');
const drawer=document.getElementById('drawer');
const drawerContents=document.getElementById('drawerContents');
const linkOverlay=document.getElementById('linkOverlay');
const crispOverlay=document.getElementById('crispOverlay');
const zoomValue=document.getElementById('zoomValue');
const FORCE_SNAPSHOT=new URLSearchParams(location.search).has('snapshot')||window.BOOK_FORCE_SNAPSHOT===true;
let pf=null,pages=[],pageUrls=[],hotspotsByIndex=[],keyToIndex=new Map(),currentIndex=0,visiblePageCount=0,fallbackIndex=0,fallback=null;
let zoomLevel=1;const minZoom=.60,maxZoom=1.30,zoomStep=.10;
const imageCache=new Map();

const norm=v=>String(v??'').trim();
const pad=(n,w=2)=>String(n).padStart(w,'0');
const published=r=>!norm(r.Status)||norm(r.Status).toLowerCase()==='published';
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const numberValue=v=>{const n=Number(v);return Number.isFinite(n)?n:9999};

function loadSheetOnce(sheetName,range,attempt=1){return new Promise((resolve,reject)=>{
  const cb=`__book_${sheetName}_${Date.now()}_${attempt}_${Math.floor(Math.random()*10000)}`;
  const script=document.createElement('script');
  const timeout=setTimeout(()=>{cleanup();reject(new Error(`${sheetName} timed out`));},8000);
  function cleanup(){clearTimeout(timeout);try{delete window[cb]}catch(_){window[cb]=undefined}script.remove()}
  window[cb]=response=>{try{
    if(!response||response.status==='error'||!response.table)throw new Error(response?.errors?.[0]?.detailed_message||`Could not read ${sheetName}`);
    const cols=response.table.cols.map((c,i)=>c.label||c.id||`Column${i+1}`);
    const rows=response.table.rows.map(row=>{const obj={};cols.forEach((col,i)=>{const cell=row.c?.[i];obj[col]=!cell?'':(cell.f!==undefined&&cell.f!==null?cell.f:(cell.v??''));});return obj;});
    cleanup();resolve(rows);
  }catch(err){cleanup();reject(err)}};
  const params=new URLSearchParams({sheet:sheetName,range,headers:'1',tqx:`out:json;responseHandler:${cb}`,_:String(Date.now())});
  script.src=`https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/gviz/tq?${params.toString()}`;
  script.onerror=()=>{cleanup();reject(new Error(`Could not connect to ${sheetName}`))};document.head.appendChild(script);
})}
async function loadSheet(sheetName,range){let lastErr;for(let attempt=1;attempt<=2;attempt++){try{return await loadSheetOnce(sheetName,range,attempt)}catch(err){lastErr=err;if(attempt<2)await new Promise(r=>setTimeout(r,350))}}throw lastErr}
async function getData(){
  const specs=[['PRESENTATIONS',CONFIG.sheets.PRESENTATIONS],['ABSTRACTS',CONFIG.sheets.ABSTRACTS],['SPEAKERS',CONFIG.sheets.SPEAKERS],['SPONSORS',CONFIG.sheets.SPONSORS]];
  if(FORCE_SNAPSHOT){dataMode.textContent='Snapshot';dataMode.classList.add('snapshot');return Object.fromEntries(specs.map(([n])=>[n,SNAPSHOT[n]||[]]))}
  const out={};let live=0;
  await Promise.all(specs.map(async([name,range])=>{try{out[name]=await loadSheet(name,range);live++}catch(err){console.warn(name,'using snapshot',err);out[name]=SNAPSHOT[name]||[]}}));
  dataMode.textContent=live===specs.length?'Live sheet':live?'Live + fallback':'Snapshot';dataMode.classList.toggle('snapshot',live!==specs.length);return out;
}

function cleanName(name){return norm(name).replace(/\^\d+(?:,\d+)*/g,'').replace(/\s+/g,' ').trim()}
function normalizePerson(name){return cleanName(name).toLowerCase().replace(/\b(prof|professor|dr|a\/prof|assoc|associate)\.?\b/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\b[a-z]\b/g,'').replace(/\s+/g,' ').trim()}
function samePerson(a,b){const x=normalizePerson(a),y=normalizePerson(b);if(!x||!y)return false;if(x===y||x.includes(y)||y.includes(x))return true;const xa=x.split(' '),ya=y.split(' ');return xa.length>1&&ya.length>1&&xa[0]===ya[0]&&xa.at(-1)===ya.at(-1)}
function initials(name){return cleanName(name).split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join('')||'SP'}
function sortAuthorKey(name){const n=cleanName(name).replace(/\b(Prof|Dr|A\/Prof)\.?\s*/gi,'');const bits=n.split(/\s+/);return `${bits.at(-1)||''}, ${bits.slice(0,-1).join(' ')}`.toLowerCase()}
function supDigits(s){const m={'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹',',':','};return String(s).split('').map(x=>m[x]||x).join('')}
function displayAuthor(part){const m=norm(part).match(/^(.*?)(?:\^([0-9,]+))?$/);return {name:norm(m?.[1]),text:`${norm(m?.[1])}${m?.[2]?supDigits(m[2]):''}`}}
function displayAffiliations(raw){return norm(raw).split(';').filter(Boolean).map(part=>{const s=part.trim();const m=s.match(/^([0-9,]+)\^(.*)$/);return m?`${supDigits(m[1])} ${m[2].trim()}`:s}).join('; ')}
function keywordList(raw){return norm(raw).split(/[,;]/).map(x=>x.trim()).filter(Boolean).slice(0,5)}
function formatTime(v){if(v===null||v===undefined||v==='')return '';if(typeof v==='string'&&/:/.test(v))return v.replace(/\s+/g,' ').trim();let n=Number(v);if(!Number.isFinite(n))return norm(v);if(n>1)n=n%1;let mins=Math.round(n*1440);if(mins>=1440)mins%=1440;return `${pad(Math.floor(mins/60))}:${pad(mins%60)}`}
function presentationMeta(pr,sp){const parts=norm(pr.Notes).split('·').map(x=>x.trim()).filter(Boolean);const day=parts.find(x=>/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i.test(x))||'';const venue=parts.find(x=>/Room|Ballroom|Theatre|Hall/i.test(x))||norm(sp?.PosterLocation)||(!day&&parts.length===1?parts[0]:'');return {day,time:formatTime(pr.StartTime)||formatTime(sp?.PosterTime),venue}}
function normalizePresentationId(v){return norm(v).toUpperCase().replace(/^PR0+/,'PR')}
const sponsorAliases={'sciex':['sciex'],'agilent':['agilent'],'bruker':['bruker'],'trajan':['trajan'],'national deuration facility':['ndf','ansto'],'national deuteration facility':['ndf','ansto'],'waters':['waters'],'avanti research':['avanti'],'thermo fisher scientific':['thermo fisher','thermo scientific']};
function sponsorLogo(s){const name=norm(s?.Name).toLowerCase();if(name.includes('thermo'))return 'assets/sponsors/thermo-fisher-approved.png';if(name.includes('nutrients'))return 'assets/sponsors/nutrients-approved.png';if(name.includes('metabolites'))return 'assets/sponsors/metabolites-v2.png';if(name.includes('business')||name.includes('perth'))return 'assets/sponsors/business-events-perth.png';return norm(s?.LogoURL)}
function findSponsorByName(sponsors,name){const q=norm(name).toLowerCase();return (sponsors||[]).find(s=>norm(s.Name).toLowerCase().includes(q))||null}
function sponsorFor(pr,a,sponsors){
  const ptype=norm(pr.PresentationType),aid=norm(pr.AbstractID)||norm(a?.AbstractID),pid=norm(pr.PresentationID).toUpperCase();
  // Oral sponsor marking is deliberately restricted to the actual Sponsor Talk.
  if(ptype==='Sponsor Talk'){
    const byAbstract=(sponsors||[]).find(x=>norm(x.AbstractID)&&norm(x.AbstractID)===aid);
    return byAbstract||findSponsorByName(sponsors,'sciex');
  }
  // Sponsor posters are explicitly mapped from PRESENTATIONS so ordinary abstracts are never mislabelled.
  if(ptype==='Poster'){
    const explicit={PR076:'agilent',PR077:'national deuration facility',PR078:'bruker',PR080:'trajan',PR081:'thermo fisher',PR082:'waters'};
    return explicit[pid]?findSponsorByName(sponsors,explicit[pid]):null;
  }
  return null
}
function syntheticSponsorAbstract(pr,sp){return {AbstractID:norm(pr.AbstractID),Title:norm(pr.Title)||norm(sp?.PosterTitle)||`${norm(sp?.Name)||'Sponsor'} poster presentation`,Authors:norm(pr.AuthorsDisplay)||norm(pr.SpeakerDisplay),Affiliations:norm(pr.AffiliationsDisplay),PresentingAuthor:norm(pr.SpeakerDisplay),AbstractText:norm(sp?.PosterAbstract),Keywords:'',Topic:''}}
function posterNumber(p){const n=Number(p.Sequence);return Number.isFinite(n)?n:''}
function chunk(arr,n){const out=[];for(let i=0;i<arr.length;i+=n)out.push(arr.slice(i,i+n));return out.length?out:[[]]}

function buildModel(data){
  const P=(data.PRESENTATIONS||[]).filter(published),Aall=(data.ABSTRACTS||[]),S=(data.SPEAKERS||[]),sponsors=(data.SPONSORS||[]).filter(x=>norm(x.Name));
  const amap=new Map(Aall.map(a=>[norm(a.AbstractID),a])),smap=new Map(S.map(s=>[norm(s.SpeakerID),s]));
  const oral=P.filter(p=>['Oral','Sponsor Talk'].includes(norm(p.PresentationType))).sort((a,b)=>{
    const at=norm(a.PresentationType)==='Sponsor Talk'?0:1,bt=norm(b.PresentationType)==='Sponsor Talk'?0:1;
    return at-bt||String(a.SessionID).localeCompare(String(b.SessionID))||numberValue(a.Sequence)-numberValue(b.Sequence);
  });
  let oralNo=0,sponsorNo=0;oral.forEach(p=>p._bookId=norm(p.PresentationType)==='Sponsor Talk'?`SP-${pad(++sponsorNo)}`:`O-${pad(++oralNo)}`);
  const rapid=P.filter(p=>norm(p.PresentationType)==='Flash Talk').sort((a,b)=>numberValue(a.Sequence)-numberValue(b.Sequence));
  const posters=P.filter(p=>norm(p.PresentationType)==='Poster'&&(norm(p.AbstractID)||norm(p.SpeakerDisplay)||norm(p.Title))).sort((a,b)=>numberValue(a.Sequence)-numberValue(b.Sequence));
  rapid.forEach((p,i)=>{p._bookId=`RF-${pad(i+1)}`;const match=posters.find(q=>norm(q.AbstractID)&&norm(q.AbstractID)===norm(p.AbstractID));p._posterNo=match?posterNumber(match):''});
  const rapidByAbstract=new Map(rapid.filter(p=>norm(p.AbstractID)).map(p=>[norm(p.AbstractID),p]));
  const posterUnique=posters.filter(p=>!norm(p.AbstractID)||!rapidByAbstract.has(norm(p.AbstractID)));
  const withdrawn=Aall.filter(a=>norm(a.Status).toLowerCase()==='withdrawn'&&/^PP-WD$/i.test(norm(a.SubmissionNumber)));
  const invited=P.filter(p=>['Plenary','Keynote'].includes(norm(p.PresentationType)));
  const model=[];const add=p=>model.push(p);
  add({key:'cover',kind:'static',src:'pages/page-01.png',title:'Cover'});
  add({key:'toc-main',kind:'toc-main',title:'Table of Contents'});
  add({key:'about',kind:'static',src:'pages/page-03.png',title:'About the Conference',patch:true});
  add({key:'committee',kind:'static',src:'pages/page-04.png',title:'Committee Members',patch:true});
  add({key:'sponsors',kind:'static',src:'pages/page-05.png',title:'Our Sponsors',patch:true});
  add({key:'divider-invited',kind:'static',src:'pages/page-06.png',title:'Plenary & Keynote Speakers',patch:true,dark:true});
  invited.forEach((p,i)=>add({key:`speaker-${norm(p.SpeakerID)||i}`,kind:'speaker',presentation:p,speaker:smap.get(norm(p.SpeakerID))||{},abstract:amap.get(norm(p.AbstractID))||{},title:norm(p.Title)||norm(p.PresentationType),footer:`${norm(p.PresentationType)} Speaker`}));
  add({key:'divider-oral',kind:'static',src:'pages/page-09.png',title:'Oral Presentations',patch:true,dark:true});
  const oralTocPages=chunk(oral,48);oralTocPages.forEach((list,i)=>add({key:`toc-oral-${i+1}`,kind:'toc-category',category:'oral',title:'Oral Presentations',entries:list.map(p=>({id:p._bookId,label:norm(p.Title),target:`oral-${norm(p.AbstractID)||norm(p.PresentationID)}`})),footer:'Oral Presentations'}));
  oral.forEach(p=>{const a=amap.get(norm(p.AbstractID))||{};add({key:`oral-${norm(p.AbstractID)||norm(p.PresentationID)}`,kind:'abstract',category:'oral',presentation:p,abstract:a,bookId:p._bookId,sponsor:sponsorFor(p,a,sponsors),footer:'Oral Presentations'})});
  add({key:'divider-rapid',kind:'static',src:'pages/page-12.png',title:'Lightning Talks',patch:true,dark:true});
  chunk(rapid,18).forEach((list,i)=>add({key:`toc-rapid-${i+1}`,kind:'toc-category',category:'rapid',title:'Rapid Fire',entries:list.map(p=>({id:`${p._bookId}${p._posterNo?` · Poster ${p._posterNo}`:''}`,label:norm(p.Title),target:`rapid-${norm(p.AbstractID)}`})),footer:'Lightning Talks'}));
  rapid.forEach(p=>{const a=amap.get(norm(p.AbstractID))||{};add({key:`rapid-${norm(p.AbstractID)}`,kind:'abstract',category:'rapid',presentation:p,abstract:a,bookId:p._bookId,posterNo:p._posterNo,sponsor:sponsorFor(p,a,sponsors),footer:'Lightning Talks'})});
  add({key:'divider-poster',kind:'static',src:'pages/page-14.png',title:'Poster Presentations',patch:true,dark:true});
  const posterEntries=[...posters.map(p=>{const rf=rapidByAbstract.get(norm(p.AbstractID)),a=amap.get(norm(p.AbstractID))||{},sp=sponsorFor(p,a,sponsors);return {id:`Poster ${posterNumber(p)}${rf?` · ${rf._bookId}`:''}`,label:norm(p.Title)||norm(sp?.PosterTitle)||norm(p.SpeakerDisplay)||norm(sp?.Name),target:rf?`rapid-${norm(p.AbstractID)}`:`poster-${norm(p.AbstractID)||norm(p.PresentationID)}`}}),...withdrawn.map(a=>({id:'Withdrawn',label:norm(a.Title),target:`poster-withdrawn-${norm(a.AbstractID)}`}))];
  chunk(posterEntries,19).forEach((list,i)=>add({key:`toc-poster-${i+1}`,kind:'toc-category',category:'poster',title:'Poster Presentations',entries:list,footer:'Poster Presentations'}));
  posterUnique.forEach(p=>{const sp=sponsorFor(p,amap.get(norm(p.AbstractID))||{},sponsors);let a=amap.get(norm(p.AbstractID))||{};if(!norm(a.AbstractID)&&sp)a=syntheticSponsorAbstract(p,sp);add({key:`poster-${norm(p.AbstractID)||norm(p.PresentationID)}`,kind:'abstract',category:'poster',presentation:p,abstract:a,bookId:`P-${pad(posterNumber(p))}`,posterNo:posterNumber(p),sponsor:sp,footer:'Poster Presentations'})});
  withdrawn.forEach(a=>{const pr={PresentationType:'Poster',Title:norm(a.Title),SpeakerDisplay:norm(a.PresentingAuthor)||norm(a.CorrespondingAuthor),AbstractID:norm(a.AbstractID),Status:'Withdrawn',Notes:'Withdrawn'};add({key:`poster-withdrawn-${norm(a.AbstractID)}`,kind:'abstract',category:'poster',presentation:pr,abstract:a,bookId:'Withdrawn',posterNo:'',withdrawn:true,footer:'Poster Presentations'})});
  const authorMap=new Map();
  function addAuthors(a,label,key,fallback=''){const lead=cleanName(norm(a?.PresentingAuthor)||norm(fallback));if(!lead)return;const k=normalizePerson(lead)||lead.toLowerCase();if(!authorMap.has(k))authorMap.set(k,{name:lead,refs:[]});const rec=authorMap.get(k);if(!rec.refs.some(r=>r.key===key&&r.label===label))rec.refs.push({label,key})}
  invited.forEach((p,i)=>addAuthors(amap.get(norm(p.AbstractID)),norm(p.PresentationType),`speaker-${norm(p.SpeakerID)||i}`,p.SpeakerDisplay));
  oral.forEach(p=>addAuthors(amap.get(norm(p.AbstractID)),p._bookId,`oral-${norm(p.AbstractID)||norm(p.PresentationID)}`,p.SpeakerDisplay));
  rapid.forEach(p=>addAuthors(amap.get(norm(p.AbstractID)),`${p._bookId}${p._posterNo?` · P${p._posterNo}`:''}`,`rapid-${norm(p.AbstractID)}`,p.SpeakerDisplay));
  posterUnique.forEach(p=>addAuthors(amap.get(norm(p.AbstractID)),`P${posterNumber(p)}`,`poster-${norm(p.AbstractID)||norm(p.PresentationID)}`,p.SpeakerDisplay));
  withdrawn.forEach(a=>addAuthors(a,'Withdrawn',`poster-withdrawn-${norm(a.AbstractID)}`,a.PresentingAuthor||a.CorrespondingAuthor));
  const authors=[...authorMap.values()].sort((a,b)=>sortAuthorKey(a.name).localeCompare(sortAuthorKey(b.name)));
  chunk(authors,64).forEach((list,i)=>add({key:`author-index-${i+1}`,kind:'author-index',authors:list,indexNo:i+1,indexTotal:Math.ceil(authors.length/64),title:'Author Index',footer:'Author Index'}));
  add({key:'thanks',kind:'static',src:'pages/page-17.png',title:'Thank you',patch:true,dark:true});
  model.filter(p=>!p.hidden).forEach((p,i)=>p.pageNo=i+1);
  const pmap=new Map(model.map((p,i)=>[p.key,{index:i,pageNo:p.pageNo||''}]));model.forEach(p=>p._map=pmap);
  const main=model.find(p=>p.key==='toc-main');
  main.entries=[{label:'About the Conference',target:'about'},{label:'Committee Members',target:'committee'},{label:'Our Sponsors',target:'sponsors'},{label:'Plenary & Keynote Speakers',target:'divider-invited',strong:true},...invited.map((p,i)=>({label:`${norm(p.PresentationType)} — ${norm(p.SpeakerDisplay)}`,target:`speaker-${norm(p.SpeakerID)||i}`,sub:true})),{label:'Oral Presentations',target:'divider-oral',strong:true},{label:'Rapid Fire',target:'divider-rapid',strong:true},{label:'Poster Presentations',target:'divider-poster',strong:true},{label:'Author Index',target:'author-index-1',strong:true}];
  return model;
}

function loadImage(src){const embedded=window.BOOK_ASSETS&&window.BOOK_ASSETS[src];const resolved=embedded||src;if(imageCache.has(resolved))return imageCache.get(resolved);const p=new Promise((resolve,reject)=>{const im=new Image();if(/^https?:/i.test(resolved))im.crossOrigin='anonymous';im.onload=()=>resolve(im);im.onerror=()=>reject(new Error(`Image failed: ${src}`));im.src=resolved});imageCache.set(resolved,p);return p}
const speakerPhotos={SP001:'assets/speakers/kerry-anne-rye.jpg',SP002:'assets/speakers/aleksandra-filipovska.png',SP003:'assets/speakers/hyungwon-choi.png',SP004:'assets/speakers/shane-ellis.jpg',SP005:'assets/speakers/laura-bindila.jpg',SP006:'assets/speakers/hiroshi-tsugawa.png',SP007:'assets/speakers/gerald-watts.png'};
function speakerPhotoPath(s){const sid=norm(s?.SpeakerID);if(speakerPhotos[sid])return speakerPhotos[sid];const name=normalizePerson(s?.DisplayName||'');if(name.includes('kerry anne rye'))return speakerPhotos.SP001;if(name.includes('aleksandra filipovska'))return speakerPhotos.SP002;if(name.includes('hyungwon choi'))return speakerPhotos.SP003;if(name.includes('shane ellis'))return speakerPhotos.SP004;if(name.includes('laura bindila'))return speakerPhotos.SP005;if(name.includes('hiroshi tsugawa'))return speakerPhotos.SP006;if(name.includes('gerald watts'))return speakerPhotos.SP007;return ''}
async function drawCirclePhoto(ctx,src,cx,cy,r){if(!src)return false;try{const im=await loadImage(src);ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.closePath();ctx.clip();const scale=Math.max((2*r)/im.width,(2*r)/im.height);const dw=im.width*scale,dh=im.height*scale;ctx.drawImage(im,cx-dw/2,cy-dh/2,dw,dh);ctx.restore();return true}catch(_){return false}}
function canvas(){const c=document.createElement('canvas');c.width=W*SCALE;c.height=H*SCALE;const ctx=c.getContext('2d');ctx.scale(SCALE,SCALE);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';return {c,ctx}}
function font(ctx,size,weight=400,family='Arial'){ctx.font=`${weight} ${size}px ${family}, sans-serif`}
function roundRect(ctx,x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke()}}
function wrapLines(ctx,text,maxWidth){const words=String(text||'').replace(/\s+/g,' ').trim().split(' ').filter(Boolean),lines=[];let line='';for(const word of words){const test=line?`${line} ${word}`:word;if(ctx.measureText(test).width<=maxWidth||!line)line=test;else{lines.push(line);line=word}}if(line)lines.push(line);return lines}
function fitLines(ctx,text,maxWidth,maxHeight,start,min,weight=700,lineFactor=1.05,maxLines=99){for(let s=start;s>=min;s-=.5){font(ctx,s,weight);const lines=wrapLines(ctx,text,maxWidth);const lh=s*lineFactor;if(lines.length<=maxLines&&lines.length*lh<=maxHeight)return {size:s,lines,lh}}font(ctx,min,weight);let lines=wrapLines(ctx,text,maxWidth).slice(0,maxLines);return {size:min,lines,lh:min*lineFactor}}
function drawLines(ctx,lines,x,y,lh,fill){ctx.fillStyle=fill;for(const line of lines){ctx.fillText(line,x,y);y+=lh}return y}
function footer(ctx,label,pageNo,dark=false){ctx.strokeStyle=dark?'#7793a5':C.line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(48,797);ctx.lineTo(548,797);ctx.stroke();font(ctx,10,700);ctx.fillStyle=dark?'#e6eff2':'#566d7c';ctx.fillText(label,48,819);font(ctx,13,900);ctx.fillStyle=dark?'#fff':C.navy2;const t=pad(pageNo);ctx.fillText(t,548-ctx.measureText(t).width,819)}
function patchStaticNumber(ctx,pageNo,dark=false){ctx.fillStyle=dark?C.navy2:'#f1f3f4';ctx.fillRect(515,800,52,36);font(ctx,13,900);ctx.fillStyle=dark?'#fff':C.navy2;const t=pad(pageNo);ctx.fillText(t,548-ctx.measureText(t).width,819)}
async function patchSponsorsPage(ctx){ return; }
function patchFrontMatterTitle(ctx,key){
  const bg='#f1f3f4', ink='#243d52';
  if(key==='cover'){
    ctx.fillStyle=bg;ctx.fillRect(44,174,320,194);
    drawKicker(ctx,'OFFICIAL CONFERENCE PUBLICATION',48,188);
    font(ctx,50,900,'Arial');ctx.fillStyle=ink;
    ctx.fillText('BOOK OF',48,258);ctx.fillText('ABSTRACTS',48,308);
    drawRule(ctx,48,337,C.teal,58);
  } else if(key==='about'){
    ctx.fillStyle=bg;ctx.fillRect(232,45,330,148);
    drawKicker(ctx,'ABOUT US',238,68);
    font(ctx,44,900,'Arial');ctx.fillStyle=ink;
    ctx.fillText('About the',238,126);ctx.fillText('Conference',238,165);
    drawRule(ctx,238,182,C.teal,58);
  } else if(key==='committee'){
    ctx.fillStyle=bg;ctx.fillRect(43,45,310,148);
    drawKicker(ctx,'PEOPLE BEHIND THE MEETING',48,68);
    font(ctx,44,900,'Arial');ctx.fillStyle=ink;
    ctx.fillText('Committee',48,126);ctx.fillText('Members',48,165);
    drawRule(ctx,48,182,C.teal,58);
  } else if(key==='sponsors'){
    ctx.fillStyle=bg;ctx.fillRect(43,45,510,118);
    drawKicker(ctx,'WITH THANKS TO',48,68);
    font(ctx,44,900,'Arial');ctx.fillStyle=ink;
    ctx.fillText('Our Sponsors',48,126);
    drawRule(ctx,48,145,C.teal,58);
  }
}
function patchDividerPage(ctx,key){
  const defs={
    'divider-invited':{kicker:'FEATURED SPEAKERS',title:['Plenary &','Keynote','Speakers'],accent:C.tealLight,desc:'Invited speakers are highlighted with a dedicated editorial profile before the contributed abstracts.'},
    'divider-oral':{kicker:'CONTRIBUTED ABSTRACTS',title:['Oral','Presentations'],accent:C.tealLight,desc:'Oral abstracts are presented in presentation-number order with compact clickable entries in the contents.'},
    'divider-rapid':{kicker:'CONTRIBUTED ABSTRACTS',title:['Lightning','Talks'],accent:C.tealLight,sub:'Rapid Fire',desc:'Abstracts from our ECRs who have just 3 minutes to present their research interests and win the audience vote.'},
    'divider-poster':{kicker:'POSTER ABSTRACTS',title:['Poster','Presentations'],accent:'#e98b69',desc:'Poster abstracts are presented in poster-number order for quick reference during the meeting.'}
  };
  const d=defs[key];if(!d)return;
  // Re-render the complete text block on the native 3x canvas. This keeps the
  // divider pages crisp while giving the description a reliable right margin.
  const x=268,right=548,w=right-x;
  ctx.fillStyle=C.navy2;ctx.fillRect(250,225,338,265);
  font(ctx,12,800);ctx.fillStyle=d.accent;ctx.fillText(d.kicker,x,252);
  font(ctx,31,900);ctx.fillStyle='#fff';let y=298;const lh=32;
  for(const line of d.title){ctx.fillText(line,x,y);y+=lh}
  // Deliberately leave more air below the title before the accent rule.
  const ruleY=y-17;roundRect(ctx,x,ruleY,58,5,3,d.accent);
  let bodyY=ruleY+35;
  if(d.sub){font(ctx,18,900);ctx.fillStyle='#fff';ctx.fillText(d.sub,x,bodyY);bodyY+=27}
  font(ctx,12,400);ctx.fillStyle='#dbe6eb';const lines=wrapLines(ctx,d.desc,w);for(const line of lines){ctx.fillText(line,x,bodyY);bodyY+=18}
}
async function renderStatic(p){const {c,ctx}=canvas(),im=await loadImage(p.src);ctx.drawImage(im,0,0,W,H);if(['cover','about','committee','sponsors'].includes(p.key))patchFrontMatterTitle(ctx,p.key);if(p.key==='sponsors')await patchSponsorsPage(ctx);if(p.key.startsWith('divider-'))patchDividerPage(ctx,p.key);if(p.patch&&p.pageNo)patchStaticNumber(ctx,p.pageNo,p.dark);return {canvas:c,hotspots:[]}}

function drawKicker(ctx,text,x,y){font(ctx,12,800);ctx.fillStyle=C.teal;ctx.letterSpacing='';ctx.fillText(text,x,y)}
function drawRule(ctx,x,y,color=C.teal,w=58){ctx.fillStyle=color;roundRect(ctx,x,y,w,5,3,color)}

function renderTocMain(p){const {c,ctx}=canvas(),hs=[];ctx.fillStyle='#f1f3f4';ctx.fillRect(0,0,W,H);ctx.fillStyle='#e4ebee';ctx.beginPath();ctx.arc(530,58,70,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(58,785,55,0,Math.PI*2);ctx.fill();drawKicker(ctx,'NAVIGATE THE PUBLICATION',48,68);font(ctx,44,900);ctx.fillStyle='#243d52';ctx.fillText('Table of',48,126);ctx.fillText('Contents',48,165);drawRule(ctx,48,182);
  roundRect(ctx,48,252,140,235,28,C.navy2);font(ctx,20,800);ctx.fillStyle='#fff';const ex='Explore';ctx.fillText(ex,118-ctx.measureText(ex).width/2,299);font(ctx,10,400);ctx.fillStyle='#dce9ed';const expl=wrapLines(ctx,'Jump straight to each section or abstract. Oral, Rapid Fire and Poster entries have their own clickable contents pages.',105);let ey=328;for(const line of expl){ctx.fillText(line,118-ctx.measureText(line).width/2,ey);ey+=15}
  let y=244;const x=214,numX=548;for(const e of p.entries){const m=p._map.get(e.target);const label=e.label;const sub=!!e.sub,strong=!!e.strong;font(ctx,sub?9:strong?12:13,strong?800:400);ctx.fillStyle=sub?'#6a7d89':'#2a3d4c';const lines=wrapLines(ctx,label,290);const lh=sub?11:15;const h=Math.max(26,lines.length*lh+8);let yy=y+15;for(const line of lines){ctx.fillText(line,x+(sub?10:0),yy);yy+=lh}font(ctx,13,800);ctx.fillStyle=C.teal;const pn=pad(m?.pageNo||'');ctx.fillText(pn,numX-ctx.measureText(pn).width,y+15);ctx.strokeStyle='#d8e1e5';ctx.beginPath();ctx.moveTo(x,y+h);ctx.lineTo(548,y+h);ctx.stroke();hs.push({x,y,w:334,h,target:e.target});y+=h+2;if(y>755)break}
  footer(ctx,'Table of Contents',p.pageNo);return {canvas:c,hotspots:hs}}
function renderTocCategory(p){const {c,ctx}=canvas(),hs=[];ctx.fillStyle='#f4f6f7';ctx.fillRect(0,0,W,H);drawKicker(ctx,'TABLE OF CONTENTS',48,68);font(ctx,40,900);ctx.fillStyle='#243d52';ctx.fillText(p.title,48,121);drawRule(ctx,48,138);font(ctx,10.5,400);ctx.fillStyle='#69808d';const note=p.category==='rapid'?'Each Rapid Fire entry also shows its linked poster number.':p.category==='poster'?'Poster entries are listed in poster-number order.':'Abstracts are listed in program order.';ctx.fillText(note,48,168);
  if(p.category==='oral'){
    // 42 oral entries fit on one page using two compact columns.
    const split=Math.ceil(p.entries.length/2),cols=[p.entries.slice(0,split),p.entries.slice(split)];
    for(let col=0;col<2;col++){let y=190;const x=48+col*255;for(const e of cols[col]){const m=p._map.get(e.target);font(ctx,8.4,800);ctx.fillStyle=C.teal;ctx.fillText(e.id,x,y+11);font(ctx,7.7,400);ctx.fillStyle='#334b5c';let lab=e.label;while(lab.length>14&&ctx.measureText(lab+'…').width>160)lab=lab.slice(0,-1);if(lab!==e.label)lab+='…';ctx.fillText(lab,x+43,y+11);font(ctx,8.4,800);ctx.fillStyle='#6c8492';const pn=pad(m?.pageNo||'');ctx.fillText(pn,x+236-ctx.measureText(pn).width,y+11);ctx.strokeStyle='#dde5e8';ctx.beginPath();ctx.moveTo(x,y+20);ctx.lineTo(x+238,y+20);ctx.stroke();hs.push({x,y,w:238,h:20,target:e.target});y+=26}}
  } else {
    // Rapid Fire and Poster contents use one column so IDs never collide with titles.
    let y=190;const x=48;for(const e of p.entries){const m=p._map.get(e.target);font(ctx,8.7,800);ctx.fillStyle=C.teal;ctx.fillText(e.id,x,y+12);font(ctx,8.2,400);ctx.fillStyle='#334b5c';const lines=wrapLines(ctx,e.label,365).slice(0,2);let yy=y+12;for(const line of lines){ctx.fillText(line,x+105,yy);yy+=10.6}font(ctx,8.7,800);ctx.fillStyle='#6c8492';const pn=pad(m?.pageNo||'');ctx.fillText(pn,548-ctx.measureText(pn).width,y+12);const rowH=Math.max(22,lines.length*10.6+5);ctx.strokeStyle='#dde5e8';ctx.beginPath();ctx.moveTo(x,y+rowH);ctx.lineTo(548,y+rowH);ctx.stroke();hs.push({x,y,w:500,h:rowH,target:e.target});y+=rowH+(p.category==='poster'?3:6)}
  }
  footer(ctx,p.footer,p.pageNo);return {canvas:c,hotspots:hs}}

function drawAuthorLine(ctx,raw,presenter,x,y,maxWidth,fontSize=8.3,maxLines=2){const parts=norm(raw).split(';').filter(Boolean);function lineCount(size){font(ctx,size,600);let cx=0,lines=1;for(let i=0;i<parts.length;i++){const a=displayAuthor(parts[i]),text=(i?'; ':'')+a.text;for(const ch of text.split(' ')){const token=(cx===0?'':' ')+ch;const tw=ctx.measureText(token).width;if(cx+tw>maxWidth&&cx>0){lines++;cx=0}cx+=ctx.measureText((cx===0?'':' ')+ch).width}}return lines}let size=fontSize;while(size>5.5&&lineCount(size)>maxLines)size-=.3;font(ctx,size,600);ctx.fillStyle='#344a59';let cx=x,cy=y,lh=size*1.45,line=1;for(let i=0;i<parts.length;i++){const a=displayAuthor(parts[i]),text=(i?'; ':'')+a.text;for(const ch of text.split(' ')){let token=(cx===x?'':' ')+ch;if(cx+ctx.measureText(token).width>x+maxWidth&&cx>x){if(line>=maxLines)return cy;cx=x;cy+=lh;line++;token=ch}const sx=cx;ctx.fillText(token,cx,cy);cx+=ctx.measureText(token).width;if(samePerson(a.name,presenter)&&ch.trim()){ctx.strokeStyle='#344a59';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(sx,cy+2);ctx.lineTo(cx,cy+2);ctx.stroke()}}}return cy}
function parseAbstract(text){let s=norm(text).replace(/\r/g,'');if(!s)return [{type:'p',text:'No abstract text supplied.'}];const heads='Background|Introduction|Objective|Objectives|Aim|Aims|Methods|Method|Results|Result|Conclusion|Conclusions|Discussion';s=s.replace(new RegExp(`(^|\\n\\n|\\n)\\s*(${heads})\\s*[:\\n]`,'gi'),(_,pre,h)=>`${pre}@@H@@${h}@@/H@@`);const paras=s.split(/\n\s*\n/).filter(Boolean);const out=[];for(const p of paras){const m=p.match(/^@@H@@(.*?)@@\/H@@([\s\S]*)$/);if(m){out.push({type:'h',text:m[1]});if(norm(m[2]))out.push({type:'p',text:norm(m[2])})}else out.push({type:'p',text:p.replace(/\n+/g,' ')})}return out}
function measureAbstract(ctx,blocks,size,width){let h=0;for(const b of blocks){if(b.type==='h'){h+=size*1.6}else{font(ctx,size,400);const lines=wrapLines(ctx,b.text,width);h+=lines.length*size*1.42+size*.75}}return h}
function drawAbstractBody(ctx,text,x,y,w,h,accent){
  const blocks=parseAbstract(text);let size=10.8;
  while(size>8.4&&measureAbstract(ctx,blocks,size,w)>h)size-=.2;
  for(const b of blocks){
    if(b.type==='h'){font(ctx,size,800);ctx.fillStyle=accent;ctx.fillText(b.text.toUpperCase(),x,y+size);y+=size*1.52}
    else{font(ctx,size,400);ctx.fillStyle=C.body;const lines=wrapLines(ctx,b.text,w);const lh=size*1.34;for(const line of lines){ctx.fillText(line,x,y+size);y+=lh}y+=size*.58}
  }
}
async function drawSponsorMark(ctx,sp,x,y,w,h){if(!sp)return;roundRect(ctx,x,y,w,h,11,'#fff');const src=sponsorLogo(sp);if(src){try{const im=await loadImage(src);const scale=Math.min((w-12)/im.width,(h-24)/im.height,1.6);const dw=im.width*scale,dh=im.height*scale;ctx.drawImage(im,x+(w-dw)/2,y+5,dw,dh)}catch(_){}}font(ctx,6.4,800);ctx.fillStyle=C.navy;let label=norm(sp.Name);if(ctx.measureText(label).width>w-8){while(label.length>5&&ctx.measureText(label+'…').width>w-8)label=label.slice(0,-1);label+='…'}ctx.fillText(label,x+(w-ctx.measureText(label).width)/2,y+h-6)}
async function renderAbstract(p){
  const {c,ctx}=canvas();ctx.fillStyle=C.paper;ctx.fillRect(0,0,W,H);
  const a=p.abstract||{},pr=p.presentation||{},sp=p.sponsor||null;
  const title=norm(a.Title)||norm(pr.Title)||'Untitled abstract';
  const presenter=cleanName(norm(a.PresentingAuthor)||norm(pr.SpeakerDisplay));
  const accent=p.category==='rapid'?C.gold:p.category==='poster'?C.coral:C.teal;
  const typeLabel=p.withdrawn?'POSTER PRESENTATION':norm(pr.PresentationType)==='Sponsor Talk'?'SPONSOR TALK':p.category==='rapid'?'RAPID FIRE':p.category==='poster'?'POSTER PRESENTATION':'ORAL PRESENTATION';
  const topId=p.withdrawn?'WITHDRAWN':p.category==='poster'?`P-${pad(p.posterNo)}`:p.bookId;
  const sideId=p.withdrawn?'':p.category==='poster'?`Poster ${p.posterNo}`:p.bookId;

  const typePillW=p.category==='poster'?160:134;
  roundRect(ctx,48,50,typePillW,28,14,accent);font(ctx,9.5,900);ctx.fillStyle='#fff';ctx.fillText(typeLabel,48+typePillW/2-ctx.measureText(typeLabel).width/2,68);
  font(ctx,24,900);ctx.fillStyle=accent;ctx.fillText(topId,548-ctx.measureText(topId).width,71);

  // Every abstract title uses exactly the same font size and fixed four-line block.
  const titleSize=21,titleLH=22.4,titleY=105,titleW=500;
  font(ctx,titleSize,900);ctx.fillStyle=C.navy;
  const titleLines=wrapLines(ctx,title,titleW).slice(0,4);
  drawLines(ctx,titleLines,48,titleY,titleLH,C.navy);

  // Fixed author layout so every page aligns, regardless of title or author-list length.
  const presenterLabelY=198,presenterY=218,authorsY=243,affY=311,dividerY=357;
  font(ctx,9.2,800);ctx.fillStyle=accent;ctx.fillText('PRESENTING AUTHOR',48,presenterLabelY);
  font(ctx,14.2,800);ctx.fillStyle='#2f4656';ctx.fillText(presenter||'—',48,presenterY);

  const authorRaw=norm(a.Authors)||norm(pr.AuthorsDisplay);
  const authorText=authorRaw.split(';').filter(Boolean).map(part=>displayAuthor(part).text).join(', ');
  font(ctx,10.4,600);ctx.fillStyle='#344a59';
  const authorLines=wrapLines(ctx,authorText,500).slice(0,5);
  drawLines(ctx,authorLines,48,authorsY,12.1,'#344a59');

  const aff=displayAffiliations(norm(a.Affiliations)||norm(pr.AffiliationsDisplay));
  font(ctx,9.0,400);ctx.fillStyle='#667b88';
  const affLines=wrapLines(ctx,aff,500).slice(0,4);
  drawLines(ctx,affLines,48,affY,10.6,'#667b88');

  ctx.strokeStyle=C.line;ctx.beginPath();ctx.moveTo(48,dividerY);ctx.lineTo(548,dividerY);ctx.stroke();

  // Shorter blue information rail, leaving more visual breathing room above the footer.
  const railY=dividerY+10,railBottom=782,railH=railBottom-railY;
  roundRect(ctx,48,railY,124,railH,22,C.navy);
  font(ctx,7.6,800);ctx.fillStyle=C.tealLight;ctx.fillText(p.category==='poster'?'POSTER':'PRESENTATION',67,railY+29);
  if(sideId){font(ctx,18,900);ctx.fillStyle='#fff';ctx.fillText(sideId,67,railY+55)}
  let ry=railY+76;
  if(p.category==='rapid'&&p.posterNo){font(ctx,7.3,800);ctx.fillStyle='#d9eff2';ctx.fillText(`ALSO POSTER ${p.posterNo}`,67,ry);ry+=19}
  const meta=presentationMeta(pr,sp);
  if(p.withdrawn){ry+=8}
  else{
    ctx.strokeStyle='#3c6883';ctx.beginPath();ctx.moveTo(66,ry);ctx.lineTo(154,ry);ctx.stroke();ry+=15;
    font(ctx,8.6,500);ctx.fillStyle='#dce8ed';if(meta.day){for(const l of wrapLines(ctx,meta.day,86)){ctx.fillText(l,67,ry);ry+=11}}
    if(meta.time){font(ctx,15.8,900);ctx.fillStyle='#fff';ctx.fillText(meta.time,67,ry+5);ry+=23}
    font(ctx,7.9,400);ctx.fillStyle='#bcd0da';if(meta.venue){for(const l of wrapLines(ctx,meta.venue,86).slice(0,3)){ctx.fillText(l,67,ry);ry+=9.2}}
    ctx.strokeStyle='#3c6883';ctx.beginPath();ctx.moveTo(66,ry+4);ctx.lineTo(154,ry+4);ctx.stroke();ry+=11;
  }
  if(sp){await drawSponsorMark(ctx,sp,58,ry+4,104,54);ry+=68}
  const kws=keywordList(a.Keywords);
  if(kws.length&&ry<610){
    font(ctx,9.8,800);ctx.fillStyle=C.tealLight;ctx.fillText('KEYWORDS',67,ry+17);
    let ky=ry+34;
    const pillW=100,pillH=40,pillX=60,pillGap=6,keywordFont=8.9,keywordLineH=9.8;
    for(const k of kws){
      if(ky+pillH>railBottom-9)break;
      font(ctx,keywordFont,650);
      let lines=wrapLines(ctx,k,84);
      // Keep every keyword pill the same size; allow up to four centred lines.
      if(lines.length>4){
        const compact=[];let line='';
        for(const word of String(k).split(/\s+/).filter(Boolean)){
          const test=line?`${line} ${word}`:word;
          if(ctx.measureText(test).width<=84||!line)line=test;
          else{compact.push(line);line=word}
        }
        if(line)compact.push(line);lines=compact.slice(0,4);
      }
      roundRect(ctx,pillX,ky,pillW,pillH,13,'#1c5b7b');
      ctx.fillStyle='#fff';
      const totalH=lines.length*keywordLineH;
      let ty=ky+(pillH-totalH)/2+keywordFont*.86;
      for(const line of lines){ctx.fillText(line,pillX+pillW/2-ctx.measureText(line).width/2,ty);ty+=keywordLineH}
      ky+=pillH+pillGap;
    }
  }

  // Larger abstract body. It can use the whitespace below the shorter blue rail if needed.
  drawAbstractBody(ctx,a.AbstractText||sp?.PosterAbstract,190,railY+2,357,412,accent);
  footer(ctx,p.footer,p.pageNo);return {canvas:c,hotspots:[]}
}

async function renderSpeaker(p){const {c,ctx}=canvas(),s=p.speaker||{},a=p.abstract||{},pr=p.presentation||{};ctx.fillStyle='#f5f6f7';ctx.fillRect(0,0,W,H);ctx.fillStyle=C.navy;ctx.fillRect(0,0,226,H);font(ctx,12,800);ctx.fillStyle=C.tealLight;ctx.fillText('FEATURED SPEAKER',38,73);const photoOk=await drawCirclePhoto(ctx,speakerPhotoPath(s),113,196,75);if(!photoOk){ctx.beginPath();ctx.arc(113,196,75,0,Math.PI*2);ctx.fillStyle='#d9eef1';ctx.fill();font(ctx,34,900);ctx.fillStyle=C.teal;const ini=initials(s.DisplayName||pr.SpeakerDisplay);ctx.fillText(ini,113-ctx.measureText(ini).width/2,208)}
  const name=norm(s.DisplayName)||norm(pr.SpeakerDisplay);const nfit=fitLines(ctx,name,150,92,27,19,800,1.03,4);font(ctx,nfit.size,800);drawLines(ctx,nfit.lines,38,320,nfit.lh,'#fff');font(ctx,10.2,400);ctx.fillStyle='#dbe6eb';const aff=norm(s.Affiliation)||displayAffiliations(a.Affiliations);const al=wrapLines(ctx,aff,150).slice(0,6);drawLines(ctx,al,38,392,12.8,'#dbe6eb');font(ctx,9.2,400);ctx.fillStyle='#dbe6eb';ctx.fillText('Perth 2026',38,420+Math.max(0,al.length-1)*12.8);
  const isPlenary=/plenary/i.test(norm(pr.PresentationType));const badgeColor=isPlenary?C.gold:C.teal;roundRect(ctx,256,62,128,28,15,badgeColor);font(ctx,9.5,900);ctx.fillStyle='#fff';const badge=`${norm(pr.PresentationType).toUpperCase()} SPEAKER`;ctx.fillText(badge,320-ctx.measureText(badge).width/2,80);const title=norm(pr.Title)&&!/^Keynote\s+\d+$/i.test(norm(pr.Title))?norm(pr.Title):(norm(a.Title)||`${norm(pr.PresentationType)} address`);const speakerTitleY=132;const tfit=fitLines(ctx,title,300,158,37,24,900,1.04,4);font(ctx,tfit.size,900);drawLines(ctx,tfit.lines,256,speakerTitleY,tfit.lh,C.navy);const titleBottom=speakerTitleY+tfit.lines.length*tfit.lh;
  const bodyY=Math.max(292,titleBottom+28);font(ctx,10.4,800);ctx.fillStyle=badgeColor;ctx.fillText(norm(a.AbstractText)?'ABSTRACT':'BIOGRAPHY',256,bodyY);drawAbstractBody(ctx,norm(a.AbstractText)||norm(s.Bio)||'Speaker profile.',256,bodyY+16,300,760-(bodyY+16),badgeColor);footer(ctx,p.footer,p.pageNo);return {canvas:c,hotspots:[]}}

function renderAuthorIndex(p){
  const {c,ctx}=canvas(),hs=[];ctx.fillStyle='#f1f3f4';ctx.fillRect(0,0,W,H);drawKicker(ctx,'FIND A CONTRIBUTOR',48,68);font(ctx,40,900);ctx.fillStyle='#243d52';ctx.fillText('Author Index',48,121);drawRule(ctx,48,133);

  // The first index page uses the two natural alphabet ranges present in the data.
  // The remaining S–Z entries all fit comfortably on the second page, so keep that
  // page as one clean full-width column rather than splitting it unnecessarily.
  const isLastIndexPage=p.indexNo===p.indexTotal&&p.indexTotal>1;
  const cols=isLastIndexPage?[p.authors]:[p.authors.slice(0,Math.ceil(p.authors.length/2)),p.authors.slice(Math.ceil(p.authors.length/2))];
  const headings=isLastIndexPage?['S–Z']:['A–K','K–S'];

  for(let col=0;col<cols.length;col++){
    const single=cols.length===1;
    const x=single?48:48+col*261;
    const boxW=single?500:239;
    roundRect(ctx,x,165,boxW,616,24,'#fff','#d8e1e5');
    font(ctx,18,800);ctx.fillStyle='#243d52';ctx.fillText(headings[col],x+20,199);
    ctx.strokeStyle='#dde5e8';ctx.beginPath();ctx.moveTo(x+18,209);ctx.lineTo(x+boxW-18,209);ctx.stroke();
    let y=226;
    for(const a of cols[col]){
      font(ctx,8,400);ctx.fillStyle='#364c5a';
      const nameMax=single?350:115;
      let nm=a.name;while(ctx.measureText(nm).width>nameMax&&nm.length>8)nm=nm.slice(0,-1);if(nm!==a.name)nm+='…';
      ctx.fillText(nm,x+20,y);
      let rx=x+boxW-18;
      for(const r of [...a.refs].reverse()){font(ctx,7,800);ctx.fillStyle=C.teal;const w=ctx.measureText(r.label).width;rx-=w;ctx.fillText(r.label,rx,y);hs.push({x:rx-2,y:y-10,w:w+4,h:14,target:r.key});rx-=8}
      ctx.strokeStyle='#edf1f3';ctx.beginPath();ctx.moveTo(x+18,y+8);ctx.lineTo(x+boxW-18,y+8);ctx.stroke();y+=17;if(y>755)break
    }
  }
  footer(ctx,'Author Index',p.pageNo);return {canvas:c,hotspots:hs}
}

async function renderPage(p){if(p.kind==='static')return renderStatic(p);if(p.kind==='toc-main')return renderTocMain(p);if(p.kind==='toc-category')return renderTocCategory(p);if(p.kind==='speaker')return renderSpeaker(p);if(p.kind==='abstract')return renderAbstract(p);if(p.kind==='author-index')return renderAuthorIndex(p);throw new Error(`Unknown page kind ${p.kind}`)}
function canvasToBlobUrl(c){return new Promise((resolve,reject)=>{try{c.toBlob(b=>{if(!b)return reject(new Error('Canvas export failed'));resolve(URL.createObjectURL(b))},'image/png')}catch(err){reject(new Error('Canvas export failed: '+(err?.message||err)))}})}
async function renderAll(){pageUrls.forEach(URL.revokeObjectURL);pageUrls=[];hotspotsByIndex=[];loadingText.textContent='Stacking the lipid bilayers…';for(let i=0;i<pages.length;i++){progress.textContent=`${Math.round(((i+1)/pages.length)*100)}%`;const res=await renderPage(pages[i]);hotspotsByIndex.push(res.hotspots||[]);pageUrls.push(await canvasToBlobUrl(res.canvas));if(i%6===0)await new Promise(r=>setTimeout(r,0))}loadingText.textContent='Packing the lipid layers for display…';await preloadUrls(pageUrls);progress.textContent=''}
async function preloadUrls(urls){let next=0;const workers=Array.from({length:Math.min(10,urls.length)},async()=>{while(next<urls.length){const i=next++;await new Promise(resolve=>{const im=new Image();const done=()=>resolve();im.onload=done;im.onerror=done;im.src=urls[i];if(im.decode)im.decode().then(done).catch(()=>{})})}});await Promise.all(workers)}

function buildDrawer(){const groups=[['Front matter',['about','committee','sponsors']],['Invited Speakers',pages.filter(p=>p.kind==='speaker').map(p=>p.key)],['Oral Presentations',pages.filter(p=>p.kind==='abstract'&&p.category==='oral').map(p=>p.key)],['Rapid Fire',pages.filter(p=>p.kind==='abstract'&&p.category==='rapid').map(p=>p.key)],['Poster Presentations',pages.filter(p=>p.kind==='abstract'&&p.category==='poster').map(p=>p.key)],['Index',[pages.find(p=>p.kind==='author-index')?.key].filter(Boolean)]];const html=[];for(const [title,keys] of groups){html.push(`<h3>${esc(title)}</h3>`);for(const key of keys){const p=pages.find(x=>x.key===key);if(!p)continue;let label=p.title||p.key;if(p.kind==='abstract')label=`${p.withdrawn?'Withdrawn':p.bookId}${p.posterNo&&p.category==='rapid'?` · Poster ${p.posterNo}`:''} — ${norm(p.abstract?.Title)||norm(p.presentation?.Title)}`;if(p.kind==='speaker')label=`${norm(p.presentation?.PresentationType)} — ${norm(p.speaker?.DisplayName||p.presentation?.SpeakerDisplay)}`;html.push(`<button class="jump ${p.kind==='abstract'?'small':''}" type="button" data-goto="${esc(key)}"><span>${esc(label)}</span><b>${pad(p.pageNo)}</b></button>`)}}drawerContents.innerHTML=html.join('')}
function hideCrispOverlay(){if(crispOverlay){crispOverlay.style.display='none';crispOverlay.innerHTML=''}}
function updateCrispOverlay(){
  if(!crispOverlay||!pf)return;
  let state='';try{state=pf.getState?.()||''}catch(_){}
  if(state&&state!=='read'){hideCrispOverlay();return}
  const canv=document.querySelector('#flipbook canvas');if(!canv){hideCrispOverlay();return}
  const br=canv.getBoundingClientRect(),vr=viewer.getBoundingClientRect();
  let orientation='landscape';try{orientation=pf.getOrientation()}catch(_){}
  const cur=Math.min(pf.getCurrentPageIndex?.()??currentIndex,visiblePageCount-1);
  const visible=orientation==='portrait'?[cur]:[cur,cur+1].filter(i=>i<visiblePageCount);
  const pageW=orientation==='portrait'?br.width:br.width/2;
  const left=br.left-vr.left+viewer.scrollLeft,top=br.top-vr.top+viewer.scrollTop;
  crispOverlay.innerHTML='';

  // Keep the crisp overlay completely flush with the PageFlip canvas. There is
  // deliberately no outer drop shadow here, because PageFlip removes that
  // during a turn and the transition looked inconsistent.
  for(let slot=0;slot<visible.length;slot++){
    const pi=visible[slot],im=document.createElement('img');
    im.src=pageUrls[pi];im.alt='';im.draggable=false;
    const overlap=orientation==='portrait'?0:.55;
    im.style.left=(left+slot*pageW-(slot?overlap:0))+'px';
    im.style.top=top+'px';
    im.style.width=(pageW+(orientation==='portrait'?0:overlap))+'px';
    im.style.height=br.height+'px';
    im.style.zIndex='1';
    crispOverlay.appendChild(im)
  }
  if(orientation!=='portrait'&&visible.length===2){
    // Use the sampled PageFlip shadow on BOTH inner page edges. The source profile
    // represents the shadow approaching the gutter from the left page; the right
    // page receives the exact same profile mirrored horizontally.
    const spineW=Math.max(17,pageW*.054);
    const seamX=left+pageW;
    const shadowSrc=(window.BOOK_ASSETS&&window.BOOK_ASSETS['assets/pageflip-shadow-profile.png'])||'assets/pageflip-shadow-profile.png';

    const makeSpine=(x,mirror=false)=>{
      const spine=document.createElement('div');
      spine.style.position='absolute';
      spine.style.left=x+'px';
      spine.style.top=top+'px';
      spine.style.width=spineW+'px';
      spine.style.height=br.height+'px';
      spine.style.backgroundImage=`url("${shadowSrc}")`;
      spine.style.backgroundSize='100% 100%';
      spine.style.backgroundRepeat='no-repeat';
      spine.style.pointerEvents='none';
      spine.style.zIndex='2';
      if(mirror)spine.style.transform='scaleX(-1)';
      return spine;
    };

    crispOverlay.appendChild(makeSpine(seamX-spineW,false));
    crispOverlay.appendChild(makeSpine(seamX,true));

    // Extra fold core for the RIGHT page only. Keep this as a separate,
    // unmirrored overlay so the darkening stays at the gutter and cannot create
    // a hard border on the outer edge of the right page.
    const rightCore=document.createElement('div');
    rightCore.style.position='absolute';
    rightCore.style.left=seamX+'px';
    rightCore.style.top=top+'px';
    rightCore.style.width=spineW+'px';
    rightCore.style.height=br.height+'px';
    rightCore.style.pointerEvents='none';
    rightCore.style.zIndex='3';
    rightCore.style.background='linear-gradient(to right, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0.23) 8%, rgba(0,0,0,0.15) 20%, rgba(0,0,0,0.08) 36%, rgba(0,0,0,0.035) 54%, rgba(0,0,0,0.012) 72%, rgba(0,0,0,0) 100%)';
    crispOverlay.appendChild(rightCore);
  }
  crispOverlay.style.display='block'
}
function applyZoom(){
  zoomValue.textContent=`${Math.round(zoomLevel*100)}%`;
  const target=document.querySelector('.stf__parent')||document.querySelector('.fallback');
  if(!target)return;
  if(window.CSS&&CSS.supports&&CSS.supports('zoom','1')){target.style.zoom=String(zoomLevel);target.style.transform=''}
  else{target.style.zoom='';target.style.transform=`scale(${zoomLevel})`;target.style.transformOrigin='center center'}
  setTimeout(()=>{updateHotspots();updateCrispOverlay()},60)
}
function setZoom(v){zoomLevel=Math.max(minZoom,Math.min(maxZoom,Math.round(v*100)/100));applyZoom()}
function goToKey(key){const i=keyToIndex.get(key);if(i!==undefined)go(i)}
function go(i){const target=Math.max(0,Math.min(visiblePageCount-1,+i));if(pf)pf.flip(target,'bottom');else showFallback(target)}
function next(){if(pf){if(currentIndex<visiblePageCount-1)pf.flipNext('bottom')}else showFallback(Math.min(visiblePageCount-1,fallbackIndex+1))}
function prev(){if(pf)pf.flipPrev('bottom');else showFallback(Math.max(0,fallbackIndex-1))}
function showFallback(i=0){fallbackIndex=Math.max(0,Math.min(visiblePageCount-1,i));if(!fallback){fallback=document.createElement('div');fallback.className='fallback';fallback.innerHTML='<img alt="Book page">';flipbook.replaceWith(fallback)}fallback.querySelector('img').src=pageUrls[fallbackIndex];current.textContent=fallbackIndex+1;loading.style.display='none'}
function updateHotspots(){linkOverlay.innerHTML='';if(!pf)return;let state='';try{state=pf.getState?.()||''}catch(_){}if(state==='flipping'||state==='user_fold')return;const canv=document.querySelector('#flipbook canvas');if(!canv)return;const br=canv.getBoundingClientRect(),vr=viewer.getBoundingClientRect();let orientation='landscape';try{orientation=pf.getOrientation()}catch(_){}const cur=pf.getCurrentPageIndex();const visible=orientation==='portrait'?[cur]:[cur,cur+1].filter(i=>i<pages.length);const pageW=orientation==='portrait'?br.width:br.width/2,sx=pageW/W,sy=br.height/H;visible.forEach((pi,slot)=>{for(const h of hotspotsByIndex[pi]||[]){const b=document.createElement('button');b.type='button';b.style.left=(br.left-vr.left+viewer.scrollLeft+slot*pageW+h.x*sx)+'px';b.style.top=(br.top-vr.top+viewer.scrollTop+h.y*sy)+'px';b.style.width=(h.w*sx)+'px';b.style.height=(h.h*sy)+'px';b.addEventListener('pointerdown',e=>e.stopPropagation());b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();goToKey(h.target)});linkOverlay.appendChild(b)}})}
function initPageFlip(){
  visiblePageCount=pages.filter(p=>!p.hidden).length;total.textContent=visiblePageCount;keyToIndex=new Map(pages.map((p,i)=>[p.key,i]));
  if(!(window.St&&St.PageFlip))throw new Error('PageFlip library unavailable');
  const mobile=window.matchMedia('(max-width:850px)').matches;
  pf=new St.PageFlip(flipbook,{width:595,height:842,size:'stretch',minWidth:280,maxWidth:595,minHeight:396,maxHeight:842,showCover:false,usePortrait:mobile,autoSize:true,drawShadow:true,maxShadowOpacity:.42,flippingTime:450,mobileScrollSupport:false,useMouseEvents:true,swipeDistance:20,showPageCorners:true,disableFlipByClick:false});
  pf.on('flip',e=>{currentIndex=Math.min(e.data,visiblePageCount-1);current.textContent=Math.min(e.data+1,visiblePageCount);setTimeout(()=>{updateHotspots();updateCrispOverlay()},40)});
  pf.on('changeState',e=>{if(e.data!=='read'){linkOverlay.innerHTML='';hideCrispOverlay()}else setTimeout(()=>{updateHotspots();updateCrispOverlay()},40)});
  pf.on('changeOrientation',()=>setTimeout(()=>{updateHotspots();updateCrispOverlay()},80));
  pf.on('init',()=>{currentIndex=0;current.textContent=1;loading.style.display='none';setTimeout(()=>{applyZoom();updateHotspots();updateCrispOverlay()},120)});
  pf.loadFromImages(pageUrls)
}
async function init(){try{const data=await getData();pages=buildModel(data);buildDrawer();await renderAll();initPageFlip()}catch(err){console.error(err);loadingText.textContent='Could not prepare the page-turning book.';progress.textContent=err?.message||String(err);try{if(pageUrls.length){visiblePageCount=pages.filter(p=>!p.hidden).length;showFallback(0)}}catch(_){}}}

document.getElementById('nextBtn').addEventListener('click',next);document.getElementById('prevBtn').addEventListener('click',prev);document.getElementById('firstBtn').addEventListener('click',()=>go(0));document.getElementById('contentsBtn').addEventListener('click',()=>drawer.classList.add('open'));document.getElementById('closeDrawer').addEventListener('click',()=>drawer.classList.remove('open'));drawer.addEventListener('click',e=>{const b=e.target.closest('[data-goto]');if(!b)return;goToKey(b.dataset.goto);drawer.classList.remove('open')});document.getElementById('zoomOut').addEventListener('click',()=>setZoom(zoomLevel-zoomStep));document.getElementById('zoomIn').addEventListener('click',()=>setZoom(zoomLevel+zoomStep));zoomValue.addEventListener('click',()=>setZoom(1));document.addEventListener('keydown',e=>{if(e.key==='ArrowRight')next();if(e.key==='ArrowLeft')prev();if((e.ctrlKey||e.metaKey)&&(e.key==='+'||e.key==='=')){e.preventDefault();setZoom(zoomLevel+zoomStep)}if((e.ctrlKey||e.metaKey)&&e.key==='-'){e.preventDefault();setZoom(zoomLevel-zoomStep)}if((e.ctrlKey||e.metaKey)&&e.key==='0'){e.preventDefault();setZoom(1)}});window.addEventListener('resize',()=>setTimeout(()=>{updateHotspots();updateCrispOverlay()},100));viewer.addEventListener('scroll',()=>{updateHotspots();updateCrispOverlay()},{passive:true});window.addEventListener('beforeunload',()=>pageUrls.forEach(URL.revokeObjectURL));
init();
})();
