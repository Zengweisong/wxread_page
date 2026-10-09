import { dateText } from './reading-model.mjs';
import { WeReadError } from './weread.mjs';

const stamp=(year,month=1)=>Date.parse(`${year}-${String(month).padStart(2,'0')}-15T12:00:00+08:00`)/1000;
const fatal=error=>['UPGRADE_REQUIRED','KEY_INVALID','KEY_REQUIRED','SKILL_MISSING'].includes(error.code);
export function validateCalendarPeriod({year,month=null},now=new Date()){
  const current=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const [currentYear,currentMonth]=current.split('-').map(Number);
  if(!Number.isInteger(year)||year<2000||year>currentYear||month!=null&&(!Number.isInteger(month)||month<1||month>12||year===currentYear&&month>currentMonth))throw new WeReadError('请选择有效的历史月份或年份。','BAD_INPUT',400);
  return {currentYear,currentMonth};
}
function dailyRecords(raw,prefix,annual=false){
  const result={};
  for(const [time,value] of Object.entries(raw.dailyReadTimes||(annual?{}:raw.readTimes)||{})){
    if(value==null||!Number.isFinite(Number(time))||!Number.isFinite(Number(value))||Number(value)<0)continue;
    if(dateText(Number(time)).startsWith(prefix))result[time]=Number(value);
  }
  return result;
}
export async function collectReadingCalendar(client,{year,month=null},now=new Date()){
  const {currentYear,currentMonth}=validateCalendarPeriod({year,month},now);
  const baseTime=stamp(year,month||1),prefix=month?`${year}-${String(month).padStart(2,'0')}`:String(year);
  async function readMonth(value){
    const raw=await client.stats('monthly',stamp(year,value));
    if(raw.baseTime&&dateText(raw.baseTime).slice(0,7)!==`${year}-${String(value).padStart(2,'0')}`)throw new WeReadError('微信读书未返回所选月份的数据。','PERIOD_MISMATCH');
    return raw;
  }
  if(month){const raw=await readMonth(month);return {...raw,year,month,baseTime,dailyReadTimes:dailyRecords(raw,prefix),errors:[],source:'monthly',syncedAt:now.toISOString()};}
  let annual=null;
  try{annual=await client.stats('annually',baseTime);if(annual.baseTime&&Number(dateText(annual.baseTime).slice(0,4))!==year)throw new WeReadError('微信读书未返回所选年份的数据。','PERIOD_MISMATCH');}
  catch(error){if(fatal(error))throw error;annual=null;}
  const daily=annual?dailyRecords(annual,prefix,true):{};
  if(Object.keys(daily).length)return {year,month:null,baseTime,dailyReadTimes:daily,totalReadTime:annual.totalReadTime??null,readDays:annual.readDays??null,errors:[],source:'annual-daily',syncedAt:now.toISOString()};
  const limit=year===currentYear?currentMonth:12;
  const results=Array(limit);let next=1,stopped=false;
  // Three concurrent month requests, never a burst of twelve account calls.
  await Promise.all(Array.from({length:Math.min(3,limit)},async()=>{
    while(!stopped&&next<=limit){const value=next++;try{results[value-1]={month:value,raw:await readMonth(value)};}catch(error){if(fatal(error)){stopped=true;throw error;}results[value-1]={month:value,error};}}
  }));
  const errors=results.filter(result=>result.error).map(result=>({month:result.month,message:result.error.message}));
  if(errors.length===limit&&!annual)throw results[0].error;
  for(const result of results)if(result.raw)Object.assign(daily,dailyRecords(result.raw,`${year}-${String(result.month).padStart(2,'0')}`));
  // Preserve authoritative annual totals; never use daily buckets as a substitute.
  const complete=errors.length===0&&results.every(result=>result.raw.totalReadTime!=null);
  return {year,month:null,baseTime,dailyReadTimes:daily,totalReadTime:annual?.totalReadTime??(complete?results.reduce((sum,result)=>sum+Number(result.raw.totalReadTime),0):null),readDays:annual?.readDays??null,errors,source:'monthly-detail',syncedAt:now.toISOString()};
}
