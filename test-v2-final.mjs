import PptxGenJS from "pptxgenjs";
import fs from "fs";

const rawMd = fs.readFileSync("attached_assets/Inteligência_Artificial_para_Aumentar_a_Produtividade_no_Trabal_1772947964757.md", "utf-8");
const moduleChunks = rawMd.split(/^# Módulo \d+:/gm).filter(s => s.trim().length > 50);
const modules = moduleChunks.map((chunk, i) => {
  const firstLine = chunk.trim().split("\n")[0].trim();
  return { title: firstLine || `Módulo ${i+1}`, content: "# " + firstLine + "\n" + chunk };
});
const course = { title: "Inteligência Artificial para Aumentar a Produtividade no Trabalho" };

function sanitize(t) {
  if(!t) return "";
  return t.replace(/&quot;/g,'"').replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&apos;/g,"'")
    .replace(/&#(\d+);/g,(_,c)=>String.fromCharCode(parseInt(c)))
    .replace(/\u00AD/g,"").replace(/\uFFFD/g,"").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,"").replace(/\s+/g," ").trim();
}
function cleanMarkdown(t) {
  if(!t) return "";
  return t.replace(/\*\*([^*]+)\*\*/g,"$1").replace(/__([^_]+)__/g,"$1").replace(/\*([^*]+)\*/g,"$1").replace(/_([^_]+)_/g,"$1")
    .replace(/`([^`]+)`/g,"$1").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/^#+\s*/gm,"").replace(/^[-*+]\s+/gm,"")
    .replace(/^\d+\.\s+/gm,"").replace(/^>\s*/gm,"").trim();
}
function ensureSentenceEnd(t){if(!t)return"";t=t.trim();if(!t)return"";if(/[.!?…]$/.test(t))return t;return t+".";}
function isSentenceComplete(t){if(!t||t.trim().length<5)return true;const s=t.trim();if(/[.!?…;:]$/.test(s))return true;if(/\s(de|da|do|das|dos|na|no|nas|nos|em|para|por|com|ao|à|que|seu|sua|sem|como)\s*$/i.test(s))return false;return true;}
function repairSentence(t){const s=t.trim();if(!isSentenceComplete(s)){const m=s.match(/^(.+[.!?…;:])\s/);if(m)return m[1];}return ensureSentenceEnd(s);}
function smartTruncate(t,max){if(t.length<=max)return t;let cut=t.substring(0,max-3);const li=Math.max(cut.lastIndexOf(". "),cut.lastIndexOf("! "),cut.lastIndexOf("? "));if(li>max*0.5)return cut.substring(0,li+1);const lw=cut.lastIndexOf(" ");if(lw>max*0.6)cut=cut.substring(0,lw);return cut.replace(/[,;:\s]+$/,"")+"...";}

function splitLongItem(text, maxLen) {
  const danglingRe = /\s(de|da|do|das|dos|na|no|nas|nos|em|para|por|com|ao|à|a|o|as|os|e|ou|que|seu|sua|seus|suas|sem|como|mais)\s*$/i;
  if(text.length <= maxLen) return [text];
  const parts = [];
  let remaining = text;
  while(remaining.length > maxLen) {
    const cutZone = remaining.substring(0, maxLen);
    const splitAt = Math.max(cutZone.lastIndexOf(". "), cutZone.lastIndexOf("! "), cutZone.lastIndexOf("? "));
    if(splitAt > maxLen * 0.4) { let part = remaining.substring(0, splitAt + 1).trim(); if(danglingRe.test(part)) { const backUp = part.lastIndexOf(" ", part.length - 4); if(backUp > maxLen * 0.3) { part = remaining.substring(0, backUp).trim() + "."; remaining = remaining.substring(backUp).trim(); parts.push(part); continue; } } parts.push(part); remaining = remaining.substring(splitAt + 1).trim(); }
    else { const wb = cutZone.lastIndexOf(" "); if(wb > maxLen * 0.5) { parts.push(remaining.substring(0, wb).trim() + "."); remaining = remaining.substring(wb).trim(); } else { parts.push(remaining.substring(0, maxLen - 3).trim() + "..."); remaining = remaining.substring(maxLen - 3).trim(); } }
  }
  if(remaining.length > 3) parts.push(remaining);
  return parts;
}

const SECTION_EMOJI_MAP={"🎯":"objectives","🧠":"fundamentals","⚙️":"process","🧩":"models","🛠️":"example","💡":"applications","⚠️":"challenges","💭":"reflection","📝":"summary","🧾":"summary","📌":"takeaways"};
const SECTION_LABEL_MAP={objectives:"OBJETIVOS",fundamentals:"FUNDAMENTOS",process:"COMO FUNCIONA",models:"MODELOS E TIPOS",example:"EXEMPLO PRÁTICO",applications:"APLICAÇÕES REAIS",challenges:"DESAFIOS E CUIDADOS",reflection:"REFLEXÃO",summary:"RESUMO DO MÓDULO",takeaways:"KEY TAKEAWAYS",generic:"CONTEÚDO"};
const PEDAGOGICAL_LAYOUT_MAP={objectives:"bullets",fundamentals:"definition",process:"process_timeline",models:"comparison_table",example:"example_highlight",applications:"grid_cards",challenges:"warning_callout",reflection:"reflection_callout",summary:"summary_slide",takeaways:"numbered_takeaways",generic:"bullets"};

function parseModuleContent(content){
  const lines=content.split("\n");const blocks=[];let currentBullets=[];let currentSectionHint=null;
  function flushBullets(){if(currentBullets.length>0){blocks.push({type:"list",items:[...currentBullets],sectionHint:currentSectionHint});currentBullets=[];}}
  for(const line of lines){
    const trimmed=line.trim();
    if(!trimmed){flushBullets();continue;}
    const headingMatch=trimmed.match(/^(#{1,4})\s+(.+)$/);
    if(headingMatch){flushBullets();const level=headingMatch[1].length;const rawTitle=headingMatch[2];
      let sectionHint=null;for(const[emoji,hint]of Object.entries(SECTION_EMOJI_MAP)){if(rawTitle.includes(emoji)){sectionHint=hint;break;}}
      currentSectionHint=sectionHint;
      const cleanTitle=sanitize(cleanMarkdown(rawTitle.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu,"").replace(/[⚙️🛠️⚠️]/g,"")));
      blocks.push({type:"heading",headingLevel:level,heading:cleanTitle,content:cleanTitle,sectionHint});continue;}
    const tableMatch=trimmed.match(/^\|(.+)\|$/);
    if(tableMatch){flushBullets();const cells=tableMatch[1].split("|").map(c=>c.trim());
      if(cells.every(c=>/^[-:]+$/.test(c)))continue;
      const lastBlock=blocks[blocks.length-1];
      if(lastBlock&&lastBlock.type==="table"){lastBlock.tableRows.push(cells.map(c=>sanitize(cleanMarkdown(c))));}
      else{blocks.push({type:"table",tableHeaders:cells.map(c=>sanitize(cleanMarkdown(c))),tableRows:[]});}continue;}
    const bulletMatch=trimmed.match(/^[-*+]\s+(.+)/);const numMatch=trimmed.match(/^\d+[.)]\s+(.+)/);
    if(bulletMatch){currentBullets.push(bulletMatch[1]);continue;}
    if(numMatch){currentBullets.push(numMatch[1]);continue;}
    const blockquoteMatch=trimmed.match(/^>\s*(.+)$/);
    if(blockquoteMatch){flushBullets();const bqContent=sanitize(cleanMarkdown(blockquoteMatch[1]));
      if(bqContent.length>10){blocks.push({type:"paragraph",content:bqContent,sectionHint:"reflection"});}continue;}
    const labelMatch=trimmed.match(/^\*\*([^*]+)\*\*\s*[:–-]\s*(.+)/);
    if(labelMatch){flushBullets();blocks.push({type:"label_value",heading:sanitize(cleanMarkdown(labelMatch[1])),items:[sanitize(cleanMarkdown(labelMatch[2]))],content:sanitize(cleanMarkdown(trimmed))});continue;}
    flushBullets();
    if(trimmed.length>10&&!/^<br>$/.test(trimmed)&&!/^<\/?div>$/.test(trimmed)){blocks.push({type:"paragraph",content:sanitize(cleanMarkdown(trimmed)),sectionHint:currentSectionHint});}
  }
  flushBullets();return blocks;
}

function segmentBlocks(blocks){
  const sections=[];let current=null;let counter=0;
  function pushCurrent(){if(current&&current.blocks.length>0)sections.push(current);}
  for(const block of blocks){
    if(block.type==="heading"&&block.headingLevel&&block.headingLevel<=4){
      if(block.headingLevel<=3||block.sectionHint){pushCurrent();counter++;
        const pedType=block.sectionHint||"generic";
        const headingText=(block.heading||block.content||"").toUpperCase();
        const sectionLabel=pedType!=="generic"?(SECTION_LABEL_MAP[pedType]||headingText||"CONTEÚDO"):(headingText.length>=5?headingText:"CONTEÚDO");
        current={id:`section-${counter}`,title:block.heading||block.content,sectionLabel,pedagogicalType:pedType,blocks:[]};continue;}
      if(current){current.blocks.push(block);continue;}
    }
    if(!current){counter++;const pedType=block.sectionHint||"generic";
      current={id:`section-${counter}`,title:"Introdução",sectionLabel:SECTION_LABEL_MAP[pedType]||"CONTEÚDO",pedagogicalType:pedType,blocks:[]};}
    current.blocks.push(block);
  }
  pushCurrent();return sections;
}

function collectSectionItems(section){
  const items=[];
  for(const block of section.blocks){
    if(block.items&&block.items.length>0){for(const item of block.items){const c=sanitize(cleanMarkdown(item));if(c.length>3)items.push(c);}}
    else if(block.type==="paragraph"&&block.content.length>10){items.push(block.content);}
    else if(block.type==="label_value"&&block.heading){const val=block.items&&block.items[0]?block.items[0]:block.content;items.push(`${block.heading}: ${val}`);}
  }
  return items;
}
function validateAndRepairItems(items){return items.map(item=>{if(!isSentenceComplete(item))return repairSentence(item);return ensureSentenceEnd(item);});}
function mergeShortItems(items,maxChars){if(items.length<=1)return items;const merged=[];let i=0;while(i<items.length){const cur=items[i];if(i+1<items.length&&cur.length<60&&items[i+1].length<60&&cur.length+items[i+1].length+2<=maxChars){merged.push(cur+". "+items[i+1]);i+=2;}else{merged.push(cur);i++;}}return merged;}
function redistributeOverflow(items,maxPerSlide,maxChars){let working=items;if(working.length>maxPerSlide){working=mergeShortItems(working,maxChars);}if(working.length<=maxPerSlide)return[working];const chunks=[];for(let i=0;i<working.length;i+=maxPerSlide){chunks.push(working.slice(i,i+maxPerSlide));}return chunks;}

const maxItems=7;const maxChars=180;

console.log("Found "+modules.length+" modules\n");

const pptx=new PptxGenJS();pptx.defineLayout({name:"CUSTOM",w:13.333,h:7.5});pptx.layout="CUSTOM";
let totalSlides=0;let totalContinuation=0;

let slide=pptx.addSlide();slide.background={color:"1a1a2e"};
slide.addText(sanitize(course.title),{x:0.8,y:2,w:11.7,h:1.5,fontSize:36,color:"FFFFFF",fontFace:"Montserrat",bold:true});
slide.addText("Gerado por EduGenAI",{x:0.8,y:4,w:11.7,h:0.6,fontSize:16,color:"AAAAAA",fontFace:"Open Sans"});
totalSlides++;

slide=pptx.addSlide();slide.background={color:"FFFFFF"};
slide.addText("O que você vai aprender",{x:0.8,y:0.5,w:11.7,h:0.8,fontSize:28,color:"1a1a2e",fontFace:"Montserrat",bold:true});
modules.forEach((m,i)=>{slide.addText(sanitize(m.title),{x:1.2,y:1.6+i*0.7,w:10,h:0.6,fontSize:14,color:"333333",fontFace:"Open Sans"});});
totalSlides++;

for(let mi=0;mi<modules.length;mi++){
  const mod=modules[mi];const blocks=parseModuleContent(mod.content);
  console.log(`[STAGE 1] Parsing module ${mi+1}: "${sanitize(mod.title).substring(0,70)}"`);console.log(`  → ${blocks.length} blocks parsed`);
  const sections=segmentBlocks(blocks);
  console.log(`[STAGE 2] Segmenting...`);console.log(`  → ${sections.length} sections: ${sections.map(s=>s.pedagogicalType).join(", ")}`);
  console.log(`  → Labels: ${sections.map(s=>s.sectionLabel).join(", ")}`);
  const objSection=sections.find(s=>s.pedagogicalType==="objectives");
  const objItems=objSection?validateAndRepairItems(collectSectionItems(objSection)).slice(0,3):[];
  const slidePlans=[];
  slidePlans.push({layout:"module_cover",title:sanitize(mod.title),subtitle:`MÓDULO ${String(mi+1).padStart(2,"0")}`,objectives:objItems});
  for(const section of sections){
    if(section.pedagogicalType==="objectives")continue;
    const layout=PEDAGOGICAL_LAYOUT_MAP[section.pedagogicalType]||"bullets";
    if(layout==="comparison_table"){
      const tableBlock=section.blocks.find(b=>b.type==="table"&&b.tableHeaders&&b.tableRows&&b.tableRows.length>0);
      if(tableBlock){slidePlans.push({layout:"comparison_table",title:section.title,sectionLabel:section.sectionLabel,tableHeaders:tableBlock.tableHeaders,tableRows:tableBlock.tableRows.slice(0,6)});
        const nonTableItems=validateAndRepairItems(collectSectionItems({...section,blocks:section.blocks.filter(b=>b.type!=="table")}));
        if(nonTableItems.length>0){const split=nonTableItems.flatMap(it=>splitLongItem(it,maxChars));const chunks=redistributeOverflow(split,maxItems,maxChars);for(let ci=0;ci<chunks.length;ci++){if(ci>0)totalContinuation++;slidePlans.push({layout:"bullets",title:ci>0?`${section.title} (Parte ${ci+2})`:section.title,sectionLabel:section.sectionLabel,items:chunks[ci]});}}
        continue;}}
    const rawItems=collectSectionItems(section);const repairedItems=validateAndRepairItems(rawItems);
    const validItems=repairedItems.flatMap(it=>splitLongItem(it,maxChars));
    if(validItems.length===0){slidePlans.push({layout,title:section.title,sectionLabel:section.sectionLabel,items:[ensureSentenceEnd(section.title)]});continue;}
    const chunks=redistributeOverflow(validItems,maxItems,maxChars);
    for(let ci=0;ci<chunks.length;ci++){const isCont=ci>0;const slideTitle=isCont?`${section.title} (Parte ${ci+1})`:section.title;
      const finalItems=chunks[ci].map(item=>item.length>maxChars?smartTruncate(item,maxChars):item);
      if(isCont)totalContinuation++;
      slidePlans.push({layout:isCont?"bullets":layout,title:slideTitle,sectionLabel:section.sectionLabel,items:finalItems});}
  }
  console.log(`[STAGE 3] Distributing... → ${slidePlans.length} slide plans`);
  console.log(`[STAGE 4] Rendering ${slidePlans.length} slides...`);
  for(const plan of slidePlans){
    const s=pptx.addSlide();s.background={color:"FFFFFF"};
    if(plan.sectionLabel)s.addText(plan.sectionLabel,{x:0.8,y:0.3,w:11.7,h:0.4,fontSize:11,color:"888888",fontFace:"Open Sans",bold:true});
    s.addText(plan.title||"",{x:0.8,y:0.7,w:11.7,h:0.8,fontSize:24,color:"1a1a2e",fontFace:"Montserrat",bold:true});
    if(plan.items){plan.items.forEach((item,idx)=>{s.addText(item,{x:1.0,y:1.8+idx*0.75,w:11,h:0.65,fontSize:15,color:"333333",fontFace:"Open Sans"});});}
    if(plan.tableHeaders){const colW=11/plan.tableHeaders.length;
      plan.tableHeaders.forEach((h,ci)=>{s.addText(h,{x:0.8+ci*colW,y:1.8,w:colW,h:0.5,fontSize:13,color:"FFFFFF",fontFace:"Open Sans",bold:true,fill:{color:"1a1a2e"}});});
      (plan.tableRows||[]).forEach((row,ri)=>{row.forEach((cell,ci)=>{s.addText(cell,{x:0.8+ci*colW,y:2.4+ri*0.45,w:colW,h:0.4,fontSize:12,color:"333333",fontFace:"Open Sans"});});});}
    if(plan.objectives){plan.objectives.forEach((o,i)=>{s.addText(`${i+1}. ${o}`,{x:1.2,y:3.5+i*0.6,w:10.5,h:0.5,fontSize:14,color:"555555",fontFace:"Open Sans"});});}
    totalSlides++;
    console.log(`  ✓ ${plan.layout}: "${(plan.title||"").substring(0,50)}"`);
  }
  console.log("");
}

slide=pptx.addSlide();slide.background={color:"1a1a2e"};
slide.addText("Obrigado!",{x:0.8,y:2.5,w:11.7,h:1.2,fontSize:36,color:"FFFFFF",fontFace:"Montserrat",bold:true,align:"center"});
slide.addText(sanitize(course.title),{x:0.8,y:4,w:11.7,h:0.6,fontSize:16,color:"AAAAAA",fontFace:"Open Sans",align:"center"});
totalSlides++;

console.log("[STAGE 5] Writing PPTX...\n");
await pptx.writeFile({fileName:"test-output-v2-7mod.pptx"});
const stat=fs.statSync("test-output-v2-7mod.pptx");
console.log(`✅ PPTX generated: test-output-v2-7mod.pptx`);
console.log(`   Total slides: ${totalSlides}`);
console.log(`   Continuation slides: ${totalContinuation}`);
console.log(`   File size: ${(stat.size/1024).toFixed(1)} KB`);

console.log(`\n═══ QUALITY ANALYSIS (from PPTX binary) ═══`);
const AdmZip=(await import("adm-zip")).default;
const zip=new AdmZip("test-output-v2-7mod.pptx");
const entries=zip.getEntries();
const slideEntries=entries.filter(e=>e.entryName.startsWith("ppt/slides/slide")&&e.entryName.endsWith(".xml"));
let allTexts=[];let htmlEntitySlides=0;
for(const entry of slideEntries){const xml=entry.getData().toString("utf-8");
  const texts=[...xml.matchAll(/<a:t>([^<]+)<\/a:t>/g)].map(m=>m[1].trim()).filter(t=>t.length>0);
  if(texts.some(t=>/&quot;|&amp;(?!amp;)|&lt;|&gt;/.test(t)))htmlEntitySlides++;
  for(const t of texts){if(t.length>10)allTexts.push(t);}}
let incomplete=0,total=0,over180=0,shortTitles=0;
const danglingPattern=/\s(de|da|do|das|dos|na|no|nas|nos|em|para|por|com|ao|à|a|o|as|os|e|ou|que|seu|sua|seus|suas|sem|como|mais)\s*$/i;
for(const text of allTexts){if(text.length<15)continue;total++;
  const stripped=text.replace(/[.;:!?]+$/,"").trim();
  if(danglingPattern.test(stripped))incomplete++;
  if(text.length>180)over180++;}

// Check for CONTEÚDO labels
let conteudoLabels=0;
for(const entry of slideEntries){const xml=entry.getData().toString("utf-8");
  const texts=[...xml.matchAll(/<a:t>([^<]+)<\/a:t>/g)].map(m=>m[1].trim());
  if(texts.some(t=>t==="CONTEÚDO"))conteudoLabels++;}

for(const entry of slideEntries){const xml=entry.getData().toString("utf-8");
  const texts=[...xml.matchAll(/<a:t>([^<]+)<\/a:t>/g)].map(m=>m[1].trim()).filter(t=>t.length>0);
  const title=texts.find(t=>t.length>3&&!/^\d/.test(t)&&!/^MÓDULO/.test(t));
  if(title&&title.length<10&&!/Resumo/.test(title))shortTitles++;}
console.log(`  Total content items: ${total}`);
console.log(`  Incomplete sentences: ${incomplete}`);
console.log(`  Items > 180 chars: ${over180}`);
console.log(`  Short titles (<10 chars): ${shortTitles}`);
console.log(`  "CONTEÚDO" generic labels: ${conteudoLabels}`);
console.log(`  Continuation slides: ${totalContinuation}`);
console.log(`  Slides with HTML entities (XML): ${htmlEntitySlides}`);
console.log(`  Sentence integrity: ${((1-incomplete/total)*100).toFixed(1)}%`);

// Show any remaining over-180 items
if(over180>0){console.log("\n  ⚠ Items > 180 chars:");for(const t of allTexts){if(t.length>180)console.log(`    (${t.length}) "${t.substring(0,100)}..."`);}};
if(incomplete>0){console.log("\n  ⚠ Incomplete sentences:");for(const t of allTexts){if(t.length>=15){const s=t.replace(/[.;:!?]+$/,"").trim();if(danglingPattern.test(s))console.log(`    "${t.substring(0,100)}"`);}}}
