import {generateKeyPair,exportJWK,SignJWT} from 'jose';
const {publicKey,privateKey}=await generateKeyPair('RS256',{extractable:true});
const jwk={...await exportJWK(publicKey),kid:'local-test-key',alg:'RS256',use:'sig'};
export const jwks={keys:[jwk]};
export const accessEnv={ACCESS_TEAM_DOMAIN:'https://kanata-test.cloudflareaccess.com',ACCESS_AUD:'a'.repeat(64),
  ACCESS_ALLOWED_EMAIL:'owner@example.test',CANONICAL_HOST:'kanata.test',PUBLIC_ALIASES:'www.kanata.test'};
export async function accessToken(claims={},header={}) {
  const now=Math.floor(Date.now()/1000);
  return new SignJWT({sub:'test-owner',email:accessEnv.ACCESS_ALLOWED_EMAIL,type:'app',iat:now,exp:now+3600,
    iss:accessEnv.ACCESS_TEAM_DOMAIN,aud:[accessEnv.ACCESS_AUD],...claims})
    .setProtectedHeader({alg:'RS256',kid:jwk.kid,typ:'JWT',...header}).sign(privateKey);
}
export function keysResponse(url) {
  if(String(url)===accessEnv.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs')return Response.json(jwks);
  throw Error('Unexpected external request: '+url);
}
