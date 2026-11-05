/** Add a deterministic, entirely synthetic finance/contract case to the existing demo owner's workspace. */
import { DatabaseSync } from 'node:sqlite';
import { MetadataStore } from '@datafoundry/metadata';
import { LocalDataGateway } from '@datafoundry/data-gateway';
import { LocalFileAssetService } from '@datafoundry/files';
import { LocalKnowledgeService } from '@datafoundry/knowledge';
import { resolveWorkspaceDir } from '@datafoundry/agent-runtime';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const repo=resolve(import.meta.dirname,'..');
const output=join(repo,'../客户演示/财务与合同');
mkdirSync(output,{recursive:true});
const meta=new DatabaseSync(join(repo,'apps/api/storage/metadata/workbench.sqlite'));
meta.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON');
const store=new MetadataStore(meta);
const owners=meta.prepare("SELECT w.id,w.owner_user_id FROM workspaces w JOIN data_sources d ON d.user_id=w.owner_user_id WHERE d.id='dtc-growth-demo' AND d.status<>'deleted'").all();
assert.equal(owners.length,1,'Expected exactly one existing customer-demo workspace');
const scope={user_id:owners[0].owner_user_id,workspace_id:owners[0].id};
const datasourceId='finance-contract-demo';
const knowledgeId='finance-contract-demo-knowledge';
const workspaceDir=resolveWorkspaceDir({runContext:{...scope,session_id:'finance-demo-setup',run_id:'finance-demo-setup',
 selected_datasource_id:datasourceId,enabled_datasource_ids:[datasourceId],user_input:'synthetic demo preparation',chat_mode:'server',model_name:'none'},
 workspaceRoot:join(repo,'apps/api/storage/workspaces')});
