import {test as base,expect} from '@playwright/test';
export const test=base.extend({
  authenticatedContext:[async({context},use)=>{
    await context.addCookies([{name:'test_access',value:'valid',url:'http://127.0.0.1:8787',httpOnly:true,sameSite:'Lax'}]);
    await use();
  },{auto:true}],
});
export {expect};
