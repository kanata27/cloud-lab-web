// Isolated AWS stand-in: these runtime tests never access the public network.
export default {async fetch(request){
 const url=new URL(request.url);
 if(url.hostname==='redirect.invalid')throw new Error('Credentials followed an untrusted redirect.');
 if(url.pathname!=='/stats'||!url.searchParams.has('from')||!url.searchParams.has('to')){
  throw new Error('Unexpected authentication endpoint.');
 }
 switch(request.headers.get('Authorization')){
  case 'Bearer valid':return Response.json({version:1,totals:{},daily:[]});
  case 'Bearer expired':return new Response('',{status:401});
  case 'Bearer forbidden':return new Response('',{status:403});
  case 'Bearer redirect':return new Response('',{status:302,headers:{Location:'https://redirect.invalid/'}});
  case 'Bearer unavailable':return new Response('',{status:503});
  case 'Bearer malformed':return new Response('not JSON');
  default:return new Response('',{status:401});
 }
}};
