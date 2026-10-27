import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--environment=isolated-factory-postgres'||!args[1].startsWith('--metadata='))throw Error('Explicit isolated environment required');
const file=path.resolve(args[1].slice(11)),allowed=path.resolve('test-results/platform-factory-20261024')+path.sep;
if(!file.toLowerCase().startsWith(allowed.toLowerCase()))throw Error('Unknown test directory');
const meta=JSON.parse(await fs.readFile(file,'utf8'));
if(meta.classification!=='isolated-synthetic-factory'||meta.host!=='127.0.0.1'||meta.user!=='factory_admin'||path.resolve(meta.root)!==path.dirname(file)||path.resolve(meta.data)!==path.join(path.dirname(file),'data'))throw Error('Unknown database refused');
const pidfile=(await fs.readFile(path.join(meta.data,'postmaster.pid'),'utf8')).split(/\r?\n/);
if(path.resolve(pidfile[1])!==path.resolve(meta.data)||Number(pidfile[3])!==meta.port)throw Error('Process/data/port marker mismatch');
const require=createRequire('C:/projects/ONARLY-DRIVE-worktrees/qabgo-driver-ui-v2-feature/services/drive-core/package.json'),{Client}=require('pg');
const c=new Client({host:meta.host,port:meta.port,user:meta.user,password:meta.password,database:'postgres',connectionTimeoutMillis:5000});
await c.connect();try{
 const marker=(await c.query("select current_setting('factory.test_run_id',true) marker")).rows[0].marker;if(marker!==meta.runId)throw Error('Unknown running cluster');
 const others=(await c.query("select count(*)::int n from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid()")).rows[0].n;if(others!==0)throw Error('Other client sessions present; stop refused');
}finally{await c.end();}
await promisify(execFile)(path.join(meta.pgBin,'pg_ctl.exe'),['-D',meta.data,'-m','smart','-w','-t','20','stop'],{windowsHide:true});
console.log(JSON.stringify({status:'OWNED_SYNTHETIC_CLUSTER_STOPPED',port:meta.port,runId:meta.runId,deleted:false,existingClustersTouched:false}));
