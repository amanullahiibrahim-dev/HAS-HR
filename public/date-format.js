/* Day-first date fields. Application/API values remain ISO dates. */
(()=>{
  const fields=new WeakMap(),descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
  const display=value=>{const m=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(value||'');return m?`${m[3]}/${m[2]}/${m[1]}${m[4]?' '+m[4]:''}`:'';};
  function parse(value,timed){
    const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?$/.exec(value.trim());
    if(!m||timed!==!!m[4])return '';
    const iso=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`,date=new Date(iso+'T00:00:00Z');
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==iso||m[4]&&(Number(m[4])>23||Number(m[5])>59))return '';
    return iso+(timed?`T${m[4]}:${m[5]}`:'');
  }
  function decorate(original){
    if(fields.has(original)||!['date','datetime-local'].includes(original.type))return;
    const timed=original.type==='datetime-local',wrapper=document.createElement('span'),text=document.createElement('input'),icon=document.createElement('button');
    wrapper.className='day-first-field';text.type='text';text.className=original.className;text.classList.add('day-first-display');text.placeholder=timed?'DD/MM/YYYY HH:mm':'DD/MM/YYYY';text.inputMode=timed?'text':'numeric';text.autocomplete='off';text.maxLength=timed?16:10;text.defaultValue=display(original.defaultValue);
    if(original.id)text.id=original.id+'-display';
    const labels=[...original.labels||[]],label=original.getAttribute('aria-label')||labels[0]?.textContent.trim()||'Date';
    text.setAttribute('aria-label',label+' ('+text.placeholder+')');original.setAttribute('aria-label','Open calendar: '+label);original.setAttribute('lang','en-GB');
    original.parentNode.insertBefore(wrapper,original);wrapper.append(text,icon,original);original.classList.add('day-first-native');icon.className='day-first-calendar';icon.type='button';icon.setAttribute('aria-label','Open calendar: '+label);original.setAttribute('aria-hidden','true');icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16"/></svg>';
    for(const item of labels)if(text.id)item.htmlFor=text.id;
    let editing=false,committed=descriptor.get.call(original);
    const get=()=>descriptor.get.call(original);
    const validate=()=>{
      const raw=text.value.trim(),iso=parse(raw,timed);let message=raw&&!iso?'Enter a valid '+text.placeholder+' date.':'';
      original.setCustomValidity('');
      if(iso&&original.min&&iso<original.min)message='Choose a date on or after '+display(original.min)+'.';
      if(iso&&original.max&&iso>original.max)message='Choose a date on or before '+display(original.max)+'.';
      text.setCustomValidity(message);original.setCustomValidity(message);return !message;
    };
    const sync=(force=false)=>{
      if(!editing&&(force||document.activeElement!==text))text.value=display(get());
      for(const prop of ['required','disabled','readOnly'])if(text[prop]!==original[prop])text[prop]=original[prop];
      wrapper.classList.toggle('day-first-readonly',original.readOnly);original.tabIndex=-1;icon.disabled=original.disabled;
      validate();
    };
    fields.set(original,{sync,text});
    Object.defineProperty(original,'value',{configurable:true,get,set(value){descriptor.set.call(original,value);committed=get();sync(true);}});
    original.addEventListener('input',()=>sync(true));original.addEventListener('change',()=>{committed=get();sync(true);});
    original.addEventListener('invalid',event=>{event.preventDefault();text.focus();text.reportValidity();});
    text.addEventListener('input',()=>{
      editing=true;
      if(!timed&&/^[\d/]*$/.test(text.value)){
        const digits=text.value.replace(/\D/g,'').slice(0,8),before=text.value.slice(0,text.selectionStart).replace(/\D/g,'').length;
        text.value=digits.slice(0,2)+(digits.length>2?'/'+digits.slice(2,4):'')+(digits.length>4?'/'+digits.slice(4):'');
        const caret=before+(before>2?1:0)+(before>4?1:0);text.setSelectionRange(caret,caret);
      }
      const previous=get(),value=parse(text.value,timed);descriptor.set.call(original,value);validate();if(previous!==value)original.dispatchEvent(new Event('input',{bubbles:true}));editing=false;});
    // Commit once on leaving the field, matching native date change semantics.
    const commit=()=>{if(validate()&&get())text.value=display(get());if(committed!==get()){committed=get();original.dispatchEvent(new Event('change',{bubbles:true}));}};
    text.addEventListener('change',commit);text.addEventListener('blur',commit);
    const openCalendar=()=>{if(original.disabled||original.readOnly)return;try{if(typeof original.showPicker==='function'){original.showPicker();return;}}catch{}original.focus();original.click();};
    icon.addEventListener('click',openCalendar);
    text.addEventListener('keydown',event=>{if(event.altKey&&event.key==='ArrowDown'){event.preventDefault();openCalendar();}});
    sync();
  }
  function scan(root){if(root instanceof HTMLInputElement)decorate(root);root.querySelectorAll?.('input[type="date"],input[type="datetime-local"]').forEach(decorate);}
  scan(document);
  new MutationObserver(records=>{for(const record of records){if(record.type==='attributes'){fields.get(record.target)?.sync();}else for(const node of record.addedNodes)if(node.nodeType===1)scan(node);}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['value','min','max','readonly','disabled','required']});
  document.addEventListener('reset',event=>setTimeout(()=>event.target.querySelectorAll('input[type="date"],input[type="datetime-local"]').forEach(input=>fields.get(input)?.sync(true)),0));
})();
