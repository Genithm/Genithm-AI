import {StreamingSha256} from "@/lib/streaming-sha256";
const scope=globalThis as unknown as {onmessage:((event:MessageEvent<File>)=>void)|null;postMessage:(value:unknown)=>void};
scope.onmessage=async(event)=>{
  try{
    const file=event.data;
    if(!(file instanceof File)||file.size<1||file.size>100*1024**3)throw new Error("Invalid source file");
    const hash=new StreamingSha256();const chunk=4*1024**2;
    for(let start=0;start<file.size;start+=chunk){
      hash.update(new Uint8Array(await file.slice(start,start+chunk).arrayBuffer()));
      scope.postMessage({bytes:Math.min(start+chunk,file.size)});
    }
    scope.postMessage({sha256:hash.hex()});
  }catch{scope.postMessage({error:"Could not fingerprint the selected file."});}
};
