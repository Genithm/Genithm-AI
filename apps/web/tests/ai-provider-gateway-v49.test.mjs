import test from "node:test";
import assert from "node:assert/strict";
import { configuredProviders, gatewayLimits, streamFromProviders, reasoningEffort } from "../lib/ai-provider-gateway.ts";

const env={ GEMINI_API_KEY:"fixture-google",GROQ_API_KEY:"fixture-groq" };
const providers=()=>configuredProviders(env);
const limits={ firstOutputMs:350, idleMs:350, totalMs:2500 };
const payload=()=>({messages:[{role:"user",content:"synthetic harmless test"}]});
const enc=new TextEncoder();
const frame=x=>"data: "+JSON.stringify(x)+"\n\n";
const chunk=(content,model)=>frame({model,choices:[{delta:{content}}]});
const end=(reason="stop")=>frame({choices:[{delta:{},finish_reason:reason}]})+"data: [DONE]\n\n";
function reply(data){return new Response(new ReadableStream({start(c){c.enqueue(enc.encode(data));c.close();}}),{headers:{"content-type":"text/event-stream"}});}
const read=r=>new Response(r.body).text();

test("exactly Gemini primary and Groq secondary with no legacy environment fallback",()=>{
 const [g,r]=configuredProviders({...env,OPENROUTER_API_KEY:"legacy",DEEPSEEK_API_KEY:"legacy"});
 assert.equal(g.name,"gemini");assert.equal(r.name,"groq");
 assert.equal(g.model,"gemini-3.8-flash");assert.equal(r.model,"openai/gpt-oss-120b");
 assert.match(g.endpoint,/generativelanguage.googleapis.com/);assert.match(r.endpoint,/api.groq.com/);
 assert.throws(()=>configuredProviders({OPENROUTER_API_KEY:"old"}),/GEMINI_API_KEY/);
 assert.equal(configuredProviders({GEMINI_API_KEY:"g"})[1],null);
 assert.equal(configuredProviders({...env,GENITHM_GROQ_MODEL:"llama-3.3-70b-versatile"})[1].model,"openai/gpt-oss-120b");
 assert.equal(configuredProviders({...env,GENITHM_GROQ_MODEL:"custom/available-model"})[1].model,"custom/available-model");
});

test("reasoning protects evidence and invalid overrides fail closed",()=>{
 assert.equal(reasoningEffort({},true),"medium");
 assert.equal(reasoningEffort({}),"low");
 assert.throws(()=>reasoningEffort({GENITHM_GEMINI_REASONING_EFFORT:"none"}),/reasoning effort/);
 assert.throws(()=>gatewayLimits({GENITHM_AI_TOTAL_TIMEOUT_MS:"not-a-number"}),/integer/);
});

test("successful Gemini streamed answer retains model metadata",async()=>{
 let count=0;
 const stream=await streamFromProviders(providers(),payload,{limits,fetcher:async(_url,options)=>{
   count++; assert.equal(options.redirect,"error");
   assert.equal(options.headers.Authorization,"Bearer fixture-google");
   return reply(chunk("Answer","gemini-3.8-flash")+end());
 }});
 assert.match(await read(stream),/Answer/);
 assert.equal(stream.provider,"gemini");assert.equal(stream.model,"gemini-3.8-flash");
 assert.equal(stream.fallbackUsed,false);assert.equal(count,1);
});

test("HTTP 503 falls back exactly once with a separate Groq credential",async()=>{
 let count=0;
 const stream=await streamFromProviders(providers(),payload,{limits,fetcher:async(_url,options)=>{
   count++;
   if(count===1)return new Response("private error message",{status:503});
   assert.equal(options.headers.Authorization,"Bearer fixture-groq");
   return reply(chunk("Recovered","openai/gpt-oss-120b")+end());
 }});
 assert.match(await read(stream),/Recovered/);
 assert.equal(stream.provider,"groq");assert.equal(stream.fallbackUsed,true);assert.equal(count,2);
});

test("images cannot fall back to a text-only model",async()=>{
 let count=0;
 await assert.rejects(streamFromProviders(providers(),payload,{hasImages:true,limits,fetcher:async()=>{
   count++;return new Response("",{status:503});
 }}),/text-only/);
 assert.equal(count,1);
});

test("partial streamed output is never silently accepted as complete",async()=>{
 let count=0;
 const stream=await streamFromProviders(providers(),payload,{limits,fetcher:async()=>{
   count++;return reply(chunk("Incomplete","gemini-3.8-flash"));
 }});
 await assert.rejects(read(stream),/completion/);
 assert.equal(count,1);
});

test("truncated output is rejected and is not passed off as complete",async()=>{
 const stream=await streamFromProviders(providers(),payload,{limits,fetcher:async()=>reply(chunk("Incomplete","gemini-3.8-flash")+end("length"))});
 await assert.rejects(read(stream),/truncated/);
});

