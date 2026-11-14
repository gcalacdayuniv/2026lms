// js/print-preview.js
// Shared look of printed exam papers (two columns, like a normal paper test) and an in-app print preview.
// The preview is an overlay with a Back button, so installed apps (iPhone) can always return to the site.
import { escapeHtml as esc } from './html-utils.js';

export const TYPE_LABEL = {
    mc: 'Multiple Choice', multi: 'Multiple Answer', tf: 'True or False', id: 'Identification', num: 'Numeric',
    enum: 'Enumeration', order: 'Ordering', match: 'Matching', essay: 'Essay'
};

// "Part 1: Multiple Choice" when the part has one kind of question, otherwise "Part 1".
export const partTitle = (part, types) => {
    const kinds = [...new Set(types)];
    return `Part ${part + 1}${kinds.length === 1 && TYPE_LABEL[kinds[0]] ? ': ' + TYPE_LABEL[kinds[0]] : ''}`;
};

export const PRINT_CSS = `@page{size:letter;margin:12mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;line-height:1.18;color:#000;margin:0}
@media screen{body{padding:12mm;background:#fff}}
.hd{text-align:center;font-weight:bold;margin:0 0 3.5mm}.hd div{margin-bottom:1mm}
.part{font-weight:bold;margin:0 0 2.2mm;text-align:left}
.q{margin:0 0 2.4mm;text-align:justify}
.c{margin:0;text-align:left}
.pts{font-size:8.5pt;color:#333}
.hint{font-size:8.5pt;font-style:italic;color:#333;text-align:left}
.ln{margin:4.6mm 0 0;border-bottom:1px solid #000;height:0}.ln span{position:relative;top:-3.8mm;font-size:9pt}
.mt{display:grid;grid-template-columns:1fr 1fr;gap:0 4mm}
.k{margin:0 0 1.6mm}
.keyg{display:grid;grid-template-columns:repeat(4,1fr);gap:0 6mm}
#src{column-count:2;column-gap:9mm}
.page{width:191.9mm;height:254.4mm;overflow:hidden;display:flex;flex-direction:column;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.pcols{flex:1;min-height:0;display:flex;gap:9mm}
.pcol{flex:1 1 0;min-width:0;height:100%;overflow:hidden}
@media screen{.page{border-bottom:1px dashed #aaa;margin-bottom:8mm}}`;

// Lays the questions out in two columns on fixed-size pages. Done with script instead of CSS columns because
// iPhone printing ignores CSS columns. Items inside #src: .hd (title), then .part and .q in order.
export const PAGINATE_SCRIPT = `<script>(function(){
var src=document.getElementById('src');if(!src)return;
var hd=null,units=[],kids=[].slice.call(src.children);
kids.forEach(function(k){
 if(k.classList.contains('hd')){hd=k;return;}
 var u=units[units.length-1];
 if(u&&u.length===1&&u[0].classList.contains('part')){u.push(k);}else{units.push([k]);}
});
var first=true,cols,ci;
function newPage(){
 var pg=document.createElement('div');pg.className='page';
 if(hd&&first){pg.appendChild(hd);}first=false;
 var w=document.createElement('div');w.className='pcols';
 cols=[document.createElement('div'),document.createElement('div')];
 cols[0].className='pcol';cols[1].className='pcol';w.appendChild(cols[0]);w.appendChild(cols[1]);
 pg.appendChild(w);document.body.appendChild(pg);ci=0;
}
function over(c){return c.scrollHeight>c.clientHeight+1;}
newPage();
units.forEach(function(u){
 for(var t=0;t<3;t++){
  var c=cols[ci],empty=c.children.length===0;
  u.forEach(function(e){c.appendChild(e);});
  if(!over(c)||empty&&t>=1)break;
  if(empty)break;
  u.forEach(function(e){c.removeChild(e);});
  if(ci===0){ci=1;}else{newPage();}
 }
});
document.body.removeChild(src);
})();<\/script>`;

export const closePrintPreview = () => {
    const o = document.getElementById('printPreviewOverlay');
    if (o) o.remove();
    document.removeEventListener('keydown', onKey);
};
const onKey = (e) => { if (e.key === 'Escape') closePrintPreview(); };

// Shows html (a complete document) in a full-screen overlay with Back and Print buttons.
export const showPrintPreview = (html, title = 'Print') => {
    closePrintPreview();
    const o = document.createElement('div');
    o.id = 'printPreviewOverlay';
    o.className = 'fixed inset-0 z-[90] bg-gray-200 flex flex-col';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-label', 'Print preview');
    o.innerHTML = `<div class="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-300 shrink-0" style="padding-top:max(0.5rem, env(safe-area-inset-top))">
            <button type="button" id="closePrintPreviewBtn" class="px-3 py-2 rounded-md border border-gray-300 text-sm font-bold text-gray-700 hover:bg-gray-50"><i class="fa-solid fa-arrow-left mr-1.5" aria-hidden="true"></i>Back</button>
            <div class="flex-1 min-w-0 truncate text-sm font-black text-gray-800 text-center">${esc(title)}</div>
            <button type="button" id="printPreviewPrintBtn" class="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold"><i class="fa-solid fa-print mr-1.5" aria-hidden="true"></i>Print</button>
        </div>
        <div id="printPreviewScroll" class="flex-1 overflow-auto p-3"><div id="printPreviewSizer" class="mx-auto bg-white shadow-lg" style="width:816px;max-width:none;transform-origin:top left"><iframe id="printPreviewFrame" title="Print preview" style="width:816px;border:0;display:block;min-height:1056px"></iframe></div></div>`;
    document.body.appendChild(o);
    document.addEventListener('keydown', onKey);

    const frame = o.querySelector('#printPreviewFrame');
    const sizer = o.querySelector('#printPreviewSizer');
    const scroll = o.querySelector('#printPreviewScroll');
    const fit = () => {
        const avail = scroll.clientWidth - 24;
        const scale = Math.min(1, avail / 816);
        const h = frame.contentDocument && frame.contentDocument.documentElement ? frame.contentDocument.documentElement.scrollHeight : 1056;
        frame.style.height = h + 'px';
        sizer.style.transform = `scale(${scale})`;
        sizer.style.height = (h * scale) + 'px';
        sizer.style.width = '816px';
        sizer.style.marginLeft = scale < 1 ? '0' : 'auto';
    };
    frame.addEventListener('load', fit);
    window.addEventListener('resize', fit, { once: false });
    frame.srcdoc = html;

    o.addEventListener('click', (e) => {
        if (e.target.closest('#closePrintPreviewBtn')) closePrintPreview();
        else if (e.target.closest('#printPreviewPrintBtn')) {
            try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (err) { window.print(); }
        }
    });
};
