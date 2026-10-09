export const modeLabels={weekly:'本周',monthly:'本月',annually:'本年',overall:'全部'};
export const secondsText=value=>value==null||!Number.isFinite(Number(value))?'未提供':`${Math.floor(Number(value)/3600)} 小时 ${Math.floor(Number(value)%3600/60)} 分钟`;
export const dateText=value=>!value?'未提供':new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Number(value)*1000));
export function safeUrl(value,deepLink=false){try{const url=new URL(value);return (deepLink?['https:','weread:','wereadapp:']:['https:']).includes(url.protocol)?url.href:'';}catch{return '';}}
export function normalizeBook(raw={},progress=null,kind='book'){
  const p=progress?.book;
  return {id:String(raw.bookId??raw.albumId??''),title:raw.title||raw.name||'未命名内容',author:raw.author||raw.authorName||'作者未提供',coverUrl:safeUrl(raw.cover),category:typeof raw.category==='string'?raw.category:'',progress:p?.progress!=null?Number(p.progress):null,finished:raw.finishReading===1||(p?.progress===100&&Boolean(p?.finishTime)),seconds:p?.recordReadingTime??null,lastRead:p?.updateTime||raw.readUpdateTime||0,deepLink:safeUrl(raw.deepLink,true),kind,isTop:raw.isTop===1,intro:raw.intro||''};
}
export function normalizeShelf(raw={},progress={}){
  const books=(raw.books||[]).map(book=>normalizeBook(book,progress[book.bookId]));
  const albums=(raw.albums||[]).map(album=>({...normalizeBook(album.albumInfo,null,'audio'),lastRead:album.albumInfoExtra?.lectureReadUpdateTime||0,isTop:album.albumInfoExtra?.isTop===1}));
  const hasArticles=raw.mp!=null&&typeof raw.mp==='object'&&Object.keys(raw.mp).length>0;
  const articles=hasArticles?[{id:'article-collection',title:'文章收藏',author:'微信读书中的文章收藏入口',kind:'articles',progress:null,lastRead:0,coverUrl:'',deepLink:'',finished:false,seconds:null,category:''}]:[];
  return {entries:[...books,...albums,...articles],total:books.length+albums.length+articles.length,electronic:books.length,audio:albums.length,articles:articles.length};
}
export function normalizeNotebook(raw){return {...normalizeBook({...raw.book,bookId:raw.bookId}),highlights:Number(raw.noteCount||0),thoughts:Number(raw.reviewCount||0),bookmarks:Number(raw.bookmarkCount||0),total:Number(raw.noteCount||0)+Number(raw.reviewCount||0)+Number(raw.bookmarkCount||0),sort:raw.sort,finished:raw.markedStatus===1,progress:raw.readingProgress??null};}
export function normalizeStats(raw,mode){
  if(!raw)return null;
  const buckets=Object.entries(raw.readTimes||{}).map(([stamp,seconds])=>({timestamp:Number(stamp),seconds:Number(seconds)})).sort((a,b)=>a.timestamp-b.timestamp);
  const slots=Array.isArray(raw.preferTime)?raw.preferTime.map((seconds,i)=>({hour:(i+6)%24,seconds:Number(seconds)})).sort((a,b)=>a.hour-b.hour):[];
  const categories=(raw.preferCategory||[]).filter(c=>Number(c.readingTime)>0||Number(c.readingCount)>0).map(c=>({title:c.categoryTitle||c.parentCategoryTitle||'其他',seconds:Number.isFinite(Number(c.readingTime))&&Number(c.readingTime)>=0?Number(c.readingTime):null,weight:Number(c.val),count:c.readingCount!=null&&Number.isFinite(Number(c.readingCount))&&Number(c.readingCount)>=0?Number(c.readingCount):null}));
  const ranking=(raw.readLongest||[]).map(item=>({...normalizeBook(item.book||item.albumInfo,null,item.albumInfo?'audio':'book'),seconds:item.readTime,tags:item.tags||[]}));
  return {mode,buckets,total:raw.totalReadTime??null,average:raw.dayAverageReadTime??null,days:raw.readDays??null,compare:raw.compare??null,summary:raw.readStat||[],slots,categories,ranking,timeWord:raw.preferTimeWord||'',categoryWord:raw.preferCategoryWord||'',authors:raw.preferAuthor||[],readingRate:raw.readRate??null,readingSeconds:raw.wrReadTime??null,listeningSeconds:raw.wrListenTime??null};
}

