import {createClient} from 'npm:@supabase/supabase-js@2.118.0';

const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Cache-Control':'no-store'
};
const maxBytes=10*1024*1024;
const json=(error:string,status:number)=>Response.json({error},{status,headers:cors});

function safeUrl(input:string):URL {
  let url:URL;
  try {url=new URL(input)} catch {throw new Error('Enter a valid image or GIF link.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use a public http:// or https:// image link.');
  const host=url.hostname.toLowerCase();
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.onion')||host.startsWith('[')||/^\d+(\.\d+){3}$/.test(host))throw new Error('Use a public image link.');
  return url;
}
function mediaType(bytes:Uint8Array):string {
  const chars=(start:number,end:number)=>String.fromCharCode(...bytes.slice(start,end));
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
  if(bytes[0]===0x89&&chars(1,4)==='PNG')return 'image/png';
  if(chars(0,3)==='GIF')return 'image/gif';
  if(chars(0,4)==='RIFF'&&chars(8,12)==='WEBP')return 'image/webp';
  if(chars(4,12)==='ftypavif'||chars(4,12)==='ftypavis')return 'image/avif';
  throw new Error('The link must return a JPG, PNG, GIF, WebP, or AVIF image.');
}
async function imageBytes(input:string):Promise<{bytes:Uint8Array;type:string}> {
  let url=safeUrl(input);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try {
    for(let redirects=0;redirects<=5;redirects++) {
      const response=await fetch(url,{redirect:'manual',signal:controller.signal,headers:{accept:'image/avif,image/webp,image/gif,image/png,image/jpeg,image/*'}});
      if(response.status>=300&&response.status<400){
        const location=response.headers.get('location');
        if(!location)throw new Error('The image link redirected without a destination.');
        url=safeUrl(new URL(location,url).href);
        continue;
      }
      if(!response.ok)throw new Error(`Image source returned HTTP ${response.status}.`);
      const length=Number(response.headers.get('content-length'));
      if(length>maxBytes)throw new Error('The image must be under 10 MB.');
      if(!response.body)throw new Error('The image source returned no data.');
      const reader=response.body.getReader();
      const chunks:Uint8Array[]=[];
      let size=0;
      try {
        while(true){
          const {done,value}=await reader.read();
          if(done)break;
          size+=value.byteLength;
          if(size>maxBytes)throw new Error('The image must be under 10 MB.');
          chunks.push(value);
        }
      } finally {reader.releaseLock();}
      if(!size)throw new Error('The image source returned no data.');
      const bytes=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
      return {bytes,type:mediaType(bytes)};
    }
    throw new Error('The image link redirected too many times.');
  } finally {clearTimeout(timer);}
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return json('Method not allowed.',405);
  const authorization=request.headers.get('authorization')||'';
  if(!authorization.startsWith('Bearer '))return json('Unlock Stride before importing an image.',401);
  const {data:{user},error:userError}=await service.auth.getUser(authorization.slice(7));
  if(userError||!user)return json('Your session has expired. Unlock Stride again.',401);
  const {data:settings,error:settingsError}=await service.from('settings').select('owner_auth_user_id').eq('id',true).single();
  if(settingsError||settings?.owner_auth_user_id!==user.id)return json('This account cannot import images.',403);
  const body=await request.json().catch(()=>null);
  if(typeof body?.url!=='string'||body.url.length>4096)return json('Enter a valid image or GIF link.',400);
  try {
    const image=await imageBytes(body.url);
    return new Response(image.bytes.buffer as ArrayBuffer,{status:200,headers:{...cors,'Content-Type':'application/octet-stream','X-Image-Type':image.type}});
  } catch(error) {
    const message=error instanceof Error?error.message:'Could not fetch the image.';
    return json(message,400);
  }
});
