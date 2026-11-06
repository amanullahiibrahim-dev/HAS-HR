/* Shared document downloads for Attendance and Appraisal. */
let reportDownloadBusy=false;
function reportCsvCell(value){let text=String(value??'');if(/^\s*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}

async function downloadReport(format,report,button){
  if(!authenticated)return;
  if(reportDownloadBusy){toast('Another report is being prepared. Please wait.');return;}
  reportDownloadBusy=true;
  const label=button?.textContent;
  if(button){button.disabled=true;button.textContent='Preparing '+(format==='docx'?'Word':'PDF')+'…';}
  try{
    const response=await fetch('/api/reports/export?format='+encodeURIComponent(format),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(report)});
    if(response.status===401){toast('Please sign in again before exporting.');return;}
    if(!response.ok){const error=await response.json().catch(()=>null);throw new Error(error?.error||'Report download failed. Please try again.');}
    const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=(response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1])||'haaziry-report.'+format;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    return true;
  }catch(error){toast(error.message||'Report download failed. Please try again.');return false;}
  finally{reportDownloadBusy=false;if(button){button.disabled=false;button.textContent=label;}}
}
