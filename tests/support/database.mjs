import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function database() {
  const sqlite=new DatabaseSync(':memory:');
  const directory=new URL('../../migrations/',import.meta.url);
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(name,directory),'utf8'));
  const db={prepare(sql){
    const statement=sqlite.prepare(sql);
    const methods=args=>({
      async first(){return statement.get(...args)||null;},
      async all(){return {results:statement.all(...args)};},
      async run(){return {meta:{changes:Number(statement.run(...args).changes)}};},
    });
    return {...methods([]),bind(...args){return methods(args);}};
  }};
  return {sqlite,db};
}
