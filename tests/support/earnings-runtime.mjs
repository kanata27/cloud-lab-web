import {authorize} from '../../worker/earnings.js';

function request(token){
 return new Request('https://kanata.test/earnings-api/spots',{
  headers:token?{Authorization:'Bearer '+token}:{},
 });
}
async function rejected(token,status){
 try{await authorize(request(token));}
 catch(error){
  if(error.status===status)return;
  throw new Error('Expected '+status+', received '+error.status+': '+error.message);
 }
 throw new Error('Unauthorised session was accepted.');
}

export default {async test(){
 await authorize(request('valid'),(url,options)=>{
  // Native Request validates options in the actual Cloudflare runtime.
  const outgoing=new Request(url,options);
  if(outgoing.redirect!=='manual')throw new Error('Credentials must never follow redirects.');
  return fetch(outgoing);
 });
}};
export const expired={async test(){await rejected('expired',401);}};
export const forbidden={async test(){await rejected('forbidden',401);}};
export const redirect={async test(){await rejected('redirect',503);}};
export const unavailable={async test(){await rejected('unavailable',503);}};
export const malformed={async test(){await rejected('malformed',503);}};
export const missing={async test(){await rejected(undefined,401);}};
