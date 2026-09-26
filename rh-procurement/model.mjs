export const money = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s=String(value??'').trim();
  if (!s || !/^(?:USD\s*)?\$?\s*[\d,]+(?:\.\d{1,2})?$/i.test(s)) return null;
  const n=Number(s.replace(/USD|\$|,|\s/gi,'')); return Number.isFinite(n)?n:null;
};
export function dateISO(v) {
  if(!v) return null;
  if(typeof v==='number') return new Date(Date.UTC(1899,11,30)+v*86400000).toISOString().slice(0,10);
  const s=String(v).trim(); if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m=s.match(/^(?:(\d{1,2})[ -]([A-Za-z]{3})|([A-Za-z]{3})[- ](\d{1,2}))[, -]+(\d{4})$/);
  if(!m) return null;
  const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf((m[2]||m[3]).toLowerCase());
  return month<0?null:m[5]+'-'+String(month+1).padStart(2,'0')+'-'+String(m[1]||m[4]).padStart(2,'0');
}
const text=v=>String(v??'').trim();
export function normalize(source,rules) {
  const headers=source.values[0], rows=[]; let project='';
  for(let i=1;i<source.values.length;i++) {
    const a=source.values[i]; if(!a?.some(v=>v!==null&&v!=='')) continue;
    project=text(a[0])||project;
    if(!project||!a[2]) continue;
    const r={sourceRow:i+1,project,supplier:text(a[1]),item:text(a[2]),version:text(a[3]),amount:money(a[4]),amountRaw:text(a[4]),paid:money(a[5]),reportedUnpaid:money(a[6]),logistics:money(a[7]),date:dateISO(a[8]),dateRaw:text(a[8]),attachment:text(a[9]),priority:text(a[10]),nextAction:text(a[11]),contract:text(a[12]),paymentStage:text(a[13]),drawing:text(a[14]),production:text(a[15]),leadDays:text(a[16]),shipping:dateISO(a[17]),arrival:dateISO(a[18]),actualArrival:dateISO(a[19]),notes:[],paidSource:money(a[5])!==null?'Paid column':null};
    for(let j=20;j<headers.length;j++) {
      const name=text(headers[j]).toLowerCase();
      if(/^(payment due date|付款到期日)$/.test(name)) r.paymentDue=dateISO(a[j]);
      if(/^(next action due|行动截止日)$/.test(name)) r.actionDue=dateISO(a[j]);
      if(/^(owner|负责人)$/.test(name)) r.owner=text(a[j]);
    }
    const paidText=r.paymentStage.match(/^USD\s*([\d,]+(?:\.\d+)?)\s+Paid$/i);
    if(r.paid===null&&paidText) {r.paid=money(paidText[1]);r.paidSource='Payment Status text: '+r.paymentStage;}
    const pct=r.paymentStage.match(/^Pay-to\s*(\d+(?:\.\d+)?)%$/i);
    r.targetPct=pct&&Number(pct[1])<=100?Number(pct[1]):null;
    const groupRule=rules.groupingRules.find(x=>x.project===project&&x.items.includes(r.item));
    r.group=groupRule?.group||r.item;
    if(groupRule) r.notes.push(groupRule.note);
    r.isVO=/\bVO\b/i.test(r.attachment); if(r.isVO) r.group+=' · VO';
    for(const rule of rules.reviewRules) if(rule.project===project&&new RegExp(rule.attachmentPattern,'i').test(r.attachment)) {r.notes.push(rule.note);if(rule.excludeAmount)r.excludeAmount=true;}
    if(r.amount===null)r.notes.push('Multiple or missing quote amounts; excluded from the quote subtotal.');
    if(r.paid===null)r.notes.push('Cumulative actual payment is missing; blank is not treated as zero.');
    if(!r.date)r.notes.push('Quote date is unrecognized; latest-version selection needs review.');
    r.id=project+'|'+r.group;
    rows.push(r);
  }
  const groups=new Map();
  for(const r of rows){if(!groups.has(r.id))groups.set(r.id,[]);groups.get(r.id).push(r);}
  const latest=[],history=[];
  for(const [id,items] of groups) {
    items.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.sourceRow-b.sourceRow);
    const r={...items[0]}; r.history=items.slice(1);r.historyCount=r.history.length;
    const ties=items.filter(x=>x.date===r.date);
    if(ties.length>1&&new Set(ties.map(x=>x.amountRaw)).size>1){r.excludeAmount=true;r.notes.push('Different amounts share the same quote date. Source order is provisional; the amount is excluded pending review.');}
    r.excluded=r.contract==='Canceled';
    r.included=!r.excluded&&!r.excludeAmount&&r.amount!==null;
    r.remaining=r.included&&r.paid!==null?Math.max(0,Math.round((r.amount-r.paid)*100)/100):null;
    r.target=r.included&&r.targetPct!==null?Math.round(r.amount*r.targetPct)/100:null;
    r.currentDue=r.target!==null&&r.paid!==null?Math.max(0,Math.round((r.target-r.paid)*100)/100):null;
    if(r.paid!==null&&r.amount!==null&&r.paid>r.amount)r.notes.push('Actual payment exceeds the product quote. Check whether freight or other costs are included.');
    if(r.production&&!['Under Production','Quality Checking','Rectifying','Completed'].includes(r.production))r.notes.push('Unrecognized production value: '+r.production+'. Check whether lead time was entered in the wrong column.');
    r.stage=r.actualArrival?'Arrived':r.production==='Rectifying'?'Rectification':r.production==='Completed'?'Awaiting shipment / arrival':['Under Production','Quality Checking'].includes(r.production)?'In production':r.drawing==='Approved'?'Drawings approved':r.drawing?'Shop drawings':/Signed|Under Execution/.test(r.contract)?'Contract execution':'Quote / Contracting';
    r.urgent=r.priority==='Urgent'||r.production==='Rectifying';
    latest.push(r);history.push(...r.history);
  }
  return {fetchedAt:source.fetchedAt,sourceUrl:'https://docs.google.com/spreadsheets/d/'+source.spreadsheetId+'/edit?gid=1353027088#gid=1353027088',sourceRows:rows.length,currency:rules.currency,currencyNote:rules.currencyNote,latest,historyRows:history.length};
}
export function summarize(records) {
  const active=records.filter(r=>!r.excluded),included=active.filter(r=>r.included);
  const sum=(xs,k)=>Math.round(xs.reduce((a,r)=>a+(r[k]??0),0)*100)/100;
  return {projects:new Set(active.map(r=>r.project)).size,items:active.length,amount:sum(included,'amount'),unpriced:active.filter(r=>!r.included).length,paid:sum(active,'paid'),paidKnown:active.filter(r=>r.paid!==null).length,paidUnknown:active.filter(r=>r.paid===null).length,remaining:sum(active,'remaining'),remainingKnown:active.filter(r=>r.remaining!==null).length,target:sum(active,'target'),targetKnown:active.filter(r=>r.target!==null).length,currentDue:sum(active,'currentDue'),dueKnown:active.filter(r=>r.currentDue!==null).length,urgent:active.filter(r=>r.urgent).length};
}
