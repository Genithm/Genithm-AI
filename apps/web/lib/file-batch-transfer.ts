/** Bounded multipart transfer. File bytes go only to scoped storage URLs. */
export type Api = <T>(path:string, body?:unknown, method?:string)=>Promise<T>;
export type FileSession = {id:string;state:string;expected_bytes:number;expected_sha256:string;part_bytes?:number;
 relative_path?:string;batch_id?:string;intake_mode?:string;error_code?:string|null;parts?:{number:number;size:number}[]};
export type BatchSource = {file:File;path:string;requestId:string;uploadId?:string};
export type TransferOptions = {project:string;batchId:string;mode:"auto"|"preserve";source:BatchSource;api:Api;
 signal:AbortSignal;hash:(file:File,signal:AbortSignal,onBytes:(n:number)=>void)=>Promise<string>;
 progress:(phase:string,n:number)=>void;session:(value:FileSession)=>void;put?:typeof fetch};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sourcePath(file:Pick<File,"name">&{webkitRelativePath?:string}):string {
 const path=file.webkitRelativePath||file.name;
 const clean=(value:string,max:number)=>value.length>0&&value.length<=max&&value===value.trim()&&!/[\p{Cc}\p{Cf}\p{Cs}\\:]/u.test(value);
 if(!clean(file.name,255)||file.name.includes("/")||[".",".."].includes(file.name)||!clean(path,1024)||path.startsWith("/")||path.split("/").at(-1)!==file.name||path.split("/").some(p=>!clean(p,255)||[".",".."].includes(p)))
  throw new Error("A file has an unsafe name or relative path. Rename it before uploading.");
 return path;
}

export function planBatch(files:File[],maximum:number):BatchSource[] {
 if(!files.length||files.length>100)throw new Error("Choose between 1 and 100 files per batch.");
 const seen=new Set<string>();
 return files.map(file=>{
  const path=sourcePath(file);
  if(!Number.isSafeInteger(file.size)||file.size<1||file.size>maximum)throw new Error("Empty files and files above the project limit cannot be uploaded.");
  if(seen.has(path))throw new Error("Two selected files have the same relative path. Choose a folder or separate batches.");
  seen.add(path);return {file,path,requestId:crypto.randomUUID()};
 });
}

export function pendingParts(source:File,session:FileSession):{numbers:number[];confirmed:number;chunk:number} {
 const chunk=session.part_bytes;
 if(chunk!==64*1024**2)throw new Error("Unexpected server part size; no bytes were sent.");
 const total=Math.ceil(source.size/chunk),done=new Set<number>();let confirmed=0;
 for(const part of session.parts||[]){
  if(!Number.isInteger(part.number)||part.number<1||part.number>total||done.has(part.number)||part.size!==Math.min(chunk,source.size-(part.number-1)*chunk))
   throw new Error("Remote part geometry mismatch; refresh server status.");
  done.add(part.number);confirmed+=part.size;
 }
 return {chunk,confirmed,numbers:Array.from({length:total},(_,i)=>i+1).filter(n=>!done.has(n))};
}

export async function transferFile(options:TransferOptions):Promise<FileSession> {
 const {source,api,signal,progress}=options;
 const check=()=>{if(signal.aborted)throw new DOMException("Transfer paused","AbortError");};
 check();progress("Hashing complete source",0);
 const sha=await options.hash(source.file,signal,n=>progress("Hashing complete source",n));check();
 if(!/^[a-f0-9]{64}$/.test(sha))throw new Error("Invalid source fingerprint.");
 let session=source.uploadId?await api<FileSession>("/uploads/"+source.uploadId):await api<FileSession>("/files",{
  project_id:options.project,batch_id:options.batchId,request_id:source.requestId,filename:source.file.name,
  relative_path:source.path,expected_bytes:source.file.size,expected_sha256:sha,mode:options.mode});
 // Keep the reservation identity even if the user paused while metadata was in flight.
 if(!UUID.test(session.id))throw new Error("Invalid upload identity returned by the server.");
 options.session(session);check();
 if(session.expected_bytes!==source.file.size||session.expected_sha256!==sha||session.relative_path!==source.path||session.batch_id!==options.batchId||session.intake_mode!==options.mode)
  throw new Error("This is not the exact source and metadata of the reserved upload. No parts were sent.");
 if(["uploaded","verifying","ready"].includes(session.state))return session;
 if(session.state!=="uploading")throw new Error("Server state: "+session.state+". Refresh before retrying; do not create a duplicate.");
 const reservedId=session.id;
 session=await api<FileSession>("/uploads/"+reservedId);check();
 if(session.id!==reservedId||session.relative_path!==source.path||session.batch_id!==options.batchId||session.intake_mode!==options.mode||session.expected_sha256!==sha||session.expected_bytes!==source.file.size||session.state!=="uploading")throw new Error("Upload state changed; refresh before retrying.");
 const parts=pendingParts(source.file,session);let next=0,confirmed=parts.confirmed;
 progress("Uploading confirmed bytes",confirmed);
 const local=new AbortController();const stop=()=>local.abort();signal.addEventListener("abort",stop,{once:true});
 let firstError:unknown;
 const checkPart=()=>{check();if(local.signal.aborted)throw new DOMException("Peer transfer stopped","AbortError");};
 async function runner(){
  try{
   while(next<parts.numbers.length){
    checkPart();const number=parts.numbers[next++];
    const signed=await api<{url:string;bytes:number;headers:Record<string,string>}>("/uploads/"+session.id+"/parts/"+number,{});
    checkPart();const start=(number-1)*parts.chunk,expected=Math.min(parts.chunk,source.file.size-start);
    if(signed.bytes!==expected)throw new Error("Signed part length does not match the source.");
    const response=await (options.put||fetch)(signed.url,{method:"PUT",headers:signed.headers,
     body:source.file.slice(start,start+expected),signal:local.signal,credentials:"omit",referrerPolicy:"no-referrer"});
    if(!response.ok)throw new Error("Storage did not confirm a part. Resume to reconcile received parts.");
    confirmed+=expected;progress("Uploading confirmed bytes",confirmed);
   }
  }catch(error){firstError??=error;local.abort();throw error;}
 }
 try{
  await Promise.allSettled([runner(),runner()]);check();if(firstError)throw firstError;
 }finally{signal.removeEventListener("abort",stop);}
 progress("Finalizing; scientific verification is separate",confirmed);
 const result=await api<FileSession>("/uploads/"+session.id+"/complete",{});options.session(result);check();
 if(result.id!==reservedId||result.expected_sha256!==sha||result.expected_bytes!==source.file.size||!["uploaded","verifying","ready"].includes(result.state))throw new Error("Completion is not confirmed. Refresh before retrying.");
 return result;
}
