import test from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { gunzipSync } from 'node:zlib';
import { context, engineFiles, snapshot, read, hash, plain, workerRequest } from './helpers.mjs';

const E = context([...engineFiles, 'src/engine/optimization.js']), O = E.HospitalOptimization, Z = E.HospitalZones;
const S = snapshot(), gridText = gunzipSync(read('public/optimization/grid.json.gz')).toString();
const grid = JSON.parse(gridText), meta = JSON.parse(read('public/optimization/grid-meta.json'));
const compile = async file => {
  const source = await transform(read(file).toString(), { loader: 'ts', target: 'es2022', format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(source.code).toString('base64'));
};
const M = await compile('src/optimization/matrix.ts');

test('mixed grid conserves every original hospital area and includes 19 actual city polygons', () => {
  assert.equal(hash(gridText), meta.checksum);
  assert.equal(meta.snapshot, S.pack.checksum);
  assert.deepEqual([grid.cells.length, meta.urban, meta.rural], [19843, 11402, 8441]);
  assert.equal(new Set(grid.cells.map(c => c.id)).size, grid.cells.length);
  assert.equal(JSON.parse(read('public/optimization/cities.geojson')).features.length, 19);
  for (const [id, polygons] of S.data.zones) {
    const area = grid.cells.filter(c => c.organizationId === id).reduce((sum, c) => sum + Z.area([c.geometry]), 0);
    assert.ok(Math.abs(area - Z.area(polygons)) < 1e-7, `${id}: coverage conserved`);
  }
  assert.ok(grid.cells.every(c => [250, 2000].includes(c.step)));
  const registry = JSON.parse(read('public/optimization/facilities.json'));
  assert.equal(registry.facilities.length, 229);
  assert.equal(registry.facilities.filter(f => !f.address).length, 1);
  assert.ok(registry.facilities.every(f => !f.confirmed && f.coords === null));
});

test('adaptive grid has no overlaps between resolutions and clips both to original zone', () => {
  const square = [[[37,54],[37.02,54],[37.02,54.02],[37,54.02],[37,54]]];
  const urban = [[[[37.004,54.004],[37.012,54.004],[37.012,54.012],[37.004,54.012],[37.004,54.004]]]];
  const cells = O.adaptiveGrid(new Map([['h', [square]]]), [urban]);
  assert.ok(cells.some(c => c.step === 250) && cells.some(c => c.step === 2000));
  assert.ok(Math.abs(cells.reduce((sum,c) => sum+Z.area([c.geometry]),0)-Z.area([square]))<1e-10);
  for (let i=0;i<cells.length;i++) {
    const c=cells[i];
    assert.ok(Z.area(Z.difference([c.geometry],[square]))<1e-10);
    assert.ok(Z.area(c.step===250?Z.difference([c.geometry],urban):Z.intersection([c.geometry],urban))<1e-10);
    for(let j=i+1;j<cells.length;j++) assert.ok(Z.area(Z.intersection([c.geometry],[cells[j].geometry]))<1e-10);
  }
});

test('time-only assignment finds the global separable minimum and keeps unavailable routes explicit', () => {
  const cells=[0,1,2,3].map(n=>({id:String(n),organizationId:'old',origin:[54,37+n/100]}));
  const candidates=[{id:'b',organizationId:'other'},{id:'a',organizationId:'old'}];
  const times=[[20,20],[null,8],[null,null],[5,undefined]];
  const r=O.solve(cells,candidates,[{id:'old'}],(c,f)=>f.id==='old'?30:times[Number(c.id)][f.id==='b'?0:1]);
  assert.deepEqual(plain(r.rows.map(v=>[v.afterId,v.afterSeconds,v.status])),[['a',20,'found'],['a',8,'found'],[null,null,'unreachable'],['b',5,'pending']]);
  assert.equal(r.summary.pending,1);
  assert.equal(r.summary.unreachable,1);
  assert.throws(()=>O.solve(cells,[],[],()=>0),/Подтвердите/);
  for(let trial=0;trial<10;trial++) {
    const t=[[trial+1,20-trial],[5+trial,2+trial]];
    const result=O.solve(cells.slice(0,2),candidates,[],(c,f)=>t[Number(c.id)][f.id==='b'?0:1]);
    const total=result.rows.reduce((sum,r)=>sum+r.afterSeconds,0);
    assert.equal(total,Math.min(...t[0])+Math.min(...t[1]));
  }
});

test('matrix requests are directional, local-only, bounded, and do not use fallback estimates', async () => {
  assert.throws(()=>M.localTableEndpoint('https://router.project-osrm.org/route/v1/driving'),/локальном/);
  let url;
  const times=await M.table('http://localhost:5000/route/v1/driving',[[54,37],[54.01,37.01]],[[54.1,37.1]],new AbortController().signal,
    async u=>{url=new URL(u);return {ok:true,status:200,json:async()=>({code:'Ok',durations:[[5],[null]],sources:[{distance:1},{distance:2}],destinations:[{distance:3}]})};});
  assert.equal(url.pathname,'/table/v1/driving/37,54;37.01,54.01;37.1,54.1');
  assert.equal(url.searchParams.get('sources'),'0;1');assert.equal(url.searchParams.get('destinations'),'2');
  assert.equal(url.searchParams.has('fallback_speed'),false);
  assert.deepEqual(times,[[5],[null]]);
  await assert.rejects(M.table('http://localhost:5000/route/v1/driving',[[54,37]],[[54,37.1]],new AbortController().signal,
    async()=>({ok:true,json:async()=>({code:'Ok',durations:[[-1]]})})),/некорректную матрицу/);
});

test('NoSegment isolates a bad coordinate without discarding other source/destination pairs', async () => {
  const result=await M.table('http://localhost:5000/route/v1/driving',[[54,37],[54,38]],[[54,37.1],[54,37.2]],new AbortController().signal,
    async u=>{
      const url=new URL(u),coords=url.pathname.split('/').at(-1).split(';');
      const sources=url.searchParams.get('sources').split(';').map(Number),dest=url.searchParams.get('destinations').split(';').map(Number);
      return {ok:true,status:200,json:async()=>coords.includes('38,54')?{code:'NoSegment'}:
        {code:'Ok',durations:sources.map(()=>dest.map(()=>12)),sources:sources.map(()=>({distance:0})),destinations:dest.map(()=>({distance:0}))}};
    });
  assert.deepEqual(result,[[12,12],[null,null]]);
});

test('matrix persists completed batches before cancellation and resumes without querying a fully cached block',async()=>{
  const sources=Array.from({length:40},(_,i)=>[54,37+i/1000]),destinations=[[54.1,37.1]];
  const cache=new Map(),saved=[],controller=new AbortController();let calls=0;
  const request=async(_s,a,b)=>{calls++;return a.map(()=>b.map(()=>9));};
  await assert.rejects(M.runMatrix({service:'http://localhost:5000/route/v1/driving',sources,destinations,cache,signal:controller.signal,
    request,save:async batch=>saved.push(...batch),progress:n=>{if(n===32)controller.abort();}}),{name:'AbortError'});
  assert.equal(saved.length,32);assert.equal(cache.size,32);
  await M.runMatrix({service:'http://localhost:5000/route/v1/driving',sources,destinations,cache,signal:new AbortController().signal,
    request,save:async batch=>saved.push(...batch),progress:()=>{}});
  assert.equal(calls,2);assert.equal(cache.size,40);assert.equal(saved.length,40);
});

test('background union preserves complete coverage and excludes unassigned cells',async()=>{
  const cells=grid.cells.slice(0,20),rows=cells.map(c=>({cellId:c.id,afterId:'target'}));
  const {result}=await workerRequest('optimization',{id:1,task:'outlines',payload:{cells,rows}});
  assert.equal(result.length,1);
  assert.ok(Math.abs(Z.area(result[0][1])-cells.reduce((a,c)=>a+Z.area([c.geometry]),0))<1e-9);
});
