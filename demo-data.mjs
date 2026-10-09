const anchor=1791518400; // 2026-10-09 12:00 Asia/Shanghai; fixed demonstration date.
const titles=['被讨厌的勇气','原子习惯','也许你该找个人聊聊','悉达多','人生海海','置身事内','蛤蟆先生去看心理医生','小王子'];
const authors=['岸见一郎 · 古贺史健','詹姆斯·克利尔','洛莉·戈特利布','赫尔曼·黑塞','麦家','兰小欢','罗伯特·戴博德','安托万·德·圣埃克苏佩里'];
const categories=['心理与自我','习惯与成长','心理与自我','文学与人生','文学与人生','社会与经济','心理与自我','文学与人生'];
const allBooks=titles.map((title,i)=>({bookId:`demo-${i}`,title,author:authors[i],category:categories[i],readUpdateTime:anchor-i*86400,finishReading:i>5?1:0,isTop:i===0?1:0}));
export const demoThoughts=[
  '把注意力从他人的评价，放回自己真正想做的事。',
  '把读书接在睡前洗漱之后。一个明确的小动作，比一个宏大的目标更容易开始。',
  '在解决问题之前，先练习认真听见自己的感受。',
  '知识可以传递，体验却需要自己经历。阅读之外，也要给生活留一点空间。',
  '试着从一个人完整的经历去理解他，而不是只看一个瞬间。',
  '把抽象的经济概念放进具体的地方和人的选择里，更容易理解。',
  '对情绪负责，不是责备自己，而是开始识别它来自哪里。',
  '那些重复投入的时间，往往就是关系和习惯的意义。',
];
export function demoDashboard(mode='monthly'){
  const n={weekly:5,monthly:9,annually:10,overall:4}[mode];
  const readTimes=Object.fromEntries(Array.from({length:n},(_,i)=>{let date;if(mode==='annually')date=Date.UTC(2026,i,1)-28800000;else if(mode==='overall')date=Date.UTC(2023+i,0,1)-28800000;else date=(anchor-(n-1-i)*86400)*1000;return [Math.floor(date/1000),mode==='annually'?18000+i*4100:mode==='overall'?190000+i*40000:[2880,3780,2220,3120,4260,2580,3900,2040,3300][i]];}));
  const totalReadTime=Object.values(readTimes).reduce((a,b)=>a+b,0);
  const preferTime=Array.from({length:24},(_,i)=>(i+6)%24===21?18000:(i+6)%24===22?6200:(i+6)%24===12?2900:0);
  return {mode,syncedAt:'2026-10-09T04:00:00.000Z',errors:{},stats:{readTimes,totalReadTime,dayAverageReadTime:totalReadTime/({weekly:5,monthly:9,annually:282,overall:1300}[mode]),readDays:{weekly:5,monthly:9,annually:159,overall:726}[mode],compare:mode==='overall'?undefined:.11,readStat:[{stat:'读过',counts:'8本'},{stat:'读完',counts:'2本'},{stat:'笔记',counts:'12条'}],preferTime,preferTimeWord:'偏好夜间阅读',preferCategoryWord:'偏好阅读心理学',preferCategory:[{categoryTitle:'心理与自我',readingTime:totalReadTime*.44,val:1,readingCount:3},{categoryTitle:'文学与人生',readingTime:totalReadTime*.28,val:.64,readingCount:3},{categoryTitle:'习惯与成长',readingTime:totalReadTime*.19,val:.43,readingCount:1},{categoryTitle:'社会与经济',readingTime:totalReadTime*.09,val:.2,readingCount:1}],readLongest:allBooks.slice(0,4).map((book,i)=>({book,readTime:Math.floor(totalReadTime*[.26,.22,.19,.15][i]),tags:i===0?['笔记最多']:[]})),preferAuthor:[{name:'赫尔曼·黑塞',count:2,readTime:'5小时30分钟'}],readRate:82,wrReadTime:totalReadTime*.82,wrListenTime:totalReadTime*.18},shelf:{books:allBooks,albums:[{albumInfo:{albumId:'demo-audio',name:'人类简史',authorName:'尤瓦尔·赫拉利'},albumInfoExtra:{lectureReadUpdateTime:anchor-86400}}],mp:{name:'文章收藏'}},progress:Object.fromEntries(allBooks.slice(0,5).map((book,i)=>[book.bookId,{book:{progress:[68,32,45,81,24][i],recordReadingTime:10740+i*2700,updateTime:book.readUpdateTime}}])),notebooks:{totalBookCount:8,totalNoteCount:42,hasMore:0,books:allBooks.map((book,i)=>({bookId:book.bookId,book,noteCount:i<2?4:3,reviewCount:1,bookmarkCount:1,readingProgress:[68,32,45,81,24,16,100,100][i],markedStatus:book.finishReading,sort:anchor-i*86400}))}};
}
export function demoNotes(id){const i=Number(id.split('-')[1])||0;return {highlights:{updated:[{type:1,bookmarkId:`${id}-1`,markText:'这是一条用于展示排版的示例划线，连接账号后会替换为你真实标注的原文。',createTime:anchor,chapterUid:1}],chapters:[{chapterUid:1,title:'第一章'}]},thoughts:{reviews:[{review:{reviewId:`${id}-2`,content:demoThoughts[i],abstract:'',createTime:anchor-1800,chapterName:'我的想法'}}],hasMore:0,synckey:0},errors:[]};}
export function demoRecommendations(){return {books:allBooks.slice(0,4).map((book,i)=>({...book,reason:['从认识自己开始','让小习惯慢慢生长','换一个角度理解情绪','在文字里寻找自己的节奏'][i],intro:demoThoughts[i]}))};}

export function demoCalendar(year,month=null){
  const dailyReadTimes={};
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let totalReadTime=0;
  for(let m=month||1;m<=(month||12);m++)for(let day=1;day<=new Date(Date.UTC(year,m,0)).getUTCDate();day++){
    const date=`${year}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    if(date>today)continue;
    const seed=day*13+m*7;
    const seconds=seed%6===0?0:[420,1080,1620,2640,4380,6600][seed%6];
    dailyReadTimes[Date.parse(`${date}T00:00:00+08:00`)/1000]=seconds;totalReadTime+=seconds;
  }
  return {year,month,baseTime:Date.UTC(year,(month||1)-1,15)/1000,dailyReadTimes,totalReadTime,errors:[],source:'demo'};
}
