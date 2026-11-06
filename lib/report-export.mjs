import fs from 'node:fs';
import path from 'node:path';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, PageOrientation, HeadingLevel, AlignmentType, VerticalAlign, TableLayoutType, BorderStyle, Footer, PageNumber } from 'docx';

export const MAX_REPORT_BYTES = 10_000_000;
export class ReportInputError extends Error {}
const text = (value, limit) => {
  if(value===null||value===undefined)return '';
  if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw new ReportInputError('Report cells must contain text or numbers.');
  const result=String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/\t/g,' ');
  if(result.length>limit)throw new ReportInputError('Report text is too long. Narrow the report or shorten long notes.');
  return result;
};
export function validateReport(input) {
  if(!input||typeof input!=='object')throw new ReportInputError('Choose a report to export.');
  const title=text(input.title,120).trim();
  if(!title||!Array.isArray(input.columns)||input.columns.length<1||input.columns.length>24||!Array.isArray(input.rows)||input.rows.length>20000)throw new ReportInputError('Export at most 20,000 rows and 24 columns. Choose a shorter period or fewer employees.');
  const columns=input.columns.map(c=>text(c,80));
  if(columns.some(c=>!c.trim()))throw new ReportInputError('Report columns need headings.');
  const rows=input.rows.map(row=>{
    if(!Array.isArray(row)||row.length!==columns.length)throw new ReportInputError('Every report row must match its column headings.');
    return row.map(cell=>text(cell,2000));
  });
  const filename=text(input.filename||title,150).replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,120)||'haaziry-report';
  return {title,columns,rows,caption:text(input.caption,2000),summary:text(input.summary,2000),filename};
}
export function reportColumnGroups(columns) {
  if(columns.length<=10)return [columns.map((_,i)=>i)];
  const groups=[];
  for(let i=2;i<columns.length;i+=8)groups.push([0,1,...columns.slice(i,i+8).map((_,offset)=>i+offset)]);
  return groups;
}
const weights = columns => columns.map(label=>/employee$|name|details|note|reason|source|supervisor|action|business|department/i.test(label)?2:1);
const generated = () => new Date().toLocaleString('en-GB',{timeZone:'Asia/Karachi',hour12:false})+' PKT';
let font;
function addReportFont(pdf){
  font ||= fs.readFileSync(path.join(process.cwd(),'assets','report-font.ttf')).toString('base64');
  pdf.addFileToVFS('report-font.ttf',font);pdf.addFont('report-font.ttf','Report','normal');
}
export function buildPdf(report) {
  const pdf=new jsPDF({orientation:'landscape',unit:'pt',format:'a4',compress:true,putOnlyUsedFonts:true});
  addReportFont(pdf);
  const width=pdf.internal.pageSize.getWidth(),height=pdf.internal.pageSize.getHeight(),usable=width-72;
  const groups=reportColumnGroups(report.columns),stamp=generated();
  groups.forEach((indexes,groupIndex)=>{
    if(groupIndex)pdf.addPage();
    const firstPage=pdf.getNumberOfPages();
    pdf.setFont('helvetica','bold');pdf.setTextColor(70);pdf.setFontSize(9);pdf.text('HAAZIRY',36,31);
    pdf.setTextColor(0);pdf.setFontSize(19);pdf.text(report.title,36,57);
    pdf.setFont('Report','normal');pdf.setFontSize(9);
    let y=76;
    for(const line of [report.caption,report.summary,`${report.rows.length} records | Generated ${stamp}`,groups.length>1?`Report details ${groupIndex+1} of ${groups.length}`:''].filter(Boolean)){
      const lines=pdf.splitTextToSize(line,usable);pdf.text(lines,36,y);y+=lines.length*11+7;
    }
    const labels=indexes.map(i=>report.columns[i]),w=weights(labels),total=w.reduce((a,b)=>a+b,0);
    const columnStyles=Object.fromEntries(w.map((weight,i)=>[i,{cellWidth:usable*weight/total}]));
    autoTable(pdf,{head:[labels],body:report.rows.map(row=>indexes.map(i=>row[i])),startY:y+3,margin:{top:64,bottom:36,left:36,right:36},tableWidth:usable,showHead:'everyPage',theme:'grid',rowPageBreak:'avoid',
      styles:{font:'Report',fontStyle:'normal',fontSize:8,cellPadding:5,overflow:'linebreak',valign:'middle',lineColor:[217,217,217],lineWidth:0.35,textColor:20},
      headStyles:{font:'helvetica',fontStyle:'bold',fillColor:[36,62,82],textColor:255,fontSize:8.5},alternateRowStyles:{fillColor:[245,248,250]},columnStyles,
      didDrawPage:()=>{if(pdf.getCurrentPageInfo().pageNumber!==firstPage){pdf.setFont('helvetica','bold');pdf.setFontSize(11);pdf.setTextColor(0);pdf.text('Haaziry '+report.title,36,28);pdf.setFont('Report','normal');pdf.setFontSize(8);pdf.text(pdf.splitTextToSize(report.caption,usable).slice(0,2),36,42);}}
    });
    if(!report.rows.length){pdf.setFont('Report','normal');pdf.setFontSize(9);pdf.text('No records match the selected filters.',36,y+45);}
  });
  for(let page=1;page<=pdf.getNumberOfPages();page++){pdf.setPage(page);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(90);pdf.text('Haaziry | '+stamp,36,height-18);pdf.text(`Page ${page} of ${pdf.getNumberOfPages()}`,width-36,height-18,{align:'right'});}
  return new Uint8Array(pdf.output('arraybuffer'));
}
export async function buildDocx(report) {
  const width=15398,groups=reportColumnGroups(report.columns),stamp=generated();
  const p=(value,options={})=>new Paragraph({spacing:{after:100},children:[new TextRun({text:value,font:'Calibri',size:19,color:'000000'})],...options});
  const children=[new Paragraph({heading:HeadingLevel.TITLE,children:[new TextRun({text:'Haaziry '+report.title,color:'000000',bold:true,size:38})]}),p(report.caption),...(report.summary?[p(report.summary)]:[]),p(`${report.rows.length} records | Generated ${stamp}`)];
  const border={style:BorderStyle.SINGLE,size:4,color:'D9D9D9'};
  groups.forEach((indexes,groupIndex)=>{
    if(groups.length>1)children.push(new Paragraph({heading:HeadingLevel.HEADING_2,pageBreakBefore:groupIndex>0,children:[new TextRun({text:`Report details ${groupIndex+1} of ${groups.length}`,color:'000000',size:24,bold:true})]}));
    const labels=indexes.map(i=>report.columns[i]),w=weights(labels),sum=w.reduce((a,b)=>a+b,0),widths=w.map(weight=>Math.floor(width*weight/sum));widths[widths.length-1]+=width-widths.reduce((a,b)=>a+b,0);
    const cell=(value,index,header,rowIndex)=>new TableCell({width:{size:widths[index],type:WidthType.DXA},verticalAlign:VerticalAlign.CENTER,margins:{top:90,bottom:90,left:90,right:90},shading:{fill:header?'243E52':rowIndex%2?'F5F8FA':'FFFFFF'},children:String(value).split('\n').map(line=>new Paragraph({spacing:{after:0,line:220},children:[new TextRun({text:line,font:'Calibri',size:17,bold:header,color:header?'FFFFFF':'000000'})]}))});
    children.push(new Table({width:{size:width,type:WidthType.DXA},layout:TableLayoutType.FIXED,columnWidths:widths,borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},rows:[new TableRow({tableHeader:true,cantSplit:true,children:labels.map((label,i)=>cell(label,i,true,0))}),...report.rows.map((row,rowIndex)=>new TableRow({cantSplit:indexes.every(i=>row[i].length<350),children:indexes.map((column,i)=>cell(row[column],i,false,rowIndex))}))]}));
    if(!report.rows.length)children.push(p('No records match the selected filters.'));
  });
  const doc=new Document({creator:'Haaziry',title:report.title,description:report.caption,styles:{default:{document:{run:{font:'Calibri',size:19,color:'000000'},paragraph:{spacing:{after:100}}}}},sections:[{properties:{page:{size:{orientation:PageOrientation.LANDSCAPE,width:11906,height:16838},margin:{top:720,bottom:720,left:720,right:720}}},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'Haaziry | Page ',size:16,color:'666666'}),new TextRun({children:[PageNumber.CURRENT],size:16}),new TextRun({text:' of ',size:16}),new TextRun({children:[PageNumber.TOTAL_PAGES],size:16})]})]})},children}]});
  return new Uint8Array(await Packer.toBuffer(doc));
}
export async function exportReport(input,format){
  if(!['pdf','docx'].includes(format))throw new ReportInputError('Choose PDF or Word (.docx).');
  const report=validateReport(input);
  return {bytes:format==='pdf'?buildPdf(report):await buildDocx(report),filename:report.filename+'.'+format,contentType:format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
}
