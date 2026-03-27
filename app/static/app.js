let uiMode = "single";

const state={validation:null,batchReports:null,rulesPreview:[],selectedRuleIndex:0,batchPlans:[]};
const $ = (id)=>document.getElementById(id);

const planEditor=$("planEditor");
const rulesEditor=$("rulesEditor");
const violationsTableBody=$("violationsTableBody");
const statusTableBody=$("statusTableBody");
const batchResultsBody=$("batchResultsBody");

const applicableRulesCount=$("applicableRulesCount");
const violationsCount=$("violationsCount");
const warningsCount=$("warningsCount");
const errorsCount=$("errorsCount");
const insufficientCount=$("insufficientCount");
const notApplicableCount=$("notApplicableCount");
const passedCount=$("passedCount");

const layersList=$("layersList");
const rulesList=$("rulesList");
const ruleDetails=$("ruleDetails");
const ruleSearch=$("ruleSearch");
const categoryFilter=$("categoryFilter");
const planFileInput=$("planFileInput");
const batchPlanInput=$("batchPlanInput");
const visualContainer=$("visualContainer");
const batchPlansList=$("batchPlansList");
const highlightSummary=$("highlightSummary");

const ruleModal=$("ruleModal");
const ruleModalBackdrop=$("ruleModalBackdrop");
const closeRuleModalBtn=$("closeRuleModalBtn");
const batchSidebar=$("batchSidebar");

const errorFocusModal=$("errorFocusModal");
const errorFocusBackdrop=$("errorFocusBackdrop");
const closeErrorFocusBtn=$("closeErrorFocusBtn");
const errorFocusMeta=$("errorFocusMeta");
const errorFocusVisual=$("errorFocusVisual");

function badgeClass(x){
  if(x==="error") return "error";
  if(x==="warning") return "warning";
  if(x==="insufficient_data") return "insufficient_data";
  if(x==="not_applicable") return "na";
  return "ok";
}
function severityBadge(severity){ return `<span class="badge ${badgeClass(severity)}">${severity}</span>`; }

async function apiFetch(url, options){
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}
  if(!res.ok){ throw new Error(data?.detail || text || `HTTP ${res.status}`); }
  return data ?? text;
}

