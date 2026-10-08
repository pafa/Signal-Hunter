import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readSnapshotCache} from '../server/read-snapshot-cache.mjs';
import {serialize} from 'node:v8';

test('the byte budget evicts snapshots and never retains a single oversized value',()=>{
 const db=new DatabaseSync(':memory:');try{
  const value={body:'x'.repeat(200)},size=serialize(value).byteLength,memo=readSnapshotCache(db,{limit:256,maxBytes:size*2});let reads=0;
  const read=()=>{reads++;return value;};memo('a',read);memo('b',read);memo('a',read);assert.equal(reads,2);
  memo('c',read);memo('a',read);assert.equal(reads,4);
  let largeReads=0;const large=()=>{largeReads++;return {body:'x'.repeat(size*3)};};memo('large',large);memo('large',large);assert.equal(largeReads,2);
  const before=reads;memo('a',read);assert.equal(reads,before);
 }finally{db.close();}
});

test('unchanged reads reuse a bounded private snapshot and callers cannot mutate it',()=>{
 const db=new DatabaseSync(':memory:');try{let reads=0;const memo=readSnapshotCache(db,{limit:2}),read=()=>({n:++reads,nested:{value:'original'}});const a=memo('a',read);a.nested.value='changed';assert.equal(memo('a',read).nested.value,'original');assert.equal(reads,1);memo('b',read);memo('c',read);memo('a',read);assert.equal(reads,4);}
 finally{db.close();}
});
test('local writes and a rollback never leave a cached uncommitted projection',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE example(n); INSERT INTO example VALUES(1)');const memo=readSnapshotCache(db),read=()=>db.prepare('SELECT n FROM example').get();assert.equal(memo('value',read).n,1);db.exec('UPDATE example SET n=2');assert.equal(memo('value',read).n,2);db.exec('BEGIN; UPDATE example SET n=3');assert.equal(memo('value',read).n,3);db.exec('ROLLBACK; BEGIN');assert.equal(memo('value',read).n,2);db.exec('COMMIT');assert.equal(memo('value',read).n,2);db.exec('BEGIN; UPDATE example SET n=4; COMMIT');assert.equal(memo('value',read).n,4);}
 finally{db.close();}
});
test('peer connection commits invalidate reads while its rollback keeps visible data unchanged',()=>{
 const dir=mkdtempSync(join(tmpdir(),'read-projection-')),path=join(dir,'db.sqlite'),db=new DatabaseSync(path);let peer;
 try{db.exec('CREATE TABLE example(n); INSERT INTO example VALUES(1)');peer=new DatabaseSync(path);const memo=readSnapshotCache(db),read=()=>db.prepare('SELECT n FROM example').get();assert.equal(memo('value',read).n,1);peer.exec('UPDATE example SET n=2');assert.equal(memo('value',read).n,2);peer.exec('BEGIN; UPDATE example SET n=3');assert.equal(memo('value',read).n,2);peer.exec('ROLLBACK');assert.equal(memo('value',read).n,2);}
 finally{peer?.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('schema changes, errors and a read that writes cannot publish an obsolete cache entry',()=>{
 const db=new DatabaseSync(':memory:');try{const memo=readSnapshotCache(db);let calls=0;const read=()=>++calls;assert.equal(memo('schema',read),1);db.exec('CREATE TABLE example(n)');assert.equal(memo('schema',read),2);assert.throws(()=>memo('failure',()=>{throw Error('unavailable');}),/unavailable/);assert.equal(memo('failure',()=>3),3);assert.equal(memo('writing',()=>{db.exec('INSERT INTO example VALUES(1)');return 1;}),1);assert.equal(memo('writing',()=>2),2);}
 finally{db.close();}
});
