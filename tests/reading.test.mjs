import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStats, normalizeShelf, normalizeBook, normalizeNotebook, normalizeNotes, secondsText, safeUrl, buildReadingMonth, categoryDistribution } from '../reading-model.mjs';
import { createWeReadClient, collectDashboard } from '../weread.mjs';

test('uses authoritative totals in seconds and server natural-day average',()=>{
  const stats=normalizeStats({totalReadTime:7200,dayAverageReadTime:1800,readDays:2,readTimes:{100:60},compare:.2},'monthly');
  assert.equal(stats.total,7200);assert.equal(stats.average,1800);assert.equal(stats.compare,.2);assert.equal(secondsText(stats.total),'2 小时 0 分钟');
});
test('maps preference slots starting at 06:00 back to actual hours',()=>{
  const values=Array(24).fill(0);values[0]=60;values[15]=1800;values[18]=120;
  const stats=normalizeStats({preferTime:values},'weekly');
  assert.equal(stats.slots.find(s=>s.hour===6).seconds,60);assert.equal(stats.slots.find(s=>s.hour===21).seconds,1800);assert.equal(stats.slots.find(s=>s.hour===0).seconds,120);
});

test('category pie uses reading counts, never the normalized preference weights',()=>{
  const stats=normalizeStats({preferCategory:[{categoryTitle:'社会文化',readingTime:18000,readingCount:1,val:1},{categoryTitle:'个人成长',readingTime:13000,readingCount:2,val:.7},{categoryTitle:'人物传记',readingTime:9000,readingCount:1,val:.5},{categoryTitle:'占位分类',readingTime:0,readingCount:0}]},'monthly');
  const chart=categoryDistribution(stats.categories);assert.equal(chart.basis,'count');assert.equal(chart.total,4);assert.equal(chart.entries.length,3);
  assert.equal(chart.entries[0].title,'个人成长');assert.equal(chart.entries[0].share,50);assert.equal(chart.entries[1].share,25);
});