export function categoryDistribution(categories=[]){
  const byCount=categories.length>0&&categories.every(category=>category.count!=null&&Number.isFinite(category.count)&&category.count>=0)&&categories.some(category=>category.count>0);
  const basis=byCount?'count':'time';
  const entries=categories.map(category=>({...category,value:byCount?category.count:category.seconds})).filter(category=>Number.isFinite(category.value)&&category.value>0).sort((a,b)=>b.value-a.value);
  const total=entries.reduce((sum,category)=>sum+category.value,0);
  return {basis,total,entries:entries.map(category=>({...category,share:category.value/total*100}))};
}
export function normalizeNotes(highlights={},thoughts={}){
  const chapters=new Map((highlights.chapters||[]).map(c=>[c.chapterUid,c.title]));
  return [...(highlights.updated||[]).filter(n=>n.type===1).map(n=>({id:`highlight:${n.bookmarkId}`,type:'highlight',text:n.markText||'',abstract:'',timestamp:n.createTime||0,chapter:chapters.get(n.chapterUid)||'',deepLink:safeUrl(n.deepLink,true)})),...(thoughts.reviews||[]).map(item=>{const r=item.review||{};return {id:`thought:${r.reviewId||item.reviewId}`,type:'thought',text:r.content||'',abstract:r.abstract||'',timestamp:r.createTime||0,chapter:r.chapterName||chapters.get(r.chapterUid)||'',deepLink:safeUrl(r.deepLink||item.deepLink,true)};})].sort((a,b)=>b.timestamp-a.timestamp);
}

// A missing daily record is unknown, never an invented zero-minute day.
export function buildReadingMonth(raw,now=new Date()){
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const prefix=raw?.baseTime?dateText(raw.baseTime).slice(0,7):today.slice(0,7);
  const [year,month]=prefix.split('-').map(Number);
  const values=new Map();
  for(const [stamp,value] of Object.entries(raw?.dailyReadTimes||raw?.readTimes||{})){
    const seconds=Number(value);
    if(!Number.isFinite(Number(stamp))||value==null||!Number.isFinite(seconds)||seconds<0)continue;
    const date=dateText(Number(stamp));
    if(date.startsWith(prefix))values.set(date,(values.get(date)||0)+seconds);
  }
  const days=Array.from({length:new Date(Date.UTC(year,month,0)).getUTCDate()},(_,i)=>{
    const date=`${prefix}-${String(i+1).padStart(2,'0')}`;
    const seconds=date>today?null:values.get(date)??null;
    return {date,day:i+1,seconds,state:date>today?'future':seconds==null?'unknown':seconds===0?'empty':'read',level:seconds>3600?4:seconds>1800?3:seconds>900?2:seconds>0?1:0};
  });
  let streak=0,longest=0;
  for(const day of days){streak=day.seconds>=60?streak+1:0;longest=Math.max(longest,streak);}
  return {year,month,days,longest,activeDays:days.filter(day=>day.seconds>=60).length,knownDays:days.filter(day=>day.seconds!=null).length,best:days.filter(day=>day.seconds>0).sort((a,b)=>b.seconds-a.seconds)[0]||null};
}

export function buildReadingYear(raw,now=new Date(),year=raw?.year||Number(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric'}).format(now))){
  // Annual readTimes contains MONTH buckets. Only genuine daily detail is accepted.
  const days=Array.from({length:12},(_,i)=>buildReadingMonth({baseTime:Date.UTC(year,i,15)/1000,dailyReadTimes:raw?.dailyReadTimes||{}},now).days).flat();
  const offset=(new Date(Date.UTC(year,0,1)).getUTCDay()+6)%7;
  const weekCount=Math.ceil((offset+days.length)/7);
  const slots=Array.from({length:weekCount*7},(_,i)=>days[i-offset]||null);
  const months=days.filter(day=>day.day===1).map(day=>({month:Number(day.date.slice(5,7)),week:Math.floor((offset+days.indexOf(day))/7)}));
  let streak=0,longest=0;
  for(const day of days){streak=day.seconds>=60?streak+1:0;longest=Math.max(longest,streak);}
  return {year,days,slots,weekCount,months,longest,activeDays:days.filter(day=>day.seconds>=60).length,knownDays:days.filter(day=>day.seconds!=null).length,best:days.filter(day=>day.seconds>0).sort((a,b)=>b.seconds-a.seconds)[0]||null};
}
