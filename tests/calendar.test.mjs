import test from 'node:test';
import assert from 'node:assert/strict';
import { collectReadingCalendar,validateCalendarPeriod } from '../calendar-service.mjs';
import { buildReadingYear,dateText } from '../reading-model.mjs';
import { createWeReadClient,WeReadError } from '../weread.mjs';
const now=new Date('2026-10-09T12:00:00+08:00');
const time=date=>Date.parse(`${date}T00:00:00+08:00`)/1000;

test('year calendar handles leap years, week padding, cross-month streaks and unknown annual buckets',()=>{
  const calendar=buildReadingYear({dailyReadTimes:{[time('2024-01-31')]:60,[time('2024-02-01')]:120,[time('2024-02-02')]:180}},now,2024);
  assert.equal(calendar.days.length,366);assert.equal(calendar.longest,3);assert.equal(calendar.activeDays,3);
  assert.equal(calendar.days[0].date,'2024-01-01');assert.equal(calendar.days.at(-1).date,'2024-12-31');
  assert.equal(calendar.months.length,12);assert.equal(calendar.slots.length%7,0);
  const sunday=buildReadingYear({},now,2012);assert.equal(sunday.weekCount,54);assert.equal(sunday.slots[6].date,'2012-01-01');assert.equal(sunday.slots[0],null);
  assert.equal(buildReadingYear({readTimes:{[time('2026-01-01')]:99000}},now,2026).knownDays,0);
});

test('year view uses genuine annual daily details without unnecessary month queries',async()=>{
  const calls=[];const result=await collectReadingCalendar({stats:async mode=>{calls.push(mode);return {baseTime:time('2026-01-01'),dailyReadTimes:{[time('2026-01-02')]:120},totalReadTime:9000};}},{year:2026},now);
  assert.deepEqual(calls,['annually']);assert.equal(result.totalReadTime,9000);assert.equal(result.source,'annual-daily');
});

test('year fallback queries only elapsed months with bounded concurrency and preserves partial failure',async()=>{
  let running=0,max=0;const months=[];
  const client={stats:async(mode,baseTime)=>{
    if(mode==='annually')return {baseTime:time('2026-01-01'),readTimes:{[time('2026-01-01')]:99999},totalReadTime:50000};
    const month=Number(dateText(baseTime).slice(5,7));months.push(month);running++;max=Math.max(max,running);await new Promise(resolve=>setTimeout(resolve,2));running--;
    if(month===3)throw new Error('该月暂时不可用');
    const date=`2026-${String(month).padStart(2,'0')}-01`;
    return {baseTime:time(date),readTimes:{[time(date)]:month*60},totalReadTime:month*60};
  }};
  const result=await collectReadingCalendar(client,{year:2026},now);
  assert.deepEqual(months.sort((a,b)=>a-b),[1,2,3,4,5,6,7,8,9,10]);assert.ok(max<=3);assert.ok(max>1);
  assert.equal(result.totalReadTime,50000);assert.equal(Object.keys(result.dailyReadTimes).length,9);assert.equal(result.errors[0].month,3);
  assert.equal(buildReadingYear(result,now,2026).days.find(day=>day.date==='2026-03-01').state,'unknown');
});

test('historical monthly request retains baseTime and rejects mismatched periods',async()=>{
  const calls=[];const client=createWeReadClient({apiKey:'test-key',version:'1.0.4',fetcher:async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({totalReadTime:0,readTimes:{}})};}});
  await client.stats('monthly',time('2025-12-15'));assert.equal(calls[0].baseTime,time('2025-12-15'));
  await assert.rejects(collectReadingCalendar({stats:async()=>({baseTime:time('2026-10-01'),readTimes:{}})},{year:2025,month:12},now),error=>error.code==='PERIOD_MISMATCH');
});

test('invalid periods and skill upgrades stop rather than becoming empty calendars',async()=>{
  for(const period of [{year:2027},{year:2026,month:11},{year:2026,month:0},{year:2026,month:1.5},{year:1999}])assert.throws(()=>validateCalendarPeriod(period,now),error=>error.code==='BAD_INPUT');
  await assert.rejects(collectReadingCalendar({stats:async()=>{throw new WeReadError('升级','UPGRADE_REQUIRED');}},{year:2026},now),error=>error.code==='UPGRADE_REQUIRED');
});

test('an upgrade during month fallback stops scheduling further account requests',async()=>{
  let calls=0;
  const client={stats:async mode=>{if(mode==='annually')return {totalReadTime:0};calls++;if(calls===1)throw new WeReadError('升级','UPGRADE_REQUIRED');await new Promise(resolve=>setTimeout(resolve,2));return {totalReadTime:0,readTimes:{}};}};
  await assert.rejects(collectReadingCalendar(client,{year:2026},now),error=>error.code==='UPGRADE_REQUIRED');
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(calls,3);
});
