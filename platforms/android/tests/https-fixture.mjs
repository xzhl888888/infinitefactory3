import https from 'node:https';
import fs from 'node:fs';
const directory=process.argv[2];
const hits=[];
const groups = new Map();
const card={name:'测试火山',emoji:'🌋',category:'自然',description:'只用于本机协议测试。'};
const envelope=JSON.stringify({choices:[{message:{content:JSON.stringify(card)},finish_reason:'stop'}]});
const server=https.createServer({pfx:fs.readFileSync(`${directory}/localhost.p12`),passphrase:'wxgc3-fixture-only'},(request,response)=>{
  let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
    hits.push({path:request.url,method:request.method,fixtureAuthenticated:request.headers.authorization==='Bearer fixture-not-real',body:JSON.parse(body||'{}')});fs.writeFileSync(`${directory}/network-hits.json`,JSON.stringify(hits));
    if(request.url.startsWith('/redirect/')){response.writeHead(302,{location:`https://127.0.0.1:${server.address().port}/trap/chat/completions`});response.end();return;}
    if(request.url.startsWith('/unauthorized/')){response.writeHead(401);response.end('fixture-sensitive-error-body');return;}
    if(request.url.startsWith('/large/')){response.writeHead(200,{'content-length':2*1024*1024});response.end('{}');return;}
    if(request.url.startsWith('/invalid/')){response.end('{invalid');return;}
    if(request.url.startsWith('/delay/')){const timer=setTimeout(()=>response.end(envelope),30000);response.on('close',()=>clearTimeout(timer));return;}
    if (request.url.startsWith('/parallel/') || request.url.startsWith('/parallel-cancel/')) {
      const group = request.url.startsWith('/parallel-cancel/') ? 'cancel' : 'complete';
      const waiting = groups.get(group) || [];
      waiting.push({ path: request.url, response });
      groups.set(group, waiting);
      if (waiting.length === 4) {
        if (group === 'cancel') fs.writeFileSync(`${directory}/cancel-ready.txt`, 'ready');
        [...waiting].reverse().forEach((item, index) => {
          const delayedCancel = group === 'cancel' && item.path.includes('/cancel-me/');
          const timer = setTimeout(() => item.response.end(envelope), delayedCancel ? 30000 : index * 20);
          item.response.on('close', () => clearTimeout(timer));
        });
      }
      return;
    }
    response.writeHead(200,{'content-type':'application/json'});response.end(envelope);
  });
});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(`${directory}/network-port.txt`,String(server.address().port)));
