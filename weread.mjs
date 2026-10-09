import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const GATEWAY = 'https://i.weread.qq.com/api/agent/gateway';
export const MODES = ['weekly', 'monthly', 'annually', 'overall'];
export class WeReadError extends Error {
  constructor(message, code = 'UPSTREAM_ERROR', status = 502) { super(message); this.code = code; this.status = status; }
}
export async function readInstalledSkill() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  try {
    const markdown = await readFile(path.join(home, 'skills', 'weread', 'SKILL.md'), 'utf8');
    return { installed:true,name:'weread-skills',version:markdown.match(/^version:\s*(.+)$/m)?.[1]?.trim() || null,source:'https://github.com/Tencent/WeChatReading',markdown };
  } catch { return { installed:false,name:'weread-skills',version:null,source:'https://github.com/Tencent/WeChatReading',markdown:'' }; }
}
export function createWeReadClient({ apiKey, version, fetcher = fetch }) {
  if (!version) throw new WeReadError('请先安装微信读书 Skill。', 'SKILL_MISSING', 503);
  async function call(apiName, parameters = {}) {
    if (!apiKey) throw new WeReadError('请先连接微信读书账号。', 'KEY_REQUIRED', 428);
    let response;
    try { response = await fetcher(GATEWAY,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({...parameters,api_name:apiName,skill_version:version}),signal:AbortSignal.timeout(20000)}); }
    catch { throw new WeReadError('微信读书暂时无法连接，请稍后重试。','NETWORK_ERROR'); }
    if ([401,403].includes(response.status)) throw new WeReadError('API Key 未通过验证，请检查或重新生成。','KEY_INVALID',401);
    if (!response.ok) throw new WeReadError('微信读书服务暂时不可用，请稍后重试。');
    let result;try { result=await response.json(); } catch { throw new WeReadError('微信读书返回了无法读取的数据。'); }
    if (!result || typeof result!=='object' || Array.isArray(result)) throw new WeReadError('微信读书返回的数据格式无法识别。');
    if (result.upgrade_info || result.data?.upgrade_info) throw new WeReadError('微信读书要求升级 Skill，请先更新安装再同步。','UPGRADE_REQUIRED',409);
    if (result.errcode!=null && Number(result.errcode)!==0) throw new WeReadError('微信读书未完成请求，请检查 API Key 或稍后重试。','API_ERROR',400);
    const data=result.data && typeof result.data==='object' ? result.data : result;
    if (data.errcode!=null && Number(data.errcode)!==0) throw new WeReadError('微信读书未完成请求，请检查 API Key 或稍后重试。','API_ERROR',400);
    return data;
  }
  return {
    stats:async(mode,baseTime=0)=>{if(!MODES.includes(mode))throw new WeReadError('请选择有效的统计周期。','BAD_MODE',400);if(!Number.isSafeInteger(baseTime)||baseTime<0)throw new WeReadError('统计日期无效。','BAD_INPUT',400);const result=await call('/readdata/detail',{mode,baseTime:mode==='overall'?0:baseTime});if(!['totalReadTime','readTimes','readDays','readStat'].some(field=>field in result))throw new WeReadError('未收到可识别的阅读统计，请检查连接或稍后重试。','INVALID_RESPONSE');return result;},
    shelf:()=>call('/shelf/sync'),notebooks:cursor=>call('/user/notebooks',{count:40,...(cursor!=null?{lastSort:cursor}:{})}),
    info:bookId=>call('/book/info',{bookId}),progress:bookId=>call('/book/getprogress',{bookId}),highlights:bookId=>call('/book/bookmarklist',{bookId}),
    thoughts:(bookId,cursor=0)=>call('/review/list/mine',{bookid:bookId,count:50,synckey:cursor}),recommendations:()=>call('/book/recommend',{count:8,maxIdx:0}),
  };
}
export async function collectDashboard(client,mode) {
  const outcomes=await Promise.allSettled([client.stats(mode),client.shelf(),client.notebooks()]);
  for(const result of outcomes)if(result.status==='rejected'&&result.reason.code==='UPGRADE_REQUIRED')throw result.reason;
  if(outcomes.every(result=>result.status==='rejected'))throw outcomes[0].reason;
  const names=['stats','shelf','notebooks'];const payload={mode,syncedAt:new Date().toISOString(),errors:{},progress:{}};
  outcomes.forEach((result,index)=>{if(result.status==='fulfilled')payload[names[index]]=result.value;else payload.errors[names[index]]=result.reason.message;});
  const recent=[...(payload.shelf?.books||[])].sort((a,b)=>(b.readUpdateTime||0)-(a.readUpdateTime||0)).slice(0,5);
  const progress=await Promise.allSettled(recent.map(book=>client.progress(String(book.bookId))));
  progress.forEach((result,index)=>{if(result.status==='fulfilled')payload.progress[recent[index].bookId]=result.value;else payload.errors[`progress:${recent[index].bookId}`]=result.reason.message;});
  const upgrade=progress.find(result=>result.status==='rejected'&&result.reason.code==='UPGRADE_REQUIRED');if(upgrade)throw upgrade.reason;
  return payload;
}
