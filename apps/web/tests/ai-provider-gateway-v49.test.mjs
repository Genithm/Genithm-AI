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
 assert.equal(g.model,"gemini-3.8-flash");assert.equal(r.model,"llama-3.3-70b-versatile");
 assert.match(g.endpoint,/generativelanguage.googleapis.com/);assert.match(r.endpoint,/api.groq.com/);
 assert.throws(()=>configuredProviders({OPENROUTER_API_KEY:"old"}),/GEMINI_API_KEY/);
 assert.equal(configuredProviders({GEMINI_API_KEY:"g"})[1],null);
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
   return reply(chunk("Recovered","llama-3.3-70b-versatile")+end());
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
