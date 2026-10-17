import {authorize} from '../../worker/access.js';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
export default {async test(){
 const original=globalThis.fetch;
 const env={ACCESS_TEAM_DOMAIN:'https://native-test.cloudflareaccess.com',ACCESS_AUD:'a'.repeat(64),ACCESS_ALLOWED_EMAIL:'owner@example.test'};
 const {publicKey,privateKey}=await generateKeyPair('RS256',{extractable:true});
 const jwk={...await exportJWK(publicKey),alg:'RS256',kid:'native-key',use:'sig'};
 globalThis.fetch=async(url,options)=>{
  const outgoing=new Request(url,options);
  if(outgoing.redirect!=='manual'||outgoing.url!==env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs')throw Error('Untrusted key fetch');
  return Response.json({keys:[jwk]});
 };
 const now=Math.floor(Date.now()/1000);
 const sign=claims=>new SignJWT({email:env.ACCESS_ALLOWED_EMAIL,sub:'native-owner',type:'app',iss:env.ACCESS_TEAM_DOMAIN,aud:[env.ACCESS_AUD],iat:now,exp:now+3600,...claims}).setProtectedHeader({alg:'RS256',kid:'native-key'}).sign(privateKey);
 const request=token=>new Request('https://kanata.test/api/session',{headers:token?{'Cf-Access-Jwt-Assertion':token}:{}});
 try{
  await authorize(request(await sign({})),env);
  for(const [claims,status] of [[{email:'stranger@example.test'},403],[{aud:['b'.repeat(64)]},401],[{exp:now-1},401]]){
   let rejected=false;try{await authorize(request(await sign(claims)),env);}catch(e){rejected=e.status===status;}
   if(!rejected)throw Error('Invalid session accepted');
  }
  let rejected=false;try{await authorize(request(),env);}catch(e){rejected=e.status===401;}
  if(!rejected)throw Error('Guest accepted');
 }finally{globalThis.fetch=original;}
}};
