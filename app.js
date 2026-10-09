import { icon, escapeHtml as esc, hydrateIcons } from './icons.mjs';
import { modeLabels, secondsText, dateText, safeUrl, normalizeBook, normalizeShelf, normalizeNotebook, normalizeStats, normalizeNotes, categoryDistribution, buildReadingMonth, buildReadingYear } from './reading-model.mjs';
import { demoDashboard, demoNotes, demoRecommendations, demoCalendar } from './demo-data.mjs';

const titles={overview:'阅读总览',library:'我的书架',notes:'笔记与想法',discover:'发现好书',skills:'我的 Skills'};
const main=document.querySelector('main'),dialog=document.querySelector('dialog');
let view=titles[location.hash.slice(1)]?location.hash.slice(1):'overview';
let mode='monthly',live=false,connected=false,busy=false,loadError='',requestId=0,detailId=0;
let skill={installed:false,version:null,source:'https://github.com/Tencent/WeChatReading'},statusLoaded=false;
let dashboard=demoDashboard(mode),search='',libraryFilter='all',noteFilter='all',activeNotebook=null,notebookContent=null,noteLoading=false,noteError='',recommendations=null;
const savedNotes=new Set();
let librarySort='recent',libraryLayout='covers',libraryLimit=48,selectedDay='';
const currentCalendarPeriod=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date()).split('-').map(Number);
let [calendarYear,calendarMonth]=currentCalendarPeriod();
let calendarView='month',calendarBusy=false,calendarError='',calendarRequest=0;
const calendarCache=new Map();
let categoryMode='follow',categoryBusy=false,categoryError='',categoryRequest=0;
const categoryCache=new Map();
const categoryPeriod=()=>categoryMode==='follow'?mode:categoryMode;
const categoryStats=()=>categoryMode==='follow'?stats():normalizeStats(live?categoryCache.get(categoryPeriod()):demoDashboard(categoryPeriod()).stats,categoryPeriod());
const calendarKey=()=>`${calendarYear}:${calendarView==='month'?calendarMonth:'year'}`;
const number=value=>value==null?'—':esc(value);
const placeholder=text=>`<div class="empty-state">${esc(text)}</div>`;
const message=text=>`<div class="inline-message" role="status">${icon('info')}<span>${esc(text)}</span></div>`;
const sourceLabel=()=>live?'微信读书':'示例数据';
const shelf=()=>dashboard.shelf?normalizeShelf(dashboard.shelf,dashboard.progress):{entries:[],total:0,electronic:0,audio:0,articles:0};
const notebooks=()=>((dashboard.notebooks?.books)||[]).map(normalizeNotebook);
const stats=()=>normalizeStats(dashboard.stats,mode);
const bookFor=id=>shelf().entries.find(book=>book.id===id)||notebooks().find(book=>book.id===id)||recommendations?.find(book=>book.id===id)||stats()?.ranking.find(book=>book.id===id);
const hrefLink=(book,label='打开阅读')=>book.deepLink?`<a class="primary-button" href="${esc(book.deepLink)}" target="_blank" rel="noopener noreferrer">${icon('book')}${label}</a>`:'';
async function api(url,body){const response=await fetch(url,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});let result;try{result=await response.json();}catch{throw new Error('本地服务返回了无法读取的数据，请确认预览服务正在运行。');}if(!response.ok)throw new Error(result.message||'暂时无法完成请求，请稍后重试。');return result;}
function navTo(next){if(!titles[next])return;view=next;search='';location.hash=next;render();window.scrollTo({top:0,behavior:'instant'});if(next==='overview'&&categoryMode!=='follow'&&connected&&!categoryCache.has(categoryPeriod())&&!categoryBusy&&!categoryError)loadCategory();if(next==='discover'&&!recommendations)loadRecommendations();if(['overview','library'].includes(next)&&connected&&!calendarCache.has(calendarKey()))loadCalendar();}
function header(eyebrow,title,subtitle,controls=''){return `<section class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="heading-subtitle">${subtitle}</p></div>${controls?`<div class="heading-controls">${controls}</div>`:''}</section>`;}
function periods(){return `<div class="segmented" aria-label="分析时间范围">${Object.entries(modeLabels).map(([key,label])=>`<button data-mode="${key}" class="${mode===key?'selected':''}" aria-pressed="${mode===key}">${label}</button>`).join('')}</div>`;}
function stat(label,value,unit,type,footer){return `<article class="stat"><div class="stat-top"><span>${label}</span>${icon(type)}</div><div class="stat-number">${number(value)}<small>${unit}</small></div><div class="stat-bottom">${footer}</div></article>`;}
function countStat(label,value,type,footer){const parsed=typeof value==='string'?value.match(/^([\d.,]+)\s*(.*)$/):null;return stat(label,parsed?parsed[1]:value,parsed?esc(parsed[2]):'',type,footer);}
function cover(book,extra=''){
  if(book.coverUrl)return `<div class="book-cover real-cover ${extra}"><img src="${esc(book.coverUrl)}" alt="《${esc(book.title)}》封面" loading="lazy" referrerpolicy="no-referrer"></div>`;
  const colors=['blue','orange','cream','dark','teal','purple'];const color=colors[[...book.id].reduce((n,c)=>n+c.charCodeAt(0),0)%colors.length];
  return `<div class="book-cover cover-${color} ${extra}" aria-hidden="true"><span class="cover-en">${book.kind==='audio'?'AUDIOBOOK':book.kind==='articles'?'YOUR COLLECTION':'READ YOURSELF'}</span><span class="cover-title">${esc(book.title)}</span><span class="cover-author">${esc(book.author)}</span></div>`;
}
function bookCard(book){return `<button class="book-card" data-book="${esc(book.id)}" aria-label="查看《${esc(book.title)}》的阅读详情">${cover(book)}<span class="book-title">${esc(book.title)}</span><span class="book-author">${esc(book.author)}</span><span class="book-progress"><span>${book.kind==='audio'?'有声书':book.kind==='articles'?'文章收藏':book.finished?'已读完':'阅读进度'}</span><strong>${book.progress==null?'—':`${number(book.progress)}%`}</strong></span><span class="progress-track"><i style="width:${Math.min(100,Math.max(0,Number(book.progress)||0))}%"></i></span><span class="book-time">${book.seconds!=null?`累计 ${secondsText(book.seconds)}`:book.lastRead?`最近阅读 ${dateText(book.lastRead)}`:book.kind==='articles'?'仅包含收藏入口，不含文章内容':'进度待查看'}</span></button>`;}
function bucketLabel(stamp){const date=dateText(stamp);return mode==='annually'?date.slice(0,7):mode==='overall'?date.slice(0,4):date.slice(5);}
function chartMarkup(s){
  if(!s.buckets.length)return placeholder('当前周期尚无阅读明细。');
  const max=Math.max(60,...s.buckets.map(b=>b.seconds));const scale=Math.ceil(max/1800)*1800;
  const step=mode==='annually'?'月':mode==='overall'?'年':'天';
  const tickCount=Math.min(5,s.buckets.length);const indices=Array.from({length:tickCount},(_,i)=>tickCount===1?0:Math.round(i*(s.buckets.length-1)/(tickCount-1)));
  return `<div class="chart-summary"><strong>${s.average==null?'—':Math.floor(s.average/60)}<span class="chart-unit">分钟</span></strong><span>自然日均</span><div class="chart-legend"><i></i>阅读与收听</div></div><div class="chart" aria-label="${modeLabels[mode]}阅读与收听时长"><div class="grid-lines">${[scale,scale/2,0].map(v=>`<div class="grid-line"><span>${Math.round(v/60)}m</span></div>`).join('')}</div><div class="bars">${s.buckets.map(b=>`<button class="bar" style="--height:${b.seconds/scale*100}%" aria-label="${bucketLabel(b.timestamp)}，${secondsText(b.seconds)}"><span class="chart-tooltip">${bucketLabel(b.timestamp)} · ${secondsText(b.seconds)}</span></button>`).join('')}</div><div class="chart-labels">${indices.map(i=>`<span>${bucketLabel(s.buckets[i].timestamp)}</span>`).join('')}</div></div><div class="chart-footer">${icon('info')}按自然${step}展示 · 总时长以微信读书统计为准${s.days!=null?` · 有效阅读 ${s.days} 天`:''}</div>`;
}
const categoryColors=['#567ed0','#87a4d2','#b6c8df','#85aea7','#c5b695','#ac9fc1','#92b9c8','#c6a69d'];
function categoryChart(){
  const s=categoryStats(),period=categoryPeriod();
  const distribution=categoryDistribution(s?.categories||[]),entries=distribution.entries;
  const byCount=distribution.basis==='count';
  const rangeOptions=[['follow',`跟随总览（${modeLabels[mode]}）`],...Object.entries(modeLabels)];
  const heading=`<div class="section-title category-heading"><h2>你的阅读，偏爱哪些类型？</h2><div class="category-controls">${entries.length&&!categoryBusy&&!categoryError?`<span class="status-pill">${byCount?'按阅读本数':'按阅读时长'}</span>`:''}<label class="category-range"><span>统计范围</span><select id="category-range" aria-label="分类统计时间范围">${rangeOptions.map(([value,label])=>`<option value="${value}" ${categoryMode===value?'selected':''}>${label}</option>`).join('')}</select></label></div></div>`;
  const wrap=content=>`<article class="panel category-distribution" aria-label="阅读书籍类型分布" aria-busy="${categoryBusy}">${heading}${content}</article>`;
  const periodNote=period==='overall'?'全部阅读记录':'微信读书自然周期统计';
  if(categoryBusy)return wrap(`<p class="subtext">${modeLabels[period]} · ${periodNote}</p><div class="category-state" role="status">正在读取${modeLabels[period]}的分类统计…</div>`);
  const error=categoryError||(categoryMode==='follow'&&dashboard.errors?.stats);
  if(error)return wrap(`<div class="category-state" role="status"><p>${esc(error)}</p><button class="text-button" data-action="category-retry">重新读取</button></div>`);
  if(!entries.length)return wrap(`<p class="subtext">${modeLabels[period]} · ${periodNote}</p><div class="category-state" role="status">这个范围暂未提供有效的阅读分类数据，可尝试其他时间范围。</div>`);
  let offset=0;
  const arcs=entries.map((category,index)=>{
    const gap=entries.length===1?0:Math.min(.8,category.share*.12),start=offset;offset+=category.share;
    return `<circle class="category-arc ${index===0?'selected':''}" data-category="${index}" cx="120" cy="120" r="88" pathLength="100" fill="none" stroke="${categoryColors[index%categoryColors.length]}" stroke-width="27" stroke-dasharray="${category.share-gap} ${100-category.share+gap}" stroke-dashoffset="${-start}" transform="rotate(-90 120 120)"><title>${esc(category.title)} · ${distribution.basis==='count'?`${category.value} 本`:secondsText(category.value)} · ${category.share.toFixed(1)}%</title></circle>`;
  }).join('');
  const top=entries[0];
  return wrap(`<p class="subtext">${modeLabels[period]} · ${entries.length} 个已提供分类 · ${periodNote}</p><div class="category-distribution-layout"><div class="category-pie"><svg viewBox="0 0 240 240" aria-hidden="true" focusable="false">${arcs}</svg><div class="category-pie-center" aria-live="polite" aria-atomic="true"><strong id="category-share">${top.share.toFixed(0)}<small>%</small></strong><span id="category-title">${esc(top.title)}</span><small id="category-value">${byCount?`${top.value} 本`:secondsText(top.value)}</small></div></div><div class="category-breakdown" aria-label="分类占比明细">${entries.map((category,index)=>`<button class="category-legend-row ${index===0?'selected':''}" data-category="${index}" aria-pressed="${index===0}" aria-label="${esc(category.title)}，${byCount?`${category.value} 本`:secondsText(category.value)}，占比 ${category.share.toFixed(1)}%"><i style="background:${categoryColors[index%categoryColors.length]}"></i><span class="category-name">${esc(category.title)}</span><span class="category-amount">${byCount?`${category.value} 本`:secondsText(category.value)}</span><strong>${category.share.toFixed(1)}%</strong></button>`).join('')}</div></div><p class="category-chart-note">${byCount?'按接口已提供分类的阅读本数计算占比，不代表全部书架。':'接口未提供完整的分类本数，当前按已提供分类的阅读时长计算占比。'}点击扇区或分类查看详情。</p>`);
}
function selectCategory(index){
  const distribution=categoryDistribution(categoryStats()?.categories||[]),category=distribution.entries[index];if(!category)return;
  document.querySelector('#category-share').innerHTML=`${category.share.toFixed(0)}<small>%</small>`;
  document.querySelector('#category-title').textContent=category.title;
  document.querySelector('#category-value').textContent=distribution.basis==='count'?`${category.value} 本`:secondsText(category.value);
  document.querySelectorAll('[data-category]').forEach(element=>{const selected=Number(element.dataset.category)===index;element.classList.toggle('selected',selected);if(element.tagName==='BUTTON')element.setAttribute('aria-pressed',selected);});
}
function renderCategory(){
  const panel=document.querySelector('.category-distribution');if(!panel)return;
  const focused=document.activeElement?.id==='category-range';
  panel.outerHTML=categoryChart();
  if(focused)document.querySelector('#category-range')?.focus({preventScroll:true});
}
function resetCategory(){++categoryRequest;categoryCache.clear();categoryBusy=false;categoryError='';}
async function loadCategory(refresh=false){
  const ticket=++categoryRequest,period=categoryPeriod();categoryError='';
  if(categoryMode==='follow'||!connected||(!refresh&&categoryCache.has(period))){categoryBusy=false;renderCategory();return;}
  categoryBusy=true;renderCategory();
  try{
    const data=await api(`/api/dashboard?mode=${period}${refresh?'&refresh=1':''}`);
    if(ticket!==categoryRequest)return;
    if(data.errors?.stats||!data.stats)throw new Error(data.errors?.stats||'暂时无法读取这个范围的分类统计。');
    categoryCache.set(period,data.stats);
  }catch(error){if(ticket===categoryRequest)categoryError=error.message;}
  finally{if(ticket===categoryRequest){categoryBusy=false;renderCategory();}}
}
function preferences(s){
  const hasHours=s.slots.some(slot=>Number.isFinite(slot.seconds)&&slot.seconds>0);
  const hourMax=Math.max(1,...s.slots.map(slot=>Number.isFinite(slot.seconds)?slot.seconds:0));
  const hourPanel=hasHours?`<article class="panel reading-hours"><div class="section-title"><h2>什么时间，最适合你？</h2>${icon('moon')}</div><p class="subtext">${esc(s.timeWord||'24 小时阅读偏好')}</p><div class="hour-chart" aria-label="24 小时阅读偏好">${s.slots.map(slot=>`<button class="hour-bar" style="--height:${Math.max(0,Number.isFinite(slot.seconds)?slot.seconds:0)/hourMax*100}%" aria-label="${slot.hour}:00，${secondsText(slot.seconds)}"></button>`).join('')}</div><div class="hour-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div></article>`:'';
  const pie=categoryChart();
  if(!hourPanel&&!pie)return '';
  return `<section class="lower-grid preference-grid ${!hasHours||!pie?'single-preference':''}" aria-label="阅读偏好">${hourPanel}${pie}</section>`;
}
function overview(){
  const s=stats(),items=shelf();const recent=[...items.entries].filter(book=>book.kind==='book'&&book.lastRead).sort((a,b)=>b.lastRead-a.lastRead).slice(0,4);
  const heading=header('YOUR READING, YOUR RHYTHM','每一页，<span>都算数。</span>','读过的书，正在悄悄成为你的一部分。',`${periods()}<button class="secondary-button" data-action="sync">${icon('link')}${busy?'同步中…':'刷新'}</button>`);
  const banner=!live?`<div class="demo-strip"><span>${icon('info')}正在浏览示例。Skill ${skill.installed?'已安装':'未安装'}，连接账号后查看你的阅读。</span><button data-action="connect">连接账号</button></div>`:'';
  const errors=Object.entries(dashboard.errors||{}).filter(([key])=>!key.startsWith('progress:')).map(([key,error])=>message(`${{stats:'阅读统计',shelf:'书架',notebooks:'笔记'}[key]}：${error}`)).join('');
  if(!s)return `${heading}${banner}${errors}${placeholder(live?'阅读统计尚未获取，请重新同步。':'正在准备阅读空间。')}`;
  const readBooks=s.summary.find(item=>item.stat==='读过')?.counts;const periodNotes=s.summary.find(item=>item.stat==='笔记')?.counts;
  const compare=s.compare==null?'未提供上一周期对比':`<span class="${s.compare>=0?'positive':''}">${s.compare>=0?'↗':'↘'} ${Math.abs(s.compare*100).toFixed(0)}%</span><span>日均较上一周期</span>`;
  const strongest=s.categories[0];const top=s.ranking[0];
  const insightText=strongest?`你在「${strongest.title}」上的阅读累计 ${secondsText(strongest.seconds)}。这些文字，正在成为你关注的方向。`:'继续保留自己的节奏。更多阅读之后，这里会呈现你的分类与时段偏好。';
  return `${heading}${banner}${loadError?message(loadError):''}${errors}<section class="stats" aria-label="阅读统计">${stat(`${modeLabels[mode]}阅读与收听`,s.total==null?null:(s.total/3600).toFixed(1),'小时','clock',compare)}${stat('有效阅读',s.days,'天','calendar','单日阅读满 1 分钟计入')}${countStat(`${modeLabels[mode]}读过`,readBooks||null,'book','以阅读统计摘要为准')}${countStat(`${modeLabels[mode]}笔记`,periodNotes||null,'pen','含划线、想法与书签')}</section>${heatmap()}<section class="middle-grid"><article class="panel"><div class="section-title"><div><h2>阅读的节奏</h2><p class="subtext">${modeLabels[mode]} · 微信读书自然周期统计</p></div><span class="status-pill">${sourceLabel()}</span></div>${chartMarkup(s)}</article><article class="insight"><div class="insight-top">${icon('sparkles')}阅读洞察<span class="count-tag">${live?'基于阅读记录':'示例'}</span></div><h3>${strongest?`最近，你在探索<br>${esc(strongest.title)}。`:'慢慢读，<br>保留自己的节奏。'}</h3><p>${esc(insightText)}</p><div class="insight-fact">${icon('moon')}<span><strong>${esc(s.timeWord||'阅读时段还在积累')}</strong><small>${top?`读得最多：《${esc(top.title)}》`:'更多阅读，让偏好渐渐清晰'}</small></span></div><div class="insight-foot">依据${live?'微信读书':'示例'}${modeLabels[mode]}统计 · 不推断未提供信息</div></article></section><section class="shelf-section"><div class="section-title"><div class="shelf-header-info"><h2>最近翻开的书</h2><span class="count-tag">最近 4 本</span></div><button class="text-button" data-view="library">查看书架 ${icon('chevron')}</button></div><div class="shelf-grid">${recent.length?recent.map(bookCard).join(''):placeholder('暂时没有最近阅读的书籍。')}</div></section>${preferences(s)}<section class="lower-grid"><article class="panel"><div class="section-title"><h2>${modeLabels[mode]}，时间留给了这些书</h2><span class="subtext">阅读与收听排行</span></div><div class="reading-ranking">${s.ranking.slice(0,4).map((book,i)=>`<button class="ranking-item" data-book="${esc(book.id)}"><span class="ranking-number">0${i+1}</span><span><strong>${esc(book.title)}</strong><small>${esc(book.author)}</small></span><span class="ranking-duration">${secondsText(book.seconds)}</span></button>`).join('')||placeholder('阅读排行暂未提供。')}</div></article><article class="panel"><div class="section-title"><h2>阅读的另一面</h2>${icon('books')}</div>${s.readingRate==null?`<p class="subtext">当前统计未提供阅读与听书占比。</p>`:`<div class="reading-mix"><strong>${number(s.readingRate)}<small>%</small></strong><span>文字阅读</span></div><div class="progress-track mix-track"><i style="width:${Math.min(100,Math.max(0,s.readingRate))}%"></i></div><div class="mix-details"><span>阅读 ${secondsText(s.readingSeconds)}</span><span>听书 ${secondsText(s.listeningSeconds)}</span></div>`}${s.authors.length?`<p class="subtext favorite-author">常读作者 · ${s.authors.map(author=>esc(author.name)).join('、')}</p>`:''}</article></section>`;
}
function calendarSource(){return !live?demoCalendar(calendarYear,calendarView==='month'?calendarMonth:null):calendarCache.get(calendarKey());}
function calendarData(){const raw=calendarSource();return calendarView==='year'?buildReadingYear(raw,new Date(),calendarYear):buildReadingMonth({...raw,baseTime:Date.UTC(calendarYear,calendarMonth-1,15)/1000});}
function dayDescription(day){const duration=day.seconds<60?'不足 1 分钟':day.seconds<3600?`${Math.floor(day.seconds/60)} 分钟`:secondsText(day.seconds);return `${day.date} · ${day.state==='future'?'尚未到来':day.state==='unknown'?'未提供记录':day.seconds===0?'未阅读':duration}`;}
function calendarCell(day,selected,monthly=false){
  if(!day)return '<span class="calendar-padding" aria-hidden="true"></span>';
  const brief=day.seconds>0?(day.seconds<60?'<1分':day.seconds<3600?`${Math.floor(day.seconds/60)}分`:`${(day.seconds/3600).toFixed(1)}时`):'';
  return `<button class="calendar-day ${day.state} level-${day.level} ${day.date===selected?.date?'selected':''}" data-day="${day.date}" aria-label="${esc(dayDescription(day))}" aria-pressed="${day.date===selected?.date}" tabindex="${day.date===selected?.date?'0':'-1'}" title="${esc(dayDescription(day))}" ${day.state==='future'?'disabled':''}><span class="day-square">${monthly?`<span class="day-number">${day.day}</span>${brief?`<small>${brief}</small>`:''}`:''}</span></button>`;
}
function heatmap(){
  const raw=calendarSource(),calendar=calendarData(),isMonth=calendarView==='month';
  const selected=calendar.days.find(day=>day.date===selectedDay&&day.state!=='future')||calendar.days.findLast(day=>day.seconds!=null)||calendar.days.findLast(day=>day.state!=='future');
  const [currentYear,currentMonth]=currentCalendarPeriod();
  const atCurrent=calendarYear===currentYear&&(!isMonth||calendarMonth===currentMonth);
  const periodLabel=isMonth?`${calendarYear} 年 ${calendarMonth} 月`:`${calendarYear} 年`;
  const offset=isMonth?(new Date(Date.UTC(calendarYear,calendarMonth-1,1)).getUTCDay()+6)%7:0;
  const total=raw?.totalReadTime;
  const monthBody=`<div class="month-calendar-layout"><div class="calendar-summary"><div><span class="calendar-summary-label">这个月，留给阅读</span><div class="calendar-total">${total==null?'—':(total/3600).toFixed(1)}<small>小时</small></div></div><div class="calendar-best"><span>读得最久的一天</span><strong>${calendar.best?`${calendar.best.date.slice(5).replace('-',' / ')} · ${secondsText(calendar.best.seconds)}`:'等待阅读记录'}</strong></div></div><div class="month-calendar"><div class="calendar-weekdays">${['一','二','三','四','五','六','日'].map(day=>`<span>${day}</span>`).join('')}</div><div class="month-days">${Array(offset).fill('<span class="calendar-padding" aria-hidden="true"></span>').join('')}${calendar.days.map(day=>calendarCell(day,selected,true)).join('')}</div></div></div>`;
  const yearBody=isMonth?'':`<div class="calendar-scroll year-scroll" tabindex="0" aria-label="年度每日阅读时长，小屏可左右滑动"><div class="year-calendar" style="--weeks:${calendar.weekCount}"><div class="year-months">${calendar.months.map(item=>`<span style="grid-column:${item.week+1}">${item.month} 月</span>`).join('')}</div><div class="year-weekdays">${['一','','三','','五','','日'].map(day=>`<span>${day}</span>`).join('')}</div><div class="year-days">${calendar.slots.map(day=>calendarCell(day,selected)).join('')}</div></div></div>`;
  return `<section class="reading-calendar ${isMonth?'monthly-calendar':'annual-calendar'}" aria-label="${isMonth?'月度':'年度'}阅读热力图" aria-busy="${calendarBusy}"><div class="calendar-heading"><div><h2>${icon('calendar')}阅读热力图 ${!live?'<span class="calendar-demo-tag">示例</span>':''}</h2><p>${calendarBusy?'正在同步逐日阅读记录…':raw&&calendar.knownDays?`有效阅读 <strong>${calendar.activeDays}</strong> 天 · 最长连续 <strong>${calendar.longest}</strong> 天`:'逐日记录尚未提供'}${!isMonth&&raw&&calendar.knownDays?`<span class="calendar-coverage"> · 已知 ${calendar.knownDays} 天</span>`:''}</p></div><div class="segmented calendar-view-toggle" aria-label="热力图视图"><button data-calendar-view="month" class="${isMonth?'selected':''}" aria-pressed="${isMonth}">月度</button><button data-calendar-view="year" class="${!isMonth?'selected':''}" aria-pressed="${!isMonth}">年度</button></div></div><div class="calendar-period-nav"><button class="icon-button calendar-previous" data-calendar-shift="-1" aria-label="${isMonth?'上个月':'上一年'}" ${calendarYear===2000&&(!isMonth||calendarMonth===1)?'disabled':''}>${icon('chevron')}</button><strong>${periodLabel}</strong><button class="icon-button" data-calendar-shift="1" aria-label="${isMonth?'下个月':'下一年'}" ${atCurrent?'disabled':''}>${icon('chevron')}</button>${!atCurrent?`<button class="calendar-today" data-action="calendar-current">回到${isMonth?'本月':'本年'}</button>`:''}<span class="calendar-source">${live?'微信读书':'示例数据'}</span></div>${isMonth?monthBody:yearBody}${calendarError?`<div class="calendar-warning" role="alert">${esc(calendarError)}<button data-action="calendar-retry">重新加载</button></div>`:''}${raw?.errors?.length?`<div class="calendar-warning">${raw.errors.map(error=>`${error.month} 月：${esc(error.message)}`).join('；')}<button data-action="calendar-retry">重试缺失月份</button></div>`:''}<div class="calendar-footer"><span id="calendar-detail" role="status">${selected?esc(dayDescription(selected)):'点击日期，查看当天阅读时长'}</span><div class="calendar-legend"><span>少</span>${[0,1,2,3,4].map(level=>`<i class="level-${level}" title="${['未阅读','不足或等于15分钟','15至30分钟','30至60分钟','超过60分钟'][level]}"></i>`).join('')}<span>多</span><i class="unknown"></i><span>未提供</span></div></div><p class="calendar-note">单日满 1 分钟计入有效阅读；斜纹表示未提供记录，空心方格表示未来日期。${!isMonth?'每列是一周，每个方格是一天。':''}</p></section>`;
}
function renderCalendar(){const region=document.querySelector('.reading-calendar');if(region)region.outerHTML=heatmap();}
async function loadCalendar(refresh=false){
  const ticket=++calendarRequest,key=calendarKey();
  calendarError='';
  if(!connected||!refresh&&calendarCache.has(key)){calendarBusy=false;renderCalendar();return;}
  const year=calendarYear,month=calendarView==='month'?calendarMonth:null;
  calendarBusy=true;renderCalendar();
  try{const result=await api(`/api/calendar?year=${year}${month?`&month=${month}`:''}${refresh?'&refresh=1':''}`);if(ticket!==calendarRequest)return;calendarCache.set(key,result);}
  catch(error){if(ticket===calendarRequest)calendarError=error.message;}
  finally{if(ticket===calendarRequest){calendarBusy=false;renderCalendar();}}
}
async function shiftCalendar(amount){
  const [year,month]=currentCalendarPeriod();
  if(calendarView==='year')calendarYear=Math.min(year,Math.max(2000,calendarYear+amount));
  else{const index=Math.min(year*12+month-1,Math.max(2000*12,calendarYear*12+calendarMonth-1+amount));calendarYear=Math.floor(index/12);calendarMonth=index%12+1;}
  selectedDay='';await loadCalendar();
}
function libraryEntries(){
  const query=search.trim().toLocaleLowerCase();
  return shelf().entries.filter(book=>(libraryFilter==='all'||libraryFilter==='audio'&&book.kind==='audio'||libraryFilter==='finished'&&book.finished||libraryFilter==='reading'&&book.kind==='book'&&!book.finished&&book.lastRead>0)&&`${book.title}${book.author}`.toLocaleLowerCase().includes(query)).sort((a,b)=>librarySort==='title'?a.title.localeCompare(b.title,'zh-CN'):b.lastRead-a.lastRead||a.title.localeCompare(b.title,'zh-CN'));
}
function libraryBook(book){
  const status=book.kind==='articles'?'文章收藏':book.kind==='audio'?'有声书':book.finished?'已读完':book.progress!=null?`已读 ${book.progress}%`:book.lastRead?'最近读过':'待阅读';
  return `<button class="library-book" data-book="${esc(book.id)}" aria-label="查看《${esc(book.title)}》的阅读详情"><span class="library-cover-stage">${cover(book)}</span><span class="library-book-info"><strong class="library-book-title">${esc(book.title)}</strong><span class="library-book-author">${esc(book.author)}</span><span class="library-book-status ${book.finished?'finished':''}">${book.finished?icon('check'):''}${status}${book.lastRead?`<small>${dateText(book.lastRead).slice(5)}</small>`:''}</span>${book.progress!=null?`<span class="library-progress"><i style="width:${Math.min(100,Math.max(0,book.progress))}%"></i></span>`:''}</span></button>`;
}
function libraryResults(){const entries=libraryEntries();return entries.length?entries.slice(0,libraryLimit).map(libraryBook).join(''):placeholder(search?'没有找到这本书，试试其他关键词。':'当前分类还没有内容。');}
function updateLibrary(){const entries=libraryEntries();document.querySelector('#book-results').innerHTML=libraryResults();document.querySelector('#library-result-count').textContent=`${entries.length} 个条目`;document.querySelector('#library-more').hidden=entries.length<=libraryLimit;}
function library(){
  const s=shelf(),entries=libraryEntries();
  return `${header('YOUR PERSONAL LIBRARY','好书，<span>常在手边。</span>',`${s.electronic} 本电子书${s.audio?` · ${s.audio} 本有声书`:''}${s.articles?` · ${s.articles} 个文章收藏`:''}`)}${dashboard.errors?.shelf?message(dashboard.errors.shelf):''}${heatmap()}<section class="library-collection"><div class="library-section-heading"><h2>我的藏书 <span id="library-result-count">${entries.length} 个条目</span></h2><div class="library-display-controls"><label class="library-sort">排序<select id="library-sort" aria-label="书架排序"><option value="recent" ${librarySort==='recent'?'selected':''}>最近阅读</option><option value="title" ${librarySort==='title'?'selected':''}>书名</option></select></label><div class="segmented layout-toggle" aria-label="书架显示方式"><button data-library-layout="covers" class="${libraryLayout==='covers'?'selected':''}" aria-pressed="${libraryLayout==='covers'}" aria-label="封面视图">${icon('grid')}</button><button data-library-layout="list" class="${libraryLayout==='list'?'selected':''}" aria-pressed="${libraryLayout==='list'}" aria-label="列表视图">${icon('list')}</button></div></div></div><div class="toolbar library-toolbar"><label class="search-field">${icon('search')}<input id="book-search" placeholder="搜索书名或作者" aria-label="搜索书名或作者" value="${esc(search)}"></label><div class="segmented" aria-label="书架分类">${[['all','全部'],['reading','在读'],['finished','已读完'],['audio','有声书']].map(([key,label])=>`<button data-library-filter="${key}" class="${libraryFilter===key?'selected':''}" aria-pressed="${libraryFilter===key}">${label}</button>`).join('')}</div></div><div class="library-grid ${libraryLayout==='list'?'library-list':''}" id="book-results">${libraryResults()}</div><div id="library-more" class="library-more" ${entries.length<=libraryLimit?'hidden':''}><button class="secondary-button" data-action="more-books">再看 48 本 ${icon('plus')}</button></div><p class="subtext library-footnote">最近 5 本电子书已优先同步进度，点击其他书籍查看详情。热力图颜色依据每日时长，缺失记录不计作未阅读。</p></section>`;
}
function notebookCards(){const entries=notebooks().filter(book=>`${book.title}${book.author}`.includes(search.trim()));return entries.length?entries.map(book=>`<button class="notebook-card" data-notebook="${esc(book.id)}">${cover(book)}<span class="notebook-summary"><strong>${esc(book.title)}</strong><span>${number(book.total)} 条笔记</span><small>${book.highlights} 划线 · ${book.thoughts} 想法/点评 · ${book.bookmarks} 书签</small><small>最近记录 ${dateText(book.sort)}</small></span>${icon('chevron')}</button>`).join(''):placeholder('还没有找到相关笔记本。');}
function noteResults(){if(!notebookContent)return '';const content=normalizeNotes(notebookContent.highlights||{},notebookContent.thoughts||{}).filter(note=>(noteFilter==='all'||noteFilter==='saved'&&savedNotes.has(note.id)||note.type===noteFilter)&&`${note.text}${note.abstract}${note.chapter}`.includes(search.trim()));return content.length?content.map(note=>`<article class="note-item">${note.abstract?`<div class="original-excerpt"><small>对应划线</small><blockquote>${esc(note.abstract)}</blockquote></div>`:''}<blockquote>${esc(note.text)}</blockquote><div class="note-meta"><span>${note.type==='highlight'?'划线原文':'我的想法 / 点评'} · ${esc(note.chapter)} · ${dateText(note.timestamp)}</span><button class="icon-button" data-bookmark="${esc(note.id)}" aria-label="${savedNotes.has(note.id)?'取消收藏':'收藏'}这条笔记" aria-pressed="${savedNotes.has(note.id)}">${icon('heart')}</button></div></article>`).join(''):placeholder(noteFilter==='saved'?'收藏的笔记会留在这里，刷新页面后清除。':'当前筛选下没有笔记内容。');}
function notesView(){
  const nb=dashboard.notebooks;
  if(activeNotebook){const book=notebooks().find(b=>b.id===activeNotebook)||bookFor(activeNotebook);return `${header('THOUGHTS WORTH KEEPING',`${esc(book?.title||'阅读笔记')}`,`划线与想法是可查看内容；书签只展示数量。`,'<button class="secondary-button" data-action="notebooks">返回笔记本</button>')}<div class="toolbar"><label class="search-field">${icon('search')}<input id="note-search" placeholder="搜索本书笔记" aria-label="搜索本书笔记" value="${esc(search)}"></label><div class="segmented" aria-label="笔记类型">${[['all','全部'],['highlight','划线'],['thought','想法'],['saved','收藏']].map(([key,label])=>`<button data-note-filter="${key}" class="${noteFilter===key?'selected':''}" aria-pressed="${noteFilter===key}">${label}</button>`).join('')}</div></div>${noteError?message(noteError):''}${(notebookContent?.errors||[]).map(message).join('')}<div id="note-results" class="note-list">${noteLoading?placeholder('正在读取这本书的划线与想法…'):noteResults()}</div>${notebookContent?.thoughts?.hasMore?'<button class="secondary-button load-more" data-action="more-thoughts">继续加载想法</button>':''}`;}
  return `${header('THOUGHTS WORTH KEEPING','读过，也<span>想过。</span>',`累计 ${nb?.totalBookCount??'—'} 本有笔记的书 · ${nb?.totalNoteCount??'—'} 条笔记`)}<div class="note-count-explainer"><span>${icon('pen')}划线</span><b>+</b><span>${icon('sparkles')}想法 / 点评</span><b>+</b><span>${icon('book')}书签</span><span class="note-count-caption">= 笔记总数</span></div>${dashboard.errors?.notebooks?message(dashboard.errors.notebooks):''}<div class="toolbar"><label class="search-field">${icon('search')}<input id="notebook-search" placeholder="搜索已加载的笔记本" aria-label="搜索已加载的笔记本" value="${esc(search)}"></label><span class="subtext">按最近笔记时间排列 · 已加载 ${notebooks().length} 本</span></div><div class="notebook-grid" id="notebook-results">${notebookCards()}</div>${nb?.hasMore?'<button class="secondary-button load-more" data-action="more-notebooks">加载更多笔记本</button>':''}<div class="dialog-notice">选择一本书，分别查看你的划线原文和个人想法。书签计入数量，微信读书 Skill 目前不提供书签内容。</div>`;
}
function discover(){return `${header('FOLLOW YOUR CURIOSITY','下一本，<span>也许在这里。</span>',`${live?'微信读书根据你的阅读记录推荐':'示例推荐 · 连接后由微信读书提供个性化推荐'}`,'<button class="secondary-button" data-action="recommend">刷新推荐</button>')}<div class="discovery-grid">${recommendations?recommendations.map(book=>`<article class="recommendation-card"><button class="recommendation-main" data-book="${esc(book.id)}">${cover(book)}<span><strong>${esc(book.title)}</strong><small>${esc(book.author)}</small><p>${esc(book.reason||book.intro||'推荐理由暂未提供')}</p></span></button>${book.deepLink?hrefLink(book):''}</article>`).join('')||placeholder('当前没有推荐内容。'):placeholder('正在寻找下一本值得翻开的书…')}</div>`;}
function skillsView(){return `${header('MAKE YOUR READING CONNECT','你的 Skills，<span>新的可能。</span>','能力已经就绪，让真实阅读在这里相遇。')}<section class="skill-hero installed-hero"><div><span class="installed-badge">${icon('check')}${skill.installed?'本机已安装':'本机未检测到'} · ${esc(skill.version||'—')}</span><h2>微信读书，已准备好。</h2><p>读取你的阅读统计、书架和笔记，发现阅读节奏与偏好。连接后，示例会替换为你的真实记录。</p></div><button class="primary-button" data-action="connect">${icon('link')}${connected?'管理连接':'连接我的微信读书'}</button></section><article class="panel saved-skill"><span class="skill-mark">${icon('book')}</span><div><h3>WeRead · 微信读书助手</h3><p>Tencent / WeChatReading · ${esc(skill.name||'weread-skills')}</p></div><span class="status-pill ${connected?'connected-pill':''}">${connected?'账号已连接':'等待 API Key'}</span><button class="text-button" data-action="skill-detail">查看 Skill ${icon('chevron')}</button></article><section class="capability-grid">${[['clock','阅读统计','自然周、月、年与全部历史；阅读与收听时长、日均、有效阅读天数。'],['books','书架与进度','电子书、有声书和文章收藏；最近阅读、累计时长与进度。'],['pen','笔记与划线','划线原文、个人想法与点评；书签只统计数量，不导出内容。'],['moon','阅读偏好','24 小时阅读时段、分类与常读作者，随可用数据展示。'],['sparkles','个性化推荐','微信读书根据阅读记录推荐下一本书，保留原始推荐理由。'],['book','书籍详情','查看简介与阅读进度；接口提供跳转链接时，可打开继续阅读。']].map(([i,title,description])=>`<article class="panel capability">${icon(i)}<h2>${title}</h2><p>${description}</p><span class="status-pill">${connected?'已连接':'已具备 · 等待连接'}</span></article>`).join('')}</section><div class="connection-steps"><h2>只差你的阅读账号。</h2><div><span class="step-number">1</span><p>在微信读书的 <a href="https://weread.qq.com/r/weread-skills" target="_blank" rel="noopener noreferrer">Skill 配置页面</a> 复制 API Key。</p></div><div><span class="step-number">2</span><p>点击“连接我的微信读书”，把 Key 粘贴到本地连接面板。</p></div><div><span class="step-number">3</span><p>连接验证通过后，阅读总览、书架和笔记会同步更新。</p></div></div><p class="subtext">Key 只保留在本地服务内存，不写入项目或浏览器存储。停止服务或断开连接后清除。</p>`;}
function render(){
  document.querySelector('#breadcrumb-title').textContent=titles[view];
  document.querySelectorAll('.sidebar [data-view]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  main.innerHTML=({overview,library,notes:notesView,discover,skills:skillsView})[view]();hydrateIcons(main);
  document.querySelector('#shelf-count').textContent=dashboard.shelf?shelf().total:'—';document.querySelector('#notes-count').textContent=dashboard.notebooks?.totalNoteCount??'—';
  document.querySelector('#skill-tag').textContent=statusLoaded?(skill.installed?'已安装':'待安装'):'检测中';
  document.querySelector('#connection-label').textContent=connected?'管理连接':'连接微信读书';
  document.querySelector('#data-badge').innerHTML=`<i></i>${busy?'同步中':sourceLabel()}`;
  document.querySelector('#data-source').textContent=live?`微信读书真实数据 · ${dashboard.syncedAt?new Date(dashboard.syncedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'等待首次同步'}`:`当前展示示例数据 · ${connected?'等待真实数据同步':'尚未连接微信读书'}`;
  document.querySelector('#sidebar-connect-title').textContent=connected?'你的阅读，已连接':'微信读书 Skill';
  document.querySelector('#sidebar-connect-copy').textContent=connected?'同步阅读时长、书架与笔记':`${skill.installed?'本机已安装':'等待安装'} · 等待连接账号`;
  document.querySelector('#sidebar-connect-action').textContent=connected?'管理连接':'连接账号';
}
let toastTimer;function toast(text){const el=document.querySelector('#toast');el.textContent=text;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3500);}
function showDialog(content,eyebrow='阅读空间'){document.querySelector('#dialog-content').innerHTML=content;document.querySelector('#dialog-eyebrow').textContent=eyebrow;hydrateIcons(dialog);if(!dialog.open)dialog.showModal();}
function connectionDialog(){showDialog(`<h2 id="dialog-title">${connected?'你的阅读，已连接':'连接我的微信读书'}</h2><p class="description">微信读书 Skill ${esc(skill.version||'')} 已安装。使用你在微信读书里获取的 API Key，读取自己的阅读记录。</p><form id="connection-form"><label class="field-label" for="api-key">微信读书 API Key</label><div class="key-field"><input type="password" id="api-key" autocomplete="off" spellcheck="false" placeholder="wrk-…" ${connected?'':'required'}><button type="button" class="icon-button" data-action="toggle-key" aria-label="显示 API Key">${icon('info')}</button></div><p class="form-error" id="connection-error" role="alert"></p><div class="dialog-actions">${connected?'<button type="button" class="secondary-button" data-action="disconnect">断开连接</button>':''}<button type="submit" class="primary-button" id="connect-submit">${connected?'更换 Key 并连接':'验证并同步阅读数据'}</button></div></form><div class="dialog-notice">Key 只发送到本机服务，再由服务调用微信读书官方接口。页面不保存 Key，也不会把它写入源码。<a href="https://weread.qq.com/r/weread-skills" target="_blank" rel="noopener noreferrer">前往获取 API Key</a></div>`,'微信读书 · 账号连接');}
async function loadDashboard(refresh=false){const id=++requestId;const nextMode=mode;busy=true;loadError='';render();try{const data=await api(`/api/dashboard?mode=${nextMode}${refresh?'&refresh=1':''}`);if(id!==requestId)return;dashboard=data;if(data.stats&&!data.errors?.stats)categoryCache.set(nextMode,data.stats);if(nextMode==='monthly'&&data.stats){const [year,month]=currentCalendarPeriod();calendarCache.set(`${year}:${month}`,{...data.stats,year,month,errors:[]});}live=true;activeNotebook=null;notebookContent=null;search='';}catch(error){if(id!==requestId)return;loadError=error.message;if(!live){dashboard={mode:nextMode,errors:{stats:error.message}};live=true;}}finally{if(id===requestId){busy=false;render();if(categoryMode!=='follow'&&!categoryCache.has(categoryPeriod())&&!categoryBusy&&!categoryError)loadCategory();if(!calendarCache.has(calendarKey()))loadCalendar();}}}
async function changeMode(next){if(mode===next)return;mode=next;if(categoryMode==='follow'){++categoryRequest;categoryBusy=false;categoryError='';}if(connected){dashboard={mode,errors:{}};await loadDashboard();}else{dashboard=demoDashboard(mode);render();}}
async function openBook(id){const initial=bookFor(id);if(!initial)return;if(initial.kind==='articles'){showDialog(`<h2 id="dialog-title">文章收藏</h2><p class="description">这个条目是微信读书中的文章收藏入口。当前 Skill 不提供收藏文章的具体内容。</p>`,'我的书架');return;}
  const ticket=++detailId;showDialog(`${cover(initial,'book-detail-cover')}<h2 id="dialog-title">${esc(initial.title)}</h2><p class="description">${esc(initial.author)}${live&&initial.kind==='book'?' · 正在同步详情…':''}</p>`,'我的书架');
  let book=initial,errors=[];
  if(live&&book.kind==='book'){try{const result=await api(`/api/book?bookId=${encodeURIComponent(id)}`);if(ticket!==detailId||!dialog.open)return;const updated=normalizeBook({bookId:id,title:initial.title,author:initial.author,...result.info},result.progress);book={...initial,...updated,coverUrl:updated.coverUrl||initial.coverUrl,deepLink:updated.deepLink||initial.deepLink,progress:updated.progress??initial.progress,seconds:updated.seconds??initial.seconds,lastRead:updated.lastRead||initial.lastRead,finished:updated.finished||initial.finished,kind:'book'};errors=result.errors||[];}catch(error){errors=[error.message];}}
  if(ticket!==detailId||!dialog.open)return;
  const nb=notebooks().find(item=>item.id===id);
  showDialog(`${cover(book,'book-detail-cover')}<h2 id="dialog-title">${esc(book.title)}</h2><p class="description">${esc(book.author)}</p><div class="detail-facts"><div><small>阅读进度</small><strong>${book.progress==null?'未提供':`${number(book.progress)}%`}</strong></div><div><small>累计阅读</small><strong>${secondsText(book.seconds)}</strong></div><div><small>累计笔记</small><strong>${nb?`${nb.total} 条`:'未提供'}</strong></div></div>${book.intro?`<p class="detail-note">${esc(book.intro)}</p>`:''}${errors.map(message).join('')}<p class="subtext">最近阅读 · ${dateText(book.lastRead)} · ${sourceLabel()}</p><div class="dialog-actions book-actions">${book.kind==='book'?`<button class="secondary-button" data-notebook="${esc(id)}">查看划线与想法</button>`:''}${hrefLink(book)}</div>`,'我的书架');
}
async function openNotebook(id){dialog.close();activeNotebook=id;noteFilter='all';notebookContent=null;noteLoading=true;noteError='';navTo('notes');const ticket=++detailId;try{const result=live?await api(`/api/notes?bookId=${encodeURIComponent(id)}`):demoNotes(id);if(ticket!==detailId)return;notebookContent=result;}catch(error){if(ticket===detailId)noteError=error.message;}finally{if(ticket===detailId){noteLoading=false;render();}}}
async function loadRecommendations(){try{const result=live?await api('/api/recommendations'):demoRecommendations();recommendations=(result.books||[]).map(book=>({...normalizeBook(book),reason:book.reason||''}));if(view==='discover')render();}catch(error){recommendations=[];if(view==='discover'){render();main.insertAdjacentHTML('beforeend',message(error.message));}}}
document.addEventListener('submit',async event=>{if(event.target.id!=='connection-form')return;event.preventDefault();const button=document.querySelector('#connect-submit'),input=document.querySelector('#api-key'),errorBox=document.querySelector('#connection-error');const value=input.value.trim();if(!value){errorBox.textContent='请输入你的微信读书 API Key。';return;}button.disabled=true;button.textContent='正在验证…';errorBox.textContent='';try{await api('/api/connect',{apiKey:value});input.value='';dialog.close();connected=true;live=true;resetCategory();++calendarRequest;calendarCache.clear();calendarBusy=false;calendarError='';selectedDay='';dashboard={mode,errors:{}};recommendations=null;view='overview';location.hash=view;await loadDashboard();toast(loadError?'连接成功，部分数据等待重试。':'微信读书已连接，阅读数据已同步。');}catch(error){if(errorBox.isConnected)errorBox.textContent=error.message;}finally{if(button.isConnected){button.disabled=false;button.textContent='验证并同步阅读数据';}}});
document.addEventListener('click',async event=>{
  const category=event.target.closest('[data-category]');if(category){selectCategory(Number(category.dataset.category));return;}
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.view)navTo(button.dataset.view);
  if(button.dataset.mode)await changeMode(button.dataset.mode);
  if(button.dataset.book)await openBook(button.dataset.book);
  if(button.dataset.notebook)await openNotebook(button.dataset.notebook);
  if(button.dataset.libraryFilter){libraryFilter=button.dataset.libraryFilter;libraryLimit=48;render();}
  if(button.dataset.libraryLayout){libraryLayout=button.dataset.libraryLayout;render();}
  if(button.dataset.calendarView){calendarView=button.dataset.calendarView;const [year,month]=currentCalendarPeriod();if(calendarYear===year&&calendarMonth>month)calendarMonth=month;selectedDay='';await loadCalendar();}
  if(button.dataset.calendarShift)await shiftCalendar(Number(button.dataset.calendarShift));
  if(button.dataset.day){selectedDay=button.dataset.day;const day=calendarData().days.find(day=>day.date===selectedDay);document.querySelector('#calendar-detail').textContent=dayDescription(day);document.querySelectorAll('[data-day]').forEach(cell=>{const selected=cell.dataset.day===selectedDay;cell.classList.toggle('selected',selected);cell.setAttribute('aria-pressed',selected);cell.tabIndex=selected?0:-1;});}
  if(button.dataset.action==='more-books'){libraryLimit+=48;updateLibrary();}
  if(button.dataset.noteFilter){noteFilter=button.dataset.noteFilter;render();}
  if(button.dataset.bookmark){const id=button.dataset.bookmark;savedNotes.has(id)?savedNotes.delete(id):savedNotes.add(id);document.querySelector('#note-results').innerHTML=noteResults();}
  if(button.classList.contains('bar')||button.classList.contains('hour-bar'))toast(button.getAttribute('aria-label'));
  const action=button.dataset.action;
  if(action==='connect')connectionDialog();
  if(action==='calendar-retry')await loadCalendar(true);
  if(action==='calendar-current'){[calendarYear,calendarMonth]=currentCalendarPeriod();selectedDay='';await loadCalendar();}
  if(action==='category-retry'){if(categoryMode==='follow')await loadDashboard(true);else await loadCategory(true);}
  if(action==='sync'){if(connected){await loadDashboard(true);if(categoryMode!=='follow'&&categoryPeriod()!==mode)await loadCategory(true);await loadCalendar(true);}else toast('当前为示例数据，连接微信读书后可以刷新真实阅读。');}
  if(action==='toggle-key'){const input=document.querySelector('#api-key');input.type=input.type==='password'?'text':'password';button.setAttribute('aria-label',input.type==='password'?'显示 API Key':'隐藏 API Key');}
  if(action==='disconnect'){try{await api('/api/disconnect',{});++requestId;connected=false;live=false;busy=false;resetCategory();++calendarRequest;calendarCache.clear();calendarBusy=false;calendarError='';selectedDay='';dashboard=demoDashboard(mode);activeNotebook=null;notebookContent=null;recommendations=null;loadError='';dialog.close();render();toast('已断开连接，Key 已从本地服务清除。');}catch(error){toast(error.message);}}
  if(action==='notebooks'){++detailId;activeNotebook=null;notebookContent=null;noteError='';search='';render();}
  if(action==='more-notebooks'){const last=dashboard.notebooks.books.at(-1)?.sort;button.disabled=true;try{const page=await api(`/api/notebooks?cursor=${encodeURIComponent(last)}`);const known=new Set(dashboard.notebooks.books.map(book=>book.bookId));const additions=(page.books||[]).filter(book=>!known.has(book.bookId));if(page.hasMore&&!additions.length)throw new Error('分页位置没有推进，请稍后重新同步。');dashboard.notebooks={...page,books:[...dashboard.notebooks.books,...additions]};render();}catch(error){toast(error.message);button.disabled=false;}}
  if(action==='more-thoughts'){const previous=notebookContent.thoughts;const id=activeNotebook;button.disabled=true;try{const page=await api(`/api/notes?bookId=${encodeURIComponent(id)}&cursor=${previous.synckey}`);if(id!==activeNotebook)return;if(page.thoughts.hasMore&&page.thoughts.synckey===previous.synckey)throw new Error('分页位置没有推进，请稍后重试。');const known=new Set(previous.reviews.map(r=>r.review?.reviewId));notebookContent.thoughts={...page.thoughts,reviews:[...previous.reviews,...(page.thoughts.reviews||[]).filter(r=>!known.has(r.review?.reviewId))]};render();}catch(error){toast(error.message);button.disabled=false;}}
  if(action==='recommend'){recommendations=null;render();await loadRecommendations();}
  if(action==='skill-detail'){showDialog('<h2 id="dialog-title">微信读书 Skill</h2><p class="description">正在读取本机安装的说明…</p>','已安装的 Skill');try{const result=await api('/api/skill');if(dialog.open)showDialog(`<h2 id="dialog-title">WeRead · ${esc(result.version||'')}</h2><p class="description">本机安装的 SKILL.md · <a href="${esc(skill.source)}" target="_blank" rel="noopener noreferrer">腾讯仓库</a></p><pre class="skill-source">${esc(result.markdown||'未找到安装文件。')}</pre>`,'已安装的 Skill');}catch(error){toast(error.message);}}
});
document.addEventListener('input',event=>{if(['book-search','notebook-search','note-search'].includes(event.target.id)){search=event.target.value;if(event.target.id==='book-search'){libraryLimit=48;updateLibrary();}if(event.target.id==='notebook-search')document.querySelector('#notebook-results').innerHTML=notebookCards();if(event.target.id==='note-search')document.querySelector('#note-results').innerHTML=noteResults();}});
document.addEventListener('keydown',event=>{
  const cell=event.target.closest('[data-day]');if(!cell||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  event.preventDefault();const cells=[...document.querySelectorAll('[data-day]:not(:disabled)')];const index=cells.indexOf(cell);
  const step=calendarView==='year'?{ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1}:{ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
  const next=event.key==='Home'?0:event.key==='End'?cells.length-1:Math.min(cells.length-1,Math.max(0,index+step[event.key]));cells[next]?.focus();cells[next]?.click();
});
document.addEventListener('change',async event=>{if(event.target.id==='category-range'){categoryMode=event.target.value;await loadCategory();}if(event.target.id==='library-sort'){librarySort=event.target.value;libraryLimit=48;updateLibrary();}});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(titles[next]&&next!==view)navTo(next);});
document.querySelector('#dialog-close').addEventListener('click',()=>{++detailId;dialog.close();});
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom){++detailId;dialog.close();}}});
hydrateIcons();render();
try{const result=await api('/api/status');skill=result.skill;connected=result.connected;statusLoaded=true;if(connected){live=true;dashboard={mode,errors:{}};await loadDashboard();}else render();if(view==='discover')await loadRecommendations();}catch(error){statusLoaded=true;loadError=error.message;render();toast('本地服务无法读取安装状态，请确认服务已更新。');}