function parseRulesPreview(yamlText){
  const blocks=yamlText.split(/\n(?=- id:|^id:)/gm).map(x=>x.trim()).filter(Boolean);
  return blocks.map((block)=>{
    const id=(block.match(/^(?:-\s*)?id:\s*(.+)$/m)?.[1]??"unknown").replace(/^["']|["']$/g,"");
    const title=(block.match(/^title:\s*"?(.+?)"?$/m)?.[1]??id);
    const severity=(block.match(/^severity:\s*(.+)$/m)?.[1]??"warning").replace(/^["']|["']$/g,"");
    const refs = [...block.matchAll(/-\s*"?(СП.+?)"?$/gm)].map(m=>m[1].replace(/^["']|["']$/g,""));
    const category=(block.match(/category:\s*([a-z_]+)/m)?.[1]??"");
    return {id,title,severity,refs,raw:block,category};
  });
}

function openRuleModal(text){
  if(!ruleModal || !ruleDetails) return;
  ruleDetails.textContent = text || "Нет выбранного правила.";
  ruleModal.classList.remove("hidden");
  ruleModal.setAttribute("aria-hidden", "false");
}
function closeRuleModal(){
  if(!ruleModal) return;
  ruleModal.classList.add("hidden");
  ruleModal.setAttribute("aria-hidden", "true");
}
function openErrorFocusModal(violation){
  if(!violation || !errorFocusModal) return;
  const title = `${violation.title} (${violation.rule_id})`;
  const titleEl = $("errorFocusTitle");
  if(titleEl) titleEl.textContent = title;
  const objText = (violation.feature_ids || []).join(", ") || "—";
  const fact = String(violation.value ?? "—");
  const norm = String(violation.threshold ?? "—");
  const dev = violation.details?.deviation_percent != null ? `${violation.details.deviation_percent}%` : "—";
  const msg = violation.message || "Описание ошибки отсутствует.";
  if(errorFocusMeta){
    errorFocusMeta.innerHTML =
      `<span class="focus-note-strong">Описание:</span> ${msg}<br>` +
      `<span class="focus-note-strong">Объекты:</span> ${objText}<br>` +
      `<span class="focus-note-strong">Факт:</span> ${fact}<br>` +
      `<span class="focus-note-strong">Норма:</span> ${norm}<br>` +
      `<span class="focus-note-strong">Отклонение:</span> ${dev}<br>` +
      `<span class="focus-note-strong">Severity:</span> ${violation.severity}`;
  }
  renderErrorFocusVisual(violation);
  errorFocusModal.classList.remove("hidden");
  errorFocusModal.setAttribute("aria-hidden", "false");
}
function closeErrorFocusModal(){
  if(!errorFocusModal) return;
  errorFocusModal.classList.add("hidden");
  errorFocusModal.setAttribute("aria-hidden", "true");
}

function setBatchMode(enabled) {
  uiMode = enabled ? "batch" : "single";
  const batchTab = document.querySelector('.tab[data-tab="batch"]');
  if(batchTab) batchTab.style.display = enabled ? "block" : "none";
  if(batchSidebar) batchSidebar.style.display = enabled ? "block" : "none";
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(x => x.classList.remove("active"));
  if (enabled) {
    if(batchTab) batchTab.classList.add("active");
    $("tab-batch")?.classList.add("active");
  } else {
    document.querySelector('.tab[data-tab="plan"]')?.classList.add("active");
    $("tab-plan")?.classList.add("active");
  }
}

function refreshRulesSidebar(){
  if(!rulesList || !rulesEditor) return;
  const q=ruleSearch?.value.trim().toLowerCase() || "";
  const cat=categoryFilter?.value.trim() || "";
  state.rulesPreview=parseRulesPreview(rulesEditor.value);
  const filtered=state.rulesPreview.filter(rule=>{
    const matchQ=!q||[rule.id,rule.title,rule.severity,rule.category,...(rule.refs||[])].join(" ").toLowerCase().includes(q);
    const matchC=!cat||rule.category===cat;
    return matchQ&&matchC;
  });
  const resultMap = new Map((state.validation?.rule_results || []).map(x => [x.rule_id, x]));
  rulesList.innerHTML="";
  filtered.forEach((rule,idx)=>{
    const rr=resultMap.get(rule.id);
    const badge=rr?severityBadge(rr.severity):severityBadge(rule.severity);
    const catBadge=rule.category?`<span class="badge">${rule.category}</span>`:"";
    const div=document.createElement("div");
    div.className="list-item rule-item"+(idx===state.selectedRuleIndex?" active":"");
    div.innerHTML=`<div class="rule-title">${rule.title}</div><div class="rule-id">${rule.id}</div><div class="badges">${badge}${catBadge}${(rule.refs||[]).map(ref=>`<span class="badge">${ref}</span>`).join("")}</div>`;
    div.addEventListener("click",()=>{
      state.selectedRuleIndex=idx;
      const text = rule.raw + (rr ? "\n\nstatus: " + rr.status + (rr.reason ? "\nreason: " + rr.reason : "") : "");
      openRuleModal(text);
      refreshRulesSidebar();
    });
    rulesList.appendChild(div);
  });
}

function refreshValidation(){
  const v=state.validation;
  applicableRulesCount.textContent=String(v?.applicable_rules?.length || 0);
  violationsCount.textContent=String(v?.violations?.length || 0);
  warningsCount.textContent=String(v?.summary?.warnings || 0);
  errorsCount.textContent=String(v?.summary?.errors || 0);
  insufficientCount.textContent=String(v?.summary?.insufficient_data || 0);
  notApplicableCount.textContent=String(v?.summary?.not_applicable || 0);
  passedCount.textContent=String(v?.summary?.passed || 0);

  layersList.innerHTML="";
  (v?.layers || []).forEach(layer=>{
    const div=document.createElement("div");
    div.className="list-item";
    div.innerHTML=`<div>${layer}</div><div class="muted">layer</div>`;
    layersList.appendChild(div);
  });

  violationsTableBody.innerHTML = (!v || !v.violations?.length)
    ? '<tr><td colspan="7">Нарушений нет или проверка ещё не запускалась.</td></tr>'
    : v.violations.map((x, idx)=>`<tr class="clickable-row" data-violation-idx="${idx}" title="Нажмите для просмотра на плане">
        <td>${severityBadge(x.severity)}</td>
        <td><strong>${x.title}</strong><div class="muted">${x.rule_id}</div></td>
        <td>${(x.feature_ids||[]).join(", ")}</td>
        <td>${String(x.value ?? "—")}</td>
        <td>${String(x.threshold ?? "—")}</td>
        <td>${x.details?.deviation_percent ?? "-"}%</td>
        <td>${x.message || x.details?.reason || "-"}</td>
      </tr>`).join("");

  if(v?.violations?.length){
    violationsTableBody.querySelectorAll("tr[data-violation-idx]").forEach(row=>{
      row.addEventListener("click", ()=>{
        const idx = Number(row.getAttribute("data-violation-idx"));
        openErrorFocusModal(v.violations[idx]);
      });
    });
  }

  statusTableBody.innerHTML = (!v || !v.rule_results?.length)
    ? '<tr><td colspan="3">Пока нет данных.</td></tr>'
    : v.rule_results
        .filter(x => x.status === "not_applicable" || x.status === "insufficient_data")
        .map(x => `<tr>
            <td>${severityBadge(x.status)}</td>
            <td><strong>${x.title}</strong><div class="muted">${x.rule_id}</div></td>
            <td>${x.reason || "-"}</td>
          </tr>`).join("") || '<tr><td colspan="3">Нет неприменимых правил и правил с недостатком данных.</td></tr>';

  refreshRulesSidebar();
  renderVisual();
}

function refreshBatchList(){
  batchPlansList.innerHTML = state.batchPlans.length
    ? state.batchPlans.map(p=>`<div class="list-item"><div class="rule-title">${p.name}</div><div class="muted">${(p.plan_geojson_text.length/1024).toFixed(1)} KB</div></div>`).join("")
    : '<div class="list-item"><div class="muted">Планы ещё не загружены</div></div>';
}
function refreshBatchResults(){
  const reports = state.batchReports?.reports || [];
  batchResultsBody.innerHTML = reports.length
    ? reports.map(r=>`<tr><td><strong>${r.input_name}</strong></td><td>${r.summary.warnings}</td><td>${r.summary.errors}</td><td>${r.summary.insufficient_data}</td><td>${r.summary.passed}</td><td>${r.violations.length}</td></tr>`).join("")
    : '<tr><td colspan="6">Пока нет данных.</td></tr>';
}
function buildHighlightMap(){
  const map = new Map();
  for(const v of (state.validation?.violations || [])){
    for(const id of (v.feature_ids || [])){
      const prev=map.get(id);
      if(!prev || prev==="warning") map.set(id, v.severity==="error"?"error":"warning");
    }
  }
  return map;
}
function layerStyle(layer){
  if(layer==="building") return {fill:'#dbeafe', stroke:'#1d4ed8', sw:2};
  if(layer==="road") return {fill:'none', stroke:'#111827', sw:3};
  if(layer==="network") return {fill:'none', stroke:'#16a34a', sw:3};
  if(layer==="red_line") return {fill:'none', stroke:'#dc2626', sw:3};
  if(layer==="green") return {fill:'#dcfce7', stroke:'#15803d', sw:2};
  if(layer==="playground") return {fill:'#ede9fe', stroke:'#7c3aed', sw:2};
  if(layer==="dog_area") return {fill:'#fef3c7', stroke:'#d97706', sw:2};
  if(layer==="sport_area") return {fill:'#cffafe', stroke:'#0891b2', sw:2};
  if(layer==="parking") return {fill:'#e5e7eb', stroke:'#475569', sw:2};
  if(layer==="industrial") return {fill:'#fecaca', stroke:'#b91c1c', sw:2};
  if(layer==="turnaround") return {fill:'#fde68a', stroke:'#a16207', sw:2};
  if(layer==="site_boundary") return {fill:'none', stroke:'#0f172a', sw:2};
  if(layer==="pedestrian_path") return {fill:'none', stroke:'#8b5cf6', sw:3};
  if(layer==="arch") return {fill:'#e0e7ff', stroke:'#4338ca', sw:2};
  return {fill:'#e5e7eb', stroke:'#64748b', sw:2};
}
function renderVisual(){
  if(!visualContainer || !planEditor) return;
  try{
    const data = JSON.parse(planEditor.value);
    const feats = data.features || [];
    if(!feats.length){ visualContainer.innerHTML='<div class="muted">Нет объектов для визуализации.</div>'; highlightSummary.textContent='Нет объектов.'; return; }
    const pts=[];
    feats.forEach(f=>{ const g=f.geometry||{}; if(g.type==="Polygon"){(g.coordinates[0]||[]).forEach(p=>pts.push(p));} else if(g.type==="LineString"){(g.coordinates||[]).forEach(p=>pts.push(p));}});
    if(!pts.length){ visualContainer.innerHTML='<div class="muted">Нет поддерживаемой геометрии.</div>'; return; }
    const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
    const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
    const pad=30, svgW=1100, svgH=680, w=maxX-minX||1, h=maxY-minY||1;
    const scale=Math.min((svgW-2*pad)/w,(svgH-2*pad)/h);
    const tx=x=>pad+(x-minX)*scale, ty=y=>svgH-pad-(y-minY)*scale;
    const highlightMap=buildHighlightMap();
    highlightSummary.textContent = highlightMap.size ? `Подсвечено объектов: ${highlightMap.size}. Красный = error, жёлтый = warning.` : 'Нарушивших объектов пока нет.';
    const parts=feats.map(f=>{
      const layer=f.properties?.layer||'unknown', fid=f.properties?.id||f.id||'', sev=highlightMap.get(fid), g=f.geometry||{}, style=layerStyle(layer);
      let extra='';
      if(sev==="warning") extra='stroke:#f59e0b;stroke-width:6';
      if(sev==="error") extra='stroke:#dc2626;stroke-width:6';
      if(g.type==="Polygon"){
        const coords=g.coordinates[0]||[];
        const poly=coords.map(p=>`${tx(p[0])},${ty(p[1])}`).join(' ');
        const c=coords.reduce((a,p)=>[a[0]+p[0],a[1]+p[1]],[0,0]); const n=Math.max(coords.length,1);
        return `${sev?`<polygon points="${poly}" style="fill:none;${extra}" />`:''}<polygon points="${poly}" style="fill:${style.fill};stroke:${style.stroke};stroke-width:${style.sw}" /><text x="${tx(c[0]/n)}" y="${ty(c[1]/n)}" class="geom-label">${fid}</text>`;
      }
      if(g.type==="LineString"){
        const line=(g.coordinates||[]).map(p=>`${tx(p[0])},${ty(p[1])}`).join(' ');
        const mid=g.coordinates[Math.floor((g.coordinates||[]).length/2)]||[minX,minY];
        return `${sev?`<polyline points="${line}" style="fill:none;${extra}" />`:''}<polyline points="${line}" style="fill:none;stroke:${style.stroke};stroke-width:${style.sw}" /><text x="${tx(mid[0])}" y="${ty(mid[1])-4}" class="geom-label">${fid}</text>`;
      }
      return '';
    }).join('');
    visualContainer.innerHTML=`<svg class="visual-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">${parts}</svg>`;
  }catch(e){
    visualContainer.innerHTML=`<div class="muted">Ошибка визуализации: ${e.message}</div>`;
    highlightSummary.textContent='Не удалось построить визуализацию.';
  }
}
function renderErrorFocusVisual(violation){
  if(!errorFocusVisual || !planEditor) return;
  try{
    const data = JSON.parse(planEditor.value);
    const feats = data.features || [];
    if(!feats.length){ errorFocusVisual.innerHTML='<div class="muted">Нет объектов для визуализации.</div>'; return; }
    const pts=[];
    feats.forEach(f=>{ const g=f.geometry||{}; if(g.type==="Polygon"){(g.coordinates[0]||[]).forEach(p=>pts.push(p));} else if(g.type==="LineString"){(g.coordinates||[]).forEach(p=>pts.push(p));}});
    if(!pts.length){ errorFocusVisual.innerHTML='<div class="muted">Нет поддерживаемой геометрии.</div>'; return; }
    const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
    const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
    const pad=30, svgW=1100, svgH=680, w=maxX-minX||1, h=maxY-minY||1;
    const scale=Math.min((svgW-2*pad)/w,(svgH-2*pad)/h);
    const tx=x=>pad+(x-minX)*scale, ty=y=>svgH-pad-(y-minY)*scale;
    const focusIds = new Set(violation.feature_ids || []);
    const parts=feats.map(f=>{
      const layer=f.properties?.layer||'unknown', fid=f.properties?.id||f.id||'', g=f.geometry||{}, style=layerStyle(layer);
      const focused = focusIds.has(fid);
      const outline = focused ? (violation.severity==="error" ? 'stroke:#dc2626;stroke-width:7' : 'stroke:#f59e0b;stroke-width:7') : '';
      const opacity = focused ? 1 : 0.35;
      if(g.type==="Polygon"){
        const coords=g.coordinates[0]||[];
        const poly=coords.map(p=>`${tx(p[0])},${ty(p[1])}`).join(' ');
        const c=coords.reduce((a,p)=>[a[0]+p[0],a[1]+p[1]],[0,0]); const n=Math.max(coords.length,1);
        return `${focused?`<polygon points="${poly}" style="fill:none;${outline}" />`:''}<polygon points="${poly}" style="fill:${style.fill};stroke:${style.stroke};stroke-width:${style.sw};opacity:${opacity}" /><text x="${tx(c[0]/n)}" y="${ty(c[1]/n)}" class="geom-label">${fid}</text>`;
      }
      if(g.type==="LineString"){
        const line=(g.coordinates||[]).map(p=>`${tx(p[0])},${ty(p[1])}`).join(' ');
        const mid=g.coordinates[Math.floor((g.coordinates||[]).length/2)]||[minX,minY];
        return `${focused?`<polyline points="${line}" style="fill:none;${outline}" />`:''}<polyline points="${line}" style="fill:none;stroke:${style.stroke};stroke-width:${style.sw};opacity:${opacity}" /><text x="${tx(mid[0])}" y="${ty(mid[1])-4}" class="geom-label">${fid}</text>`;
      }
      return '';
    }).join('');
    errorFocusVisual.innerHTML=`<svg class="visual-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">${parts}</svg>`;
  }catch(e){
    errorFocusVisual.innerHTML=`<div class="muted">Ошибка визуализации: ${e.message}</div>`;
  }
}

async function loadDemo(){
  const data=await apiFetch("/api/demo");
  planEditor.value=data.plan_geojson_text;
  rulesEditor.value=data.rules_yaml_text;
  state.validation=null;
  refreshRulesSidebar();
  refreshValidation();
  renderVisual();
}
async function validate(){
  state.validation=await apiFetch("/api/validate",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({plan_geojson_text:planEditor.value || "",rules_yaml_text:rulesEditor.value || ""})
  });
  refreshValidation();
}
async function runBatch(){
  if(!state.batchPlans.length){ alert("Сначала загрузите несколько планов"); return; }
  state.batchReports=await apiFetch("/api/batch-validate",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({plans:state.batchPlans,rules_yaml_text:rulesEditor.value || ""})
  });
  refreshBatchResults();
}
function downloadReport(){
  const payload=JSON.stringify({single:state.validation,batch:state.batchReports},null,2);
  const blob=new Blob([payload],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download="validation_report.json"; a.click();
  URL.revokeObjectURL(url);
}
function setupTabs(){
  document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
    const target=btn.getAttribute("data-tab");
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${target}`)?.classList.add("active");
    if(target==="visual") renderVisual();
  }));
}
function setupPlanUpload(){
  $("uploadPlanBtn")?.addEventListener("click",e=>{e.preventDefault(); planFileInput.click();});
  planFileInput?.addEventListener("change",event=>{
    const file=event.target.files?.[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{ planEditor.value=String(reader.result||""); state.validation=null; refreshValidation(); renderVisual(); };
    reader.readAsText(file,"utf-8");
  });
}
function setupBatchUpload(){
  $("uploadBatchBtn")?.addEventListener("click",e=>{e.preventDefault(); batchPlanInput.click();});
  batchPlanInput?.addEventListener("change",async event=>{
    const files=Array.from(event.target.files||[]);
    const loaded=await Promise.all(files.map(file=>new Promise(resolve=>{
      const reader=new FileReader();
      reader.onload=()=>resolve({name:file.name, plan_geojson_text:String(reader.result||"")});
      reader.readAsText(file,"utf-8");
    })));
    state.batchPlans=loaded;
    refreshBatchList();
  });
}

$("loadDemoBtn")?.addEventListener("click",()=>loadDemo().catch(err=>alert(err.message)));
$("validateBtn")?.addEventListener("click",()=>validate().catch(err=>alert(err.message)));
$("runBatchBtn")?.addEventListener("click",()=>runBatch().catch(err=>alert(err.message)));
$("downloadReportBtn")?.addEventListener("click",downloadReport);
$("openBatchBtn")?.addEventListener("click",()=>setBatchMode(true));
$("exitBatchBtn")?.addEventListener("click",()=>setBatchMode(false));
closeRuleModalBtn?.addEventListener("click", closeRuleModal);
ruleModalBackdrop?.addEventListener("click", closeRuleModal);
closeErrorFocusBtn?.addEventListener("click", closeErrorFocusModal);
errorFocusBackdrop?.addEventListener("click", closeErrorFocusModal);
document.addEventListener("keydown", (e)=>{ if(e.key === "Escape"){ closeRuleModal(); closeErrorFocusModal(); } });
ruleSearch?.addEventListener("input",refreshRulesSidebar);
categoryFilter?.addEventListener("change",refreshRulesSidebar);
planEditor?.addEventListener("input",()=>{if(document.getElementById("tab-visual")?.classList.contains("active")) renderVisual();});
setupTabs();
setupPlanUpload();
setupBatchUpload();
setBatchMode(false);
loadDemo().then(refreshBatchList).catch(err=>alert(err.message));