test("approval tool call is still only a proposal and rejects unsupported second call",async()=>{
 const tool=frame({choices:[{delta:{tool_calls:[{index:0,id:"tool1",type:"function",function:{name:"propose_scientific_action",arguments:'{"summary":"propose"}'}}]}}]});
 const stream=await streamFromProviders(providers(),payload,{limits,fetcher:async()=>reply(tool+end("tool_calls"))});
 assert.match(await read(stream),/propose_scientific_action/);
 await assert.rejects(streamFromProviders(providers(),payload,{limits,fetcher:async()=>reply(frame({choices:[{delta:{tool_calls:[{index:1,function:{name:"bad"}}]}}]})+end("tool_calls"))}),/one scientific/);
});

test("unauthorized external endpoints cannot receive credentials",async()=>{
 const list=providers();
 list[0].endpoint="https://untrusted.example/api";
 await assert.rejects(streamFromProviders(list,payload,{fetcher:async()=>{throw Error("do not call");}}),/Unapproved/);
});

test("user cancellation blocks fallback",async()=>{
 const stop=new AbortController();
 let calls=0;
 await assert.rejects(streamFromProviders(providers(),payload,{limits,signal:stop.signal,fetcher:async()=>{
   calls++;stop.abort();return reply(chunk("No","gemini-3.8-flash")+end());
 }}),{name:"AbortError"});
 assert.equal(calls,1);
});

test("V50 non-streaming responses are cancelled before fallback",async()=>{
 let cancelled=false,calls=0;
 const stream=await streamFromProviders(providers(),payload,{limits,fetcher:async()=>{
   if(++calls===1)return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{"content-type":"application/json"}});
   return reply(chunk("Recovered","openai/gpt-oss-120b")+end());
 }});
 await read(stream);
 assert.equal(cancelled,true);assert.equal(calls,2);
});

test("V50 first-output timeout cancels primary before starting secondary",async()=>{
 let firstAborted=false,calls=0;
 const stream=await streamFromProviders(providers(),payload,{limits:{firstOutputMs:20,idleMs:250,totalMs:1000},fetcher:async(_url,options)=>{
   if(++calls===1){options.signal.addEventListener("abort",()=>{firstAborted=true;});return new Response(new ReadableStream({}),{headers:{"content-type":"text/event-stream"}});}
   return reply(chunk("Fallback","openai/gpt-oss-120b")+end());
 }});
 assert.match(await read(stream),/Fallback/);
 assert.equal(firstAborted,true);assert.equal(stream.fallbackUsed,true);assert.equal(calls,2);
});

test("V50 UTF8 fragments and CRLF frames survive stream normalization",async()=>{
 const bytes=enc.encode((chunk("DNA \u03b1","gemini-3.8-flash")+end()).replaceAll("\n","\r\n"));
 const source=new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}});
 const stream=await streamFromProviders(providers(),payload,{limits,fetcher:async()=>new Response(source,{headers:{"content-type":"text/event-stream"}})});
 assert.match(await read(stream),/DNA \u03b1/);
});

test("V50 incomplete scientific tool arguments never imply a completed action",async()=>{
 const data=frame({choices:[{delta:{tool_calls:[{index:0,id:"t",function:{name:"propose_scientific_action",arguments:'{"summary":'}}]}}]});
 const stream=await streamFromProviders(providers(),payload,{limits,fetcher:async()=>reply(data)});
 await assert.rejects(read(stream),/completion/);
});


test("V53 distinguish Gemini primary failure from Groq backup 404 without leaking upstream bodies",async()=>{
 let calls=0;
 await assert.rejects(
  streamFromProviders(providers(),payload,{limits,fetcher:async(_url,options)=>{
   calls++;
   if(calls===1)return new Response("SECRET_GEMINI_ERROR",{status:429});
   assert.equal(options.headers.Authorization,"Bearer fixture-groq");
   return new Response("SECRET_GROQ_ERROR",{status:404});
  }}),
  error=>{
   assert.match(error.message,/Both AI providers failed/);
   assert.match(error.message,/gemini API request failed \(HTTP 429/);
   assert.match(error.message,/groq API request failed \(HTTP 404/);
   assert.doesNotMatch(error.message,/SECRET_/);
   return true;
  });
 assert.equal(calls,2);
});

test("V53 Gemini HTTP 400 preserves its cause and does not bypass it with Groq",async()=>{
 let calls=0;
 await assert.rejects(streamFromProviders(providers(),payload,{limits,fetcher:async()=>{
   calls++; return new Response("private upstream error",{status:400});
 }}),/gemini API request failed \(HTTP 400: request format or model feature rejected/);
 assert.equal(calls,1);
});

test("V53 research-safe default Gemini timeout permits longer model thinking",()=>{
 const defaults=gatewayLimits({});
 assert.equal(defaults.firstOutputMs,20000);
 assert.equal(defaults.idleMs,20000);
 assert.equal(defaults.totalMs,90000);
});
