/** Load the documented synthetic DTC case into an existing personal workspace.
 * Uses application repositories, never reads passwords or session tokens.
 * Existing business records and analysis history are preserved.
 */
import { DatabaseSync } from 'node:sqlite';
import { MetadataStore } from '@datafoundry/metadata';
import { LocalDataGateway } from '@datafoundry/data-gateway';
import { LocalFileAssetService } from '@datafoundry/files';
import { LocalKnowledgeService } from '@datafoundry/knowledge';
import { resolveWorkspaceDir } from '@datafoundry/agent-runtime';
import { ensureBuiltinDtcGrowthDatasource } from '../apps/api/dist/builtin-dtc-growth-datasource.js';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import assert from 'node:assert/strict';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = resolve(repo, '../客户演示');
const apiStorage = join(repo, 'apps/api/storage');
const dbPath = join(apiStorage, 'metadata/workbench.sqlite');
if (!existsSync(dbPath)) throw new Error('Expected existing local API metadata DB is missing.');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
// Do not rerun migrations or initializeConfigSchema against a live server.
const store = new MetadataStore(db);
const active = db.prepare(`SELECT DISTINCT u.id FROM users u JOIN auth_sessions a ON a.user_id=u.id
 WHERE a.revoked_at IS NULL AND a.expires_at>? AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL`)
 .all(new Date().toISOString());
const requested = process.argv.find(arg => arg.startsWith('--user-id='))?.slice('--user-id='.length);
if (!requested && active.length !== 1) throw new Error('Specify --user-id when there is not exactly one active user.');
const userId = requested ?? active[0].id;
const workspace = db.prepare('SELECT id FROM workspaces WHERE owner_user_id=?').get(userId);
assert.ok(workspace, 'Existing personal workspace required');
const scope = { user_id: userId, workspace_id: workspace.id };
const datasourceId = 'dtc-growth-demo';
const knowledgeId = 'dtc-demo-business';
const existing = store.dataSources.find({ user_id: userId, datasource_id: datasourceId });
if (existing?.status === 'deleted') throw new Error('The documented demo source was deleted; refusing to revive it automatically.');
const provision = ensureBuiltinDtcGrowthDatasource({metadataStore: store,userId,workspaceId:workspace.id,
 fixturePath:join(repo,'storage/fixtures/dtc-growth-demo.sqlite'),workspaceRoot:join(apiStorage,'workspaces')});
if (provision.action === 'fixture_missing') throw new Error('Generate the original fixture before loading.');
const files = new LocalFileAssetService(store, {storageRoot:join(apiStorage,'files')});
const gateway = new LocalDataGateway(store, {defaultLimit:100,maxLimit:1000,timeoutMs:10000}, files);
const connected = await gateway.testConnect({...scope,datasource_id:datasourceId});
assert.equal(connected.ok,true);
const schema = await gateway.inspectSchema({...scope,datasource_id:datasourceId});
assert.equal(schema.tables.length,5);
store.configResources.upsert({...scope,id:datasourceId,kind:'datasource-schema',name:datasourceId,
 payload:{schema,adapterSchemaVersion:1,inspectedAt:new Date().toISOString()},status:'ready'});
