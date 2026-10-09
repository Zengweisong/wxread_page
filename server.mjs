import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createWeReadClient, collectDashboard, readInstalledSkill, WeReadError, MODES } from './weread.mjs';
import { collectReadingCalendar, validateCalendarPeriod } from './calendar-service.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const files=new Map([['/','index.html'],...['index.html','styles.css','app.js','icons.mjs','reading-model.mjs','demo-data.mjs'].map(name=>[`/${name}`,name])]);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8'};
const skill=await readInstalledSkill();
let apiKey=process.env.WEREAD_API_KEY||'';
let generation=0;
const cache=new Map();
const client=()=>createWeReadClient({apiKey,version:skill.version});
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function requestBody(req){let text='';for await(const chunk of req){text+=chunk.toString();if(Buffer.byteLength(text)>8192)throw new WeReadError('输入内容过长。','BAD_INPUT',413);}try{return JSON.parse(text);}catch{throw new WeReadError('请求内容无法读取。','BAD_INPUT',400);}}
function stringId(url){const id=url.searchParams.get('bookId');if(!id||id.length>150)throw new WeReadError('请选择有效的书籍。','BAD_INPUT',400);return id;}
function cursorValue(url){const cursor=url.searchParams.get('cursor');if(cursor==null)return undefined;const n=Number(cursor);if(!Number.isSafeInteger(n)||n<0)throw new WeReadError('分页位置无效。','BAD_INPUT',400);return n;}
const server=http.createServer(async(req,res)=>{
  try{
    const host=req.headers.host;
    if(!['127.0.0.1:5173','localhost:5173'].includes(host)){json(res,403,{message:'此服务只接受本机访问。'});return;}
    const url=new URL(req.url,`http://${host}`);
    if(url.pathname.startsWith('/api/')){
      if((req.headers.origin&&req.headers.origin!==`http://${host}`)||req.headers['sec-fetch-site']==='cross-site'){json(res,403,{message:'不允许跨站读取阅读数据。'});return;}
      if(req.method==='GET'&&url.pathname==='/api/status'){json(res,200,{skill:{installed:skill.installed,name:skill.name,version:skill.version,source:skill.source},connected:Boolean(apiKey)});return;}
      if(req.method==='GET'&&url.pathname==='/api/skill'){json(res,200,{...skill});return;}
      if(req.method==='POST'&&url.pathname==='/api/connect'){
        if(!req.headers['content-type']?.startsWith('application/json'))throw new WeReadError('请求格式无效。','BAD_INPUT',415);
        const body=await requestBody(req);const candidate=typeof body?.apiKey==='string'?body.apiKey.trim():'';
        if(!/^wrk-[A-Za-z0-9_-]{12,200}$/.test(candidate))throw new WeReadError('请输入以 wrk- 开头的微信读书 API Key。','BAD_KEY',400);
        const candidateClient=createWeReadClient({apiKey:candidate,version:skill.version});await candidateClient.stats('monthly');
        apiKey=candidate;generation++;cache.clear();json(res,200,{connected:true});return;
      }
      if(req.method==='POST'&&url.pathname==='/api/disconnect'){apiKey='';generation++;cache.clear();json(res,200,{connected:false});return;}
      if(req.method==='GET'&&url.pathname==='/api/dashboard'){
        const mode=url.searchParams.get('mode')||'monthly';if(!MODES.includes(mode))throw new WeReadError('统计周期无效。','BAD_MODE',400);
        const cached=cache.get(mode);if(cached&&Date.now()-cached.time<120000&&url.searchParams.get('refresh')!=='1'){json(res,200,cached.data);return;}
        const requestGeneration=generation;const data=await collectDashboard(client(),mode);
        if(generation!==requestGeneration)throw new WeReadError('连接已改变，请重新同步。','CONNECTION_CHANGED',409);
        cache.set(mode,{time:Date.now(),data});json(res,200,data);return;
      }
      if(req.method==='GET'&&url.pathname==='/api/notebooks'){json(res,200,await client().notebooks(cursorValue(url)));return;}
      if(req.method==='GET'&&url.pathname==='/api/calendar'){
        const year=Number(url.searchParams.get('year')),month=url.searchParams.has('month')?Number(url.searchParams.get('month')):null;
        validateCalendarPeriod({year,month});
        const key=`calendar:${year}:${month||'year'}`,cached=cache.get(key);
        if(cached&&Date.now()-cached.time<120000&&url.searchParams.get('refresh')!=='1'){json(res,200,cached.data);return;}
        const requestGeneration=generation,data=await collectReadingCalendar(client(),{year,month});
        if(generation!==requestGeneration)throw new WeReadError('连接已改变，请重新同步。','CONNECTION_CHANGED',409);
        cache.set(key,{time:Date.now(),data});json(res,200,data);return;
      }
      if(req.method==='GET'&&url.pathname==='/api/book'){
        const id=stringId(url);const current=client();const results=await Promise.allSettled([current.info(id),current.progress(id)]);
        for(const result of results)if(result.status==='rejected'&&result.reason.code==='UPGRADE_REQUIRED')throw result.reason;
        if(results.every(r=>r.status==='rejected'))throw results[0].reason;
        json(res,200,{info:results[0].status==='fulfilled'?results[0].value:null,progress:results[1].status==='fulfilled'?results[1].value:null,errors:results.filter(r=>r.status==='rejected').map(r=>r.reason.message)});return;
      }
      if(req.method==='GET'&&url.pathname==='/api/notes'){
        const id=stringId(url);const current=client();const cursor=cursorValue(url);
        if(cursor!=null){json(res,200,{thoughts:await current.thoughts(id,cursor)});return;}
        const outcomes=await Promise.allSettled([current.highlights(id),current.thoughts(id)]);
        for(const result of outcomes)if(result.status==='rejected'&&result.reason.code==='UPGRADE_REQUIRED')throw result.reason;
        if(outcomes.every(r=>r.status==='rejected'))throw outcomes[0].reason;
        json(res,200,{highlights:outcomes[0].status==='fulfilled'?outcomes[0].value:null,thoughts:outcomes[1].status==='fulfilled'?outcomes[1].value:null,errors:outcomes.filter(r=>r.status==='rejected').map(r=>r.reason.message)});return;
      }
      if(req.method==='GET'&&url.pathname==='/api/recommendations'){json(res,200,await client().recommendations());return;}
      json(res,404,{message:'未找到此功能。'});return;
    }
    const filename=files.get(url.pathname);if(!filename||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end('Not found');return;}
    const body=await readFile(path.join(root,filename));res.writeHead(200,{'Content-Type':types[path.extname(filename)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:body);
  }catch(error){json(res,error instanceof WeReadError?error.status:500,{code:error instanceof WeReadError?error.code:'INTERNAL_ERROR',message:error instanceof WeReadError?error.message:'本地服务暂时无法完成请求。'});}
});
server.listen(5173,'127.0.0.1',()=>console.log('阅迹 preview: http://127.0.0.1:5173'));
