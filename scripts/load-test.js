#!/usr/bin/env node
const argv = process.argv;

function usage(){
  console.log('Usage: node load-test.js -n <total> -c <concurrency> <url>');
  process.exit(1);
}

let n=20, c=2, url=null;
for(let i=2;i<argv.length;i++){
  if(argv[i]==='-n'){ n=parseInt(argv[++i],10); continue; }
  if(argv[i]==='-c'){ c=parseInt(argv[++i],10); continue; }
  url = argv[i];
}
if(!url) usage();

  // encode '|' to avoid shell/URL issues
  url = url.replace(/\|/g, '%7C');

const { spawn } = await import('child_process');

async function doRequest(u){
  const t0 = Date.now();
  return new Promise((resolve) => {
    const proc = spawn('curl.exe', ['-sS', u]);
    proc.on('error', (err)=> resolve({ error: String(err), time: Date.now()-t0 }));
    proc.on('close', (code)=>{
      if(code===0) resolve(Date.now()-t0);
      else resolve({ error: `curl_exit_${code}`, time: Date.now()-t0 });
    });
  });
}

async function run(){
  const results = [];
  let inFlight = 0;
  let started = 0;

  return new Promise((resolve)=>{
    function next(){
      while(inFlight < c && started < n){
        started++; inFlight++;
        doRequest(url).then(r=>{
          results.push(r);
          inFlight--;
          if(results.length===n) resolve(results);
          else next();
        });
      }
    }
    next();
  });
}

(async ()=>{
  console.log(`Sending ${n} requests to ${url} with concurrency ${c}`);
  const res = await run();
  const errors = res.filter(r => r && r.error);
  const times = res.filter(r => typeof r === 'number');
  if(times.length){
    times.sort((a,b)=>a-b);
    const sum = times.reduce((s,v)=>s+v,0);
    const avg = sum / times.length;
    const p50 = times[Math.floor(times.length*0.5)];
    const p90 = times[Math.floor(times.length*0.9)];
    const p95 = times[Math.floor(times.length*0.95)];
    const p99 = times[Math.floor(times.length*0.99)];
    console.log(`Requests OK: ${times.length}, Errors: ${errors.length}`);
    console.log(`avg=${avg.toFixed(0)}ms p50=${p50}ms p90=${p90}ms p95=${p95}ms p99=${p99}ms`);
  } else {
    console.log('No successful requests');
  }
  if(errors.length){
    console.log('Some errors (showing up to 5):');
    console.log(errors.slice(0,5));
  }
})();