mkdirSync(join(workspaceDir,'datasources'),{recursive:true});
const dbPath=join(workspaceDir,'datasources/finance-contract-demo.sqlite');
const existing=store.dataSources.find({...scope,datasource_id:datasourceId});
if(existing && (existing.status==='deleted' || JSON.parse(existing.config_json).path!==dbPath)) throw new Error('Existing datasource belongs to a different configuration');
const database=new DatabaseSync(dbPath);
database.exec('PRAGMA foreign_keys=ON');
const asOf='2026-10-23';
const shift=(date,days)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
if(!existsSync(join(output,'seed-version.txt')) && existing) throw new Error('Existing demo registration found without seed marker');
if(!database.prepare("SELECT name FROM sqlite_master WHERE name='customers'").get()) {
 database.exec(`BEGIN;
 CREATE TABLE customers(customer_id TEXT PRIMARY KEY,name TEXT NOT NULL,industry TEXT,region TEXT,owner TEXT);
 CREATE TABLE contracts(contract_id TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers,project_name TEXT,category TEXT,department TEXT,signed_date TEXT,start_date TEXT,end_date TEXT,amount_cents INTEGER NOT NULL,currency TEXT,status TEXT,renewal_notice_days INTEGER,risk_tag TEXT);
 CREATE TABLE milestones(milestone_id TEXT PRIMARY KEY,contract_id TEXT REFERENCES contracts,name TEXT,planned_date TEXT,actual_date TEXT,amount_cents INTEGER,status TEXT);
 CREATE TABLE invoices(invoice_id TEXT PRIMARY KEY,contract_id TEXT REFERENCES contracts,milestone_id TEXT REFERENCES milestones,issue_date TEXT,due_date TEXT,amount_cents INTEGER,status TEXT);
 CREATE TABLE receipts(receipt_id TEXT PRIMARY KEY,invoice_id TEXT REFERENCES invoices,receipt_date TEXT,amount_cents INTEGER,payment_method TEXT);
 CREATE TABLE expenses(expense_id TEXT PRIMARY KEY,department TEXT,category TEXT,expense_date TEXT,paid_date TEXT,amount_cents INTEGER,status TEXT);
 CREATE TABLE budgets(month TEXT,department TEXT,amount_cents INTEGER,PRIMARY KEY(month,department));
 `);
 const add=(table,values)=>database.prepare(`INSERT INTO ${table} VALUES (${values.map(()=>'?').join(',')})`).run(...values);
 const customers=['青屿科技','云桥智造','星澜商贸','沐川文创','北辰物流','禾光教育','远帆数科','启明零售','松岚服务'];
 for(let i=0;i<customers.length;i++) add('customers',[`CUS${i+1}`,`模拟·${customers[i]}有限公司`,['软件','制造','商贸'][i%3],['华东','华南','华北'][i%3],['陈演示','李演示','王演示'][i%3]]);
 let receiptNo=0;
 for(let i=1;i<=12;i++) {
  const month=7+Math.floor((i-1)/3),day=3+(i%3)*5,start=`2026-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const id=`CT2026${String(i).padStart(3,'0')}`,amount=(120000+i*15000)*100;
  const end=i===1?'2026-10-10':i===2?'2026-11-05':i===3?'2026-11-20':shift(start,180);
  const risk=i===4?'验收延期':i===7?'回款争议':i===2?'续约窗口临近':'常规';
  add('contracts',[id,`CUS${(i-1)%9+1}`,`模拟${['数据分析平台','系统实施','运维服务'][i%3]}项目${i}`,['软件订阅','实施服务','运维服务'][i%3],['产品部','交付部','客户成功部'][i%3],shift(start,-5),start,end,amount,'CNY',end<asOf?'已到期':'履行中',30,risk]);
  const terms=[['首付款',0,.3],['阶段验收款',30,.4],['尾款',60,.3]];
  for(let j=0;j<3;j++) {
   const [name,days,share]=terms[j],planned=shift(start,days),part=Math.round(amount*share),mid=`${id}-M${j+1}`,inv=`INV-${i}-${j+1}`;
   const delayed=i===4&&j===1;const actual=planned<=asOf&&!delayed?planned:null;
   add('milestones',[mid,id,name,planned,actual,part,actual?'已完成':planned<asOf?'已延期':'待履行']);
   const issued=planned<=asOf&&!delayed, due=shift(planned,30);
   add('invoices',[inv,id,mid,planned,due,part,issued?'已开票':'计划开票']);
   if(issued) {
    const ratio=i===7?0:due<=asOf?(i%4===0?.5:1):i%2===0?.5:0;
    if(ratio>0){
     const paid=Math.round(part*ratio),date=shift(planned,Math.min(20,Math.floor((Date.parse(asOf)-Date.parse(planned))/86400000)));
     const first=Math.floor(paid*.6);
     add('receipts',[`REC${++receiptNo}`,inv,date,first,'模拟银行转账']);
     add('receipts',[`REC${++receiptNo}`,inv,date,paid-first,'模拟银行转账']);
    }
   }
  }
 }
 for(let month=7;month<=10;month++) for(let d=0;d<3;d++) {
  const dept=['产品部','交付部','客户成功部'][d],ym=`2026-${String(month).padStart(2,'0')}`;
  add('budgets',[ym,dept,(60000+d*10000)*100]);
  for(let k=1;k<=3;k++){
   const date=`${ym}-${String(k*6).padStart(2,'0')}`;
   const yuan=14000+d*5000+k*3000+(month===10&&d===1?14000:0);
   add('expenses',[`EXP${month}${d}${k}`,dept,['人力成本','软件服务','差旅与交付'][k-1],date,k===3?null:shift(date,2),yuan*100,k===3?'待支付':'已支付']);
  }
 }
 database.exec('COMMIT');
}
assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);
const tables=['customers','contracts','milestones','invoices','receipts','expenses','budgets'];
const counts=Object.fromEntries(tables.map(t=>[t,database.prepare(`SELECT count(*) n FROM ${t}`).get().n]));
const queries={
 overview:`SELECT count(*) contracts, sum(amount_cents)/100.0 contract_amount_yuan FROM contracts;`,
 receivables:`WITH paid AS (SELECT invoice_id,sum(amount_cents) paid FROM receipts WHERE receipt_date<='${asOf}' GROUP BY invoice_id)
 SELECT c.contract_id,u.name customer,i.invoice_id,i.due_date,i.amount_cents/100.0 invoice_yuan,coalesce(p.paid,0)/100.0 received_yuan,(i.amount_cents-coalesce(p.paid,0))/100.0 outstanding_yuan,
 CASE WHEN i.due_date<'${asOf}' THEN CAST(julianday('${asOf}')-julianday(i.due_date) AS INTEGER) ELSE 0 END overdue_days
 FROM invoices i JOIN contracts c USING(contract_id) JOIN customers u USING(customer_id) LEFT JOIN paid p USING(invoice_id)
 WHERE i.status='已开票' AND i.issue_date<='${asOf}' AND i.amount_cents>coalesce(p.paid,0) ORDER BY overdue_days DESC,outstanding_yuan DESC;`,
 renewals:`SELECT contract_id,project_name,end_date,status,CAST(julianday(end_date)-julianday('${asOf}') AS INTEGER) days_to_expiry,renewal_notice_days FROM contracts WHERE end_date BETWEEN '${asOf}' AND date('${asOf}','+60 day') ORDER BY end_date;`,
 budget:`WITH actual AS (SELECT substr(expense_date,1,7) month,department,sum(amount_cents) amount FROM expenses WHERE expense_date<='${asOf}' GROUP BY 1,2)
 SELECT b.month,b.department,b.amount_cents/100.0 budget_yuan,coalesce(a.amount,0)/100.0 expense_yuan,(coalesce(a.amount,0)-b.amount_cents)/100.0 over_budget_yuan FROM budgets b LEFT JOIN actual a USING(month,department) ORDER BY b.month,b.department;`,
 cashflow:`WITH inflow AS (SELECT substr(receipt_date,1,7) month,sum(amount_cents) amount FROM receipts WHERE receipt_date<='${asOf}' GROUP BY 1),outflow AS (SELECT substr(paid_date,1,7) month,sum(amount_cents) amount FROM expenses WHERE paid_date<='${asOf}' GROUP BY 1)
 SELECT b.month,coalesce(i.amount,0)/100.0 inflow_yuan,coalesce(o.amount,0)/100.0 outflow_yuan,(coalesce(i.amount,0)-coalesce(o.amount,0))/100.0 net_yuan FROM (SELECT DISTINCT month FROM budgets) b LEFT JOIN inflow i USING(month) LEFT JOIN outflow o USING(month) ORDER BY b.month;`,
 delayed:`SELECT contract_id,name,planned_date,status,amount_cents/100.0 affected_amount_yuan FROM milestones WHERE status='已延期';`
};
const answers=Object.fromEntries(Object.entries(queries).map(([name,sql])=>[name,database.prepare(sql).all()]));
assert.equal(database.prepare(`SELECT count(*) n FROM receipts r JOIN invoices i USING(invoice_id) WHERE i.status<>'已开票' OR r.receipt_date> '${asOf}' OR r.receipt_date<i.issue_date`).get().n,0);
assert.equal(database.prepare('SELECT count(*) n FROM (SELECT invoice_id,sum(r.amount_cents) paid,max(i.amount_cents) billed FROM receipts r JOIN invoices i USING(invoice_id) GROUP BY invoice_id HAVING paid>billed)').get().n,0);
assert.equal(database.prepare('SELECT count(*) n FROM (SELECT c.contract_id FROM contracts c JOIN invoices i USING(contract_id) GROUP BY c.contract_id HAVING sum(i.amount_cents)<>max(c.amount_cents))').get().n,0);
assert.ok(answers.receivables.some(r=>r.overdue_days>0));
assert.ok(answers.budget.some(r=>r.over_budget_yuan>0));
assert.ok(answers.renewals.length>0 && answers.delayed.length>0);
const csvCell=v=>{const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s};
for(const table of tables){
 const rows=database.prepare(`SELECT * FROM ${table}`).all(),cols=Object.keys(rows[0]);
 writeFileSync(join(output,table+'.csv'),'\ufeff'+[cols,...rows.map(r=>cols.map(c=>r[c]))].map(r=>r.map(csvCell).join(',')).join('\n')+'\n');
}
const glossary=`# 财务与合同演示业务口径\n\n全部为虚构客户和模拟交易，统计截止日固定为 ${asOf}，币种 CNY。签约期间为2026年7—10月。金额字段 *_cents 均为整数分，展示为元时除以100；金额统一为含税合同口径，不模拟税额拆分。\n\n## 表关系\ncustomers.customer_id → contracts.customer_id；contracts.contract_id → milestones.contract_id / invoices.contract_id；milestones.milestone_id → invoices.milestone_id；invoices.invoice_id → receipts.invoice_id；expenses 与 budgets 按月份和部门先汇总后关联。\n\n一张发票可能有多笔回款，必须先按 invoice_id 汇总 receipts 再关联发票，避免重复累计发票金额。\n\n## 指标\n合同额=sum(contracts.amount_cents)，包括已到期合同；合同额、开票额、收入确认不是同一指标，本案例不提供会计收入或利润。开票额仅统计 status=已开票 且 issue_date<=截止日；计划开票不计入应收。应收余额=已开票金额−截止日前已到账回款；due_date<截止日且余额>0才算逾期，按日历日计算。\n现金流入按 receipt_date，流出仅按非空 paid_date；未支付费用不算现金流出。费用按 expense_date 统计，预算月份未结束只能报告“截至当前已发生额/预算”，不能推断整月预测。净现金流仅为本案例回款减费用支付，不代表公司完整现金余额或利润。\n合同到期提醒为未来60天内到期的履行中合同；renewal_notice_days=30是提前沟通提醒，不代表已自动续约。risk_tag=回款争议/验收延期为模拟业务提示，需结合模拟合同文本核对。\n\n## 表字典\n${tables.map(t=>'- '+t+': '+database.prepare('PRAGMA table_info('+t+')').all().map(c=>c.name).join(', ')).join('\n')}\n`;
const guide=`# 财务与合同客户演示脚本\n\n本包全部为模拟数据，截止日 ${asOf}。选择数据源“财务与合同经营演示（模拟）”，启用知识库“财务合同演示口径与合同”。\n\n1. 探表：有哪些表？梳理客户、合同、里程碑、发票和回款之间的关系。\n2. 应收：截至2026-10-23，计算已开票额、到账回款和应收余额，列出逾期最多的客户及发票，先聚合回款避免重复累计。\n3. 合同：未来60天哪些合同到期？结合合同的30天提醒条款，生成续约跟进清单；单独列示已到期合同。\n4. 风险：找出回款争议与验收延期合同，检索对应合同条款，说明未开票和已开票未回款的区别。\n5. 费用：按月和部门对比预算与已发生费用，指出超支部门；10月只分析截至23日的数据。\n6. 现金：展示7—10月回款、已支付费用与净现金流图，解释待支付费用为什么不在现金流出里。\n7. 导出：输出《模拟财务与合同经营周报》，包含数据范围、SQL、图表、风险及行动清单，标注所有内容为模拟。\n\n数字对照见“核对答案.md”，原始数据见7份CSV；12份合同为演示文本，均无真实签署效力。需配置可用模型后进行AI彩排，准备过程未代替模型生成分析。\n`;
writeFileSync(join(output,'业务口径与数据字典.md'),glossary);
writeFileSync(join(output,'客户演示操作脚本.md'),guide);
writeFileSync(join(output,'参考查询.sql'),Object.entries(queries).map(([name,sql])=>'-- '+name+'\n'+sql).join('\n\n')+'\n');
writeFileSync(join(output,'核对答案.md'),'# 模拟数据核对答案\n\n由SQL直接计算，截止日 '+asOf+'，金额单位元。不是AI分析结果。\n\n'+Object.entries(answers).map(([name,rows])=>'## '+name+'\n\n```json\n'+JSON.stringify(rows,null,2)+'\n```').join('\n\n'));
writeFileSync(join(output,'seed-version.txt'),'finance-contract-demo-v1\n');
if(!existing)store.dataSources.create({...scope,id:datasourceId,name:'财务与合同经营演示（模拟）',type:'sqlite',description:'虚构客户、合同、开票回款、费用预算联动；统计截止2026-10-23。',status:'ready',config:{path:dbPath,mode:'readonly',defaultEnabled:true,queryPolicy:{maxRows:1000,timeoutMs:10000,denyWrite:true}}});
const files=new LocalFileAssetService(store,{storageRoot:join(repo,'apps/api/storage/files')});
const gateway=new LocalDataGateway(store,{defaultLimit:100,maxLimit:1000,timeoutMs:10000},files);
assert.equal((await gateway.testConnect({...scope,datasource_id:datasourceId})).ok,true);
const schema=await gateway.inspectSchema({...scope,datasource_id:datasourceId});assert.equal(schema.tables.length,7);
store.configResources.upsert({...scope,id:datasourceId,kind:'datasource-schema',name:'财务与合同演示Schema',status:'ready',payload:{schema,adapterSchemaVersion:1,inspectedAt:new Date().toISOString()}});
if(!store.configResources.find({...scope,id:knowledgeId,kind:'knowledge-base'}))store.configResources.upsert({...scope,id:knowledgeId,kind:'knowledge-base',name:'财务合同演示口径与合同',description:'模拟指标口径、表关联与12份模拟合同条款，使用全文检索。',status:'ready',default_enabled:true,payload:{retrievalTopK:5,chunkSize:1600,chunkOverlap:200}});
const knowledge=new LocalKnowledgeService(store);
const assets=[];
async function materialize(filename,content,ingest=false){
 const path=join(workspaceDir,filename);
 if(existsSync(path))assert.equal(readFileSync(path,'utf8'),content,'Refuse to replace modified demo file: '+filename);
 else writeFileSync(path,content);
 const asset=files.syncWorkspaceFile({...scope,filename,path,declared_mime_type:filename.endsWith('.csv')?'text/csv':'text/markdown'});
 assets.push(filename);
 if(ingest&&!meta.prepare('SELECT id FROM knowledge_documents WHERE user_id=? AND collection_id=? AND filename=?').get(scope.user_id,knowledgeId,filename))await knowledge.ingestText({...scope,collection_id:knowledgeId,filename,content,file_asset_ref_id:asset.ref.id,mime_type:'text/markdown'});
}
await materialize('Finance-demo-business-glossary.md',glossary,true);
await materialize('Finance-demo-presentation-guide.md',guide);
for(const t of tables)await materialize('Finance-demo-'+t+'.csv',readFileSync(join(output,t+'.csv'),'utf8'));
mkdirSync(join(output,'模拟合同'),{recursive:true});
for(const c of database.prepare('SELECT c.*,u.name customer FROM contracts c JOIN customers u USING(customer_id)').all()){
 const milestones=database.prepare('SELECT name,planned_date,amount_cents FROM milestones WHERE contract_id=? ORDER BY planned_date').all(c.contract_id);
 const text=`# 模拟合同 ${c.contract_id}\n\n**演示文本，客户、项目、金额与条款均为虚构，无真实签署效力。**\n\n甲方：${c.customer}\n乙方：模拟·嘟嘟数据服务有限公司\n项目：${c.project_name}\n合同类型：${c.category}\n签约日：${c.signed_date}\n履行期间：${c.start_date} 至 ${c.end_date}\n合同总额：人民币 ${c.amount_cents/100} 元（含税演示口径）\n\n## 付款及验收条款\n${milestones.map(m=>`- ${m.name}：计划 ${m.planned_date}，金额 ${m.amount_cents/100} 元；验收完成后开票，开票日起30日内付款。`).join('\n')}\n\n## 续约提醒\n到期前${c.renewal_notice_days}天启动续约沟通，经双方书面确认后续签。到期不自动续约。\n\n## 模拟履约备注（截至${asOf}）\n风险标签：${c.risk_tag}。${c.risk_tag==='验收延期'?'阶段验收材料尚未确认，对应验收款尚未开票，不应计作逾期应收。':c.risk_tag==='回款争议'?'甲方对交付范围提出异议，已开票款项尚未到账；演示时请结合发票到期日识别逾期。':'按合同约定跟踪验收、开票和回款；实际进度以关联台账为准。'}\n`;
 writeFileSync(join(output,'模拟合同',c.contract_id+'.md'),text);
 await materialize('Finance-demo-contract-'+c.contract_id+'.md',text,true);
}
for(const t of tables){const preview=await gateway.previewTable({...scope,datasource_id:datasourceId,table:t,limit:50});assert.equal(preview.rows.length,Math.min(counts[t],50));}
for(const sql of Object.values(queries)){const result=await gateway.runSqlReadonly({...scope,datasource_id:datasourceId,sql,limit:1000});assert.ok(Array.isArray(result.rows));}
assert.ok((await knowledge.retrieve({...scope,collection_id:knowledgeId,query:'回款争议',top_k:3})).length>0);
const result={asOf,datasourceId,datasourceName:'财务与合同经营演示（模拟）',knowledgeId,tableCounts:counts,totalRows:Object.values(counts).reduce((s,n)=>s+n,0),contractDocuments:12,assets:assets.length,checks:['integrity','foreign keys','connection','schema','7 table previews','6 reference SQL queries','knowledge retrieval'],overview:answers.overview};
writeFileSync(join(output,'载入结果.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));database.close();store.close();