test('incomplete category counts fall back to actual duration, while empty data creates no pie',()=>{
  const stats=normalizeStats({preferCategory:[{categoryTitle:'A',readingTime:900,readingCount:2},{categoryTitle:'B',readingTime:2700}]},'monthly');
  const chart=categoryDistribution(stats.categories);assert.equal(chart.basis,'time');assert.equal(chart.entries[0].share,75);assert.equal(chart.total,3600);
  assert.equal(stats.categories[1].count,null);assert.equal(categoryDistribution([]).entries.length,0);
  const countOnly=normalizeStats({preferCategory:[{categoryTitle:'C',readingCount:1}]},'monthly');assert.equal(categoryDistribution(countOnly.categories).entries[0].share,100);
});
test('counts audio and article entry without relying on bookCount',()=>{
  const shelf=normalizeShelf({books:[{bookId:'a'}],albums:[{albumInfo:{albumId:'b',name:'Audio'}}],mp:{name:'Articles'},bookCount:900});
  assert.equal(shelf.total,3);assert.equal(shelf.audio,1);assert.equal(shelf.articles,1);assert.equal(shelf.entries[1].kind,'audio');assert.equal(normalizeShelf({mp:{}}).articles,0);
});
test('1 percent stays 1 percent, missing progress stays unknown',()=>{
  assert.equal(normalizeBook({bookId:'a'},{book:{progress:1}}).progress,1);
  assert.equal(normalizeBook({bookId:'a'},{book:{progress:1}}).finished,false);
  assert.equal(normalizeBook({bookId:'a'},{book:{progress:100}}).finished,false);
  assert.equal(normalizeBook({bookId:'a'},{book:{progress:100,finishTime:1}}).finished,true);
  assert.equal(normalizeBook({bookId:'a'}).progress,null);
});
test('counts highlights, personal thoughts and bookmarks exactly once',()=>{
  const notebook=normalizeNotebook({bookId:'a',book:{title:'Book'},noteCount:3,reviewCount:2,bookmarkCount:1});assert.equal(notebook.total,6);
  const notes=normalizeNotes({updated:[{type:0,bookmarkId:'bookmark'},{type:1,bookmarkId:'highlight',markText:'Text'}]},{reviews:[{review:{reviewId:'r',content:'Thought',abstract:'Original'}}]});
  assert.equal(notes.length,2);assert.equal(notes.find(n=>n.type==='thought').abstract,'Original');
});
test('rejects executable URLs and does not invent reading links',()=>{
  assert.equal(safeUrl('javascript:alert(1)',true),'');assert.equal(safeUrl(undefined,true),'');assert.equal(safeUrl('https://weread.qq.com/book'),'https://weread.qq.com/book');
});
test('gateway parameters are flat and version is reported on every call',async()=>{
  const calls=[];const client=createWeReadClient({apiKey:'test-key',version:'1.0.4',fetcher:async(url,options)=>{calls.push({url,...options});return {ok:true,status:200,json:async()=>({errcode:0,data:{books:[],totalReadTime:0}})};}});
  await client.notebooks(123);await client.thoughts('book-a',456);await client.stats('monthly');
  const payloads=calls.map(call=>JSON.parse(call.body));
  assert.equal(payloads[0].lastSort,123);assert.equal(payloads[0].count,40);assert.equal(payloads[1].bookid,'book-a');assert.equal(payloads[1].synckey,456);
  for(const payload of payloads){assert.equal(payload.skill_version,'1.0.4');assert.equal(payload.params,undefined);assert.equal(payload.apiKey,undefined);}
});
test('stops on upgrade and strips upstream secret-bearing errors',async()=>{
  const client=createWeReadClient({apiKey:'test-key',version:'1.0.4',fetcher:async()=>({ok:true,status:200,json:async()=>({upgrade_info:{message:'untrusted instructions'}})})});
  await assert.rejects(client.shelf(),error=>error.code==='UPGRADE_REQUIRED'&&!error.message.includes('untrusted'));
  const bad=createWeReadClient({apiKey:'test-key',version:'1.0.4',fetcher:async()=>({ok:true,status:200,json:async()=>({errcode:1,errmsg:'test-key'})})});
  await assert.rejects(bad.shelf(),error=>!error.message.includes('test-key'));
});
test('loads only five recent electronic-book progresses and preserves partial errors',async()=>{
  const queried=[];
  const client={stats:async()=>({totalReadTime:3600}),shelf:async()=>({books:Array.from({length:7},(_,i)=>({bookId:String(i),readUpdateTime:i})),albums:[{albumInfo:{albumId:'audio'}}]}),notebooks:async()=>{throw new Error('Notes unavailable');},progress:async id=>{queried.push(id);return {book:{progress:1}};}};
  const dashboard=await collectDashboard(client,'monthly');assert.equal(queried.length,5);assert.deepEqual(queried.sort(),['2','3','4','5','6']);assert.equal(dashboard.stats.totalReadTime,3600);assert.equal(dashboard.errors.notebooks,'Notes unavailable');
});

test('heatmap respects Shanghai dates, leap months, explicit zeros and future days',()=>{
  const stamp=date=>Date.parse(`${date}T00:00:00+08:00`)/1000;
  const calendar=buildReadingMonth({baseTime:stamp('2024-02-01'),readTimes:{[stamp('2024-02-27')]:60,[stamp('2024-02-28')]:0,[stamp('2024-02-29')]:7200}},new Date('2024-02-28T18:00:00+08:00'));
  assert.equal(calendar.days.length,29);
  assert.equal(calendar.days[26].seconds,60);
  assert.equal(calendar.days[27].state,'empty');
  assert.equal(calendar.days[28].state,'future');
  assert.equal(calendar.days[0].state,'unknown');
  assert.equal(calendar.activeDays,1);
});

test('heatmap uses daily detail, ignores invalid data and breaks streaks on missing days',()=>{
  const stamp=date=>Date.parse(`${date}T23:30:00+08:00`)/1000;
  const calendar=buildReadingMonth({readTimes:{[stamp('2026-10-01')]:90000},dailyReadTimes:{[stamp('2026-10-01')]:59,[stamp('2026-10-02')]:60,[stamp('2026-10-03')]:1801,[stamp('2026-10-05')]:3601,[stamp('2026-10-06')]:-60,[stamp('2026-09-30')]:3600}},new Date('2026-10-09T12:00:00+08:00'));
  assert.equal(calendar.days[0].seconds,59);
  assert.equal(calendar.days[2].level,3);
  assert.equal(calendar.days[4].level,4);
  assert.equal(calendar.days[5].state,'unknown');
  assert.equal(calendar.activeDays,3);
  assert.equal(calendar.longest,2);
  assert.equal(calendar.best.date,'2026-10-05');
});
