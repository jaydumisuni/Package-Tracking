import fs from 'node:fs';
import assert from 'node:assert/strict';
import {deviceIdentity,issueDeviceSession,revokeDeviceSession} from '../src/docops-device.js';

class FakeStmt{
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[]}
  bind(...args){this.args=args;return this}
  async run(){
    if(this.sql.startsWith('CREATE TABLE'))return {success:true};
    if(this.sql.startsWith('DELETE FROM tracking_ops_device_sessions WHERE expires_at')){for(const [k,v] of this.db.rows)if(v.expires_at<=this.args[0])this.db.rows.delete(k);return {success:true}}
    if(this.sql.startsWith('DELETE FROM tracking_ops_device_sessions WHERE token_hash')){this.db.rows.delete(this.args[0]);return {success:true}}
    if(this.sql.startsWith('INSERT INTO tracking_ops_device_sessions')){
      const [token_hash,user_id,email,display_name,role,permissions_json,expires_at,created_at]=this.args;
      this.db.rows.set(token_hash,{token_hash,user_id,email,display_name,role,permissions_json,expires_at,created_at,last_used_at:created_at});return {success:true};
    }
    if(this.sql.startsWith('UPDATE tracking_ops_device_sessions SET last_used_at')){const row=this.db.rows.get(this.args[1]);if(row)row.last_used_at=this.args[0];return {success:true}}
    throw new Error('unexpected run SQL: '+this.sql.slice(0,80));
  }
  async first(){
    if(this.sql.startsWith('SELECT user_id,email,display_name,role,permissions_json,expires_at')){
      const row=this.db.rows.get(this.args[0]);return row&&row.expires_at>this.args[1]?row:null;
    }
    throw new Error('unexpected first SQL: '+this.sql.slice(0,80));
  }
}
class FakeDB{constructor(){this.rows=new Map()}prepare(sql){return new FakeStmt(this,sql)}}

const db=new FakeDB(),env={TRACKING_DB:db};
const user={id:'u1',email:'staff@example.invalid',displayName:'Test Staff',role:'staff',status:'approved',permissions:['pos.jobs.write']};
const issued=await issueDeviceSession(env,user);
assert.equal(issued.ok,true);assert.match(issued.token,/^ttgdoc_/);assert.equal(db.rows.size,1);
const request=new Request('https://tracking.example/api/ops/status',{headers:{authorization:`Bearer ${issued.token}`}});
const identity=await deviceIdentity(request,env);
assert.equal(identity.ok,true);assert.equal(identity.user.email,user.email);assert.equal(identity.user.role,'staff');
const revoked=await revokeDeviceSession(request,env);assert.equal(revoked.ok,true);assert.equal(db.rows.size,0);
const after=await deviceIdentity(request,env);assert.equal(after.ok,false);assert.equal(after.status,401);

const html=fs.readFileSync(new URL('../public/docops-connect.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(x=>x[1]);
assert.ok(scripts.length>0,'docops connect inline script missing');
for(const script of scripts)new Function(script);
assert.match(html,/tracking\.thetechguyds\.com|TTG ACCOUNT CONNECTION/);
console.log(JSON.stringify({ok:true,checks:['device.issue','device.identity','device.revoke','connect.script.syntax']}));