const sourceRecord=store.dataSources.get({user_id:userId,datasource_id:datasourceId});
const sourcePath=JSON.parse(sourceRecord.config_json).path;
const sourceDb=new DatabaseSync(sourcePath,{readOnly:true});
const tableCounts={};
mkdirSync(join(demoDir,'raw'),{recursive:true});
const csvCell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
for(const table of schema.tables){
 assert.match(table.name,/^[a-z_]+$/);
 const records=sourceDb.prepare(`SELECT * FROM "${table.name}"`).all();
 tableCounts[table.name]=records.length;
 const names=table.columns.map(c=>c.name);
 writeFileSync(join(demoDir,'raw',table.name+'.csv'),'\ufeff'+[names.map(csvCell).join(','),
 ...records.map(r=>names.map(n=>csvCell(r[n])).join(','))].join('\r\n')+'\r\n');
}
assert.deepEqual(tableCounts,{ad_spend:18,customer_tickets:8,daily_targets:14,orders:32,products:5});
assert.equal(sourceDb.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
assert.equal(sourceDb.prepare('PRAGMA foreign_key_check').all().length,0);
const queryText=readFileSync(join(demoDir,'参考查询.sql'),'utf8');
const statements=[...queryText.matchAll(/-- query:(\w+)\r?\n([\s\S]*?)(?=\r?\n-- query:|$)/g)];
const answers={};
for(const [,name,sql] of statements) answers[name]=sourceDb.prepare(sql.trim()).all();
assert.equal(answers.periods.find(x=>x.period==='latest_7d').gmv,6511);
assert.equal(answers.periods.find(x=>x.period==='previous_7d').gmv,4465);
assert.equal(answers.periods.find(x=>x.period==='latest_7d').net_margin,1561);
assert.equal(answers.periods.find(x=>x.period==='previous_7d').net_margin,2058);
assert.equal(answers.channels.reduce((sum,x)=>sum+x.gmv,0),6511);
// Verify reference queries also work through the actual read-only gateway.
// These are setup verification queries, with no fabricated agent run/session.
for(const [,name,sql] of statements){
 const result=await gateway.runSqlReadonly({...scope,datasource_id:datasourceId,sql:sql.trim(),limit:100});
 assert.equal(result.rows.length,answers[name].length);
}
const tableMd=rows=>{const cols=Object.keys(rows[0]);return ['| '+cols.join(' | ')+' |','| '+cols.map(()=> '---').join(' | ')+' |',
 ...rows.map(r=>'| '+cols.map(c=>String(r[c])).join(' | ')+' |')].join('\n');};
const totalAds=answers.channels.reduce((s,r)=>s+r.ad_spend,0);
writeFileSync(join(demoDir,'讲师核对答案.md'),`# 讲师核对答案（直接 SQL 校验）\n\n完全模拟数据；以下结果不是 AI 生成，也未创建虚假对话。\n\n## 两期指标\n\n${tableMd(answers.periods)}\n\nGMV 从 4465 到 6511，增长约 45.82%；净毛利从 2058 到 1561，下降约 24.15%；净毛利率下降 22.12 个百分点；退款金额率为 10.72%。净毛利未扣广告。\n\n## 最新分析期渠道\n\n${tableMd(answers.channels)}\n\n模拟投放总额 ${totalAds} 元；若最多增加 20%，预算上限 ${(totalAds*1.2).toFixed(2)} 元。明细先聚合再关联，渠道 GMV 加总为 6511。ROAS 偏低是模拟订单/投放样本设计，不应包装成真实商业回报。\n\n## 工单证据\n\n${tableMd(answers.tickets)}\n\n## 表行数\n\n${tableMd(Object.entries(tableCounts).map(([table,rows])=>({table,rows})))}\n`);
writeFileSync(join(demoDir,'核对结果.json'),JSON.stringify(answers,null,2)+'\n');

const knowledgeResource=store.configResources.find({...scope,id:knowledgeId,kind:'knowledge-base'});
if(!knowledgeResource) store.configResources.upsert({...scope,id:knowledgeId,kind:'knowledge-base',
 name:'DTC 演示业务口径',description:'模拟美妆案例的指标、日期、表关系和 JOIN 粒度；全文检索，无外部 embedding 调用。',
 default_enabled:true,status:'ready',payload:{retrievalTopK:5,chunkSize:1600,chunkOverlap:200}});
const knowledge=new LocalKnowledgeService(store);
const businessFilename='业务口径与数据字典.md';
const knowledgeExists=db.prepare('SELECT id FROM knowledge_documents WHERE user_id=? AND collection_id=? AND filename=?')
 .get(userId,knowledgeId,businessFilename);
const runContext={...scope,session_id:'demo-setup',run_id:'demo-setup',selected_datasource_id:datasourceId,
 enabled_datasource_ids:[datasourceId],user_input:'demo preparation',chat_mode:'server',model_name:'none'};
const workspaceDir=resolveWorkspaceDir({runContext,workspaceRoot:join(apiStorage,'workspaces')});
const loadedFiles=[];
const assetNames={
 '业务口径与数据字典.md':'DTC-demo-business-glossary.md',
 '客户演示操作脚本.md':'DTC-demo-presentation-guide.md',
 '下周预算约束.csv':'DTC-demo-budget-constraints.csv'
};
for(const filename of [businessFilename,'客户演示操作脚本.md','下周预算约束.csv']){
 // Application sanitizes non-ASCII names. Use distinct ASCII names to avoid collisions.
 const demoFilename=assetNames[filename];
 const materializedPath=join(workspaceDir,demoFilename);
 // These deterministic files belong to this seed package, never overwrite other names.
 if(existsSync(materializedPath)&&readFileSync(materializedPath).compare(readFileSync(join(demoDir,filename)))!==0)
  throw new Error('Existing demo asset differs; refusing overwrite: '+demoFilename);
 mkdirSync(workspaceDir,{recursive:true});
 if(!existsSync(materializedPath))writeFileSync(materializedPath,readFileSync(join(demoDir,filename)));
 const ref=files.syncWorkspaceFile({...scope,filename:demoFilename,path:materializedPath,
 declared_mime_type:filename.endsWith('.csv')?'text/csv':'text/markdown'});
 assert.equal(files.readRef({...scope,id:ref.ref.id}).body.compare(readFileSync(join(demoDir,filename))),0);
 loadedFiles.push({name:demoFilename,id:ref.ref.id});
 if(filename===businessFilename&&!knowledgeExists){
  await knowledge.ingestText({...scope,collection_id:knowledgeId,filename:businessFilename,
   content:readFileSync(join(demoDir,filename),'utf8'),file_asset_ref_id:ref.ref.id,mime_type:'text/markdown'});
 }
 if(filename===businessFilename&&knowledgeExists){
  db.prepare('UPDATE knowledge_documents SET file_asset_ref_id=? WHERE user_id=? AND collection_id=? AND id=?')
   .run(ref.ref.id,userId,knowledgeId,knowledgeExists.id);
 }
 const legacyPath=join(workspaceDir,'DTC演示-'+filename);
 if(existsSync(legacyPath)&&readFileSync(legacyPath).compare(readFileSync(join(demoDir,filename)))===0)unlinkSync(legacyPath);
}
assert.equal(new Set(loadedFiles.map(f=>f.id)).size,3);
const retrieved=await knowledge.retrieve({...scope,collection_id:knowledgeId,query:'GMV',top_k:3});
assert.ok(retrieved.length>0,'Knowledge retrieval failed');
const modelCount=db.prepare("SELECT count(*) AS count FROM config_resources WHERE user_id=? AND workspace_id=? AND kind='model-profile'")
 .get(userId,workspace.id).count;
const serverDefaultKey=/^LLM_API_KEY=\s*[^\s#]+/m.test(readFileSync(join(repo,'.env'),'utf8'));
const result={preparedAt:new Date().toISOString(),userId,workspaceId:workspace.id,datasourceId,
 datasourceName:sourceRecord.name,databasePath:sourcePath,knowledgeId,knowledgeName:'DTC 演示业务口径',
 tableCounts,totalRows:Object.values(tableCounts).reduce((s,x)=>s+x,0),workspaceFiles:loadedFiles,
 checks:{connection:'passed',schema:'passed',sqliteIntegrity:'passed',foreignKeys:'passed',referenceQueries:'passed',
 readOnlyGateway:'passed',knowledgeFullText:'passed'},modelProfiles:modelCount,serverDefaultKeyConfigured:serverDefaultKey,
 aiEndToEnd:'not run; configure a model and rehearse',notes:'Existing source preserved. No new users, fake runs or fake AI outputs created.'};
writeFileSync(join(demoDir,'载入结果.json'),JSON.stringify(result,null,2)+'\n');
sourceDb.close();store.close();
console.log(JSON.stringify(result,null,2));
