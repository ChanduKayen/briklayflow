/** The bill panel's own dress — the reference's values, scoped under `.mnav`. */
export const BILL_CSS = `
/* =====================================================================
   ADD A BILL.  Same panel, same three dots: capture → read → check.
   ===================================================================== */
.mnav .capl{flex:none;display:flex;flex-direction:column;margin:0 -2px}
.mnav .rowC{position:relative;display:flex;align-items:center;gap:14px;min-height:62px;padding:0 6px;border:0;border-radius:16px;background:none;
  color:rgb(var(--cream));font:inherit;text-align:left;cursor:pointer;box-shadow:0 1px 0 0 rgba(var(--cream),.08);overflow:hidden}
.mnav .rowC:active{background:rgba(var(--cream),.07)}
.mnav .rowC input{position:absolute;inset:0;opacity:0;cursor:pointer}
.mnav .rowC .ic{flex:none;width:40px;height:40px;border-radius:20px;background:rgba(var(--cream),.08);display:grid;place-items:center;font-style:normal}
.mnav .rowC.main .ic{background:var(--clay)}
.mnav .rowC .ic svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.mnav .rowC .tt{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.mnav .rowC b{font-size:16px;font-weight:600}
.mnav .rowC .tt > span{font-size:12.5px;color:rgba(var(--cream),.5)}
.mnav .rowC .c{flex:none;width:16px;height:16px;fill:none;stroke:rgba(var(--cream),.35);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.mnav .waLine{flex:none;display:flex;gap:10px;align-items:flex-start;margin:6px 6px 0;font-size:13px;line-height:1.45;color:rgba(var(--cream),.55);text-wrap:pretty}
.mnav .waLine svg{flex:none;width:16px;height:16px;margin-top:2px;fill:#3DBB6C}

/* read — the bill itself is on screen while a ledger rule passes over it */
.mnav .reading{flex:1;display:flex;gap:16px;align-items:flex-start;padding-top:6px}
.mnav .paper{position:relative;flex:none;width:128px;height:176px;border-radius:12px;background:#F4EFE6;overflow:hidden;
  box-shadow:0 14px 30px -14px rgba(0,0,0,.7);transform:rotate(-1.5deg)}
.mnav .paper img,.mnav .paper .sheet{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.mnav .paper .scan{position:absolute;left:0;right:0;top:0;height:34px;margin-top:-34px;
  background:linear-gradient(rgba(212,99,62,0),rgba(212,99,62,.22));border-bottom:1.5px solid var(--clay-hi);
  animation:mnavScan 1.7s cubic-bezier(.45,.05,.55,.95) infinite alternate}
.mnav .paper.done .scan{animation:none;opacity:0;transition:opacity .4s}
@keyframes mnavScan{from{transform:translateY(0)}to{transform:translateY(210px)}}
.mnav .got{flex:1;min-width:0;display:flex;flex-direction:column;gap:14px;padding-top:4px}
.mnav .got div{display:flex;flex-direction:column;gap:5px}
.mnav .got small{font-size:12px;color:rgba(var(--cream),.5)}
.mnav .got b{font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:txPickIn .45s var(--ease) both}
.mnav .got b.mono{font-family:'DM Mono',ui-monospace,monospace;font-weight:500}
.mnav .got b.none{color:rgba(var(--cream),.4);font-weight:500}
.mnav .got i{display:block;height:12px;border-radius:6px;
  background:linear-gradient(90deg,rgba(var(--cream),.07) 25%,rgba(var(--cream),.15) 45%,rgba(var(--cream),.07) 65%);
  background-size:300% 100%;animation:mnavShim 1.3s linear infinite}
@keyframes mnavShim{from{background-position:100% 0}to{background-position:-100% 0}}
.mnav .livedot{flex:none;display:inline-block;vertical-align:middle;width:8px;height:8px;margin-right:10px;border-radius:50%;background:var(--clay-hi);
  animation:mnavbreath 1.5s ease-in-out infinite}

/* check — the same slip, with the paper one tap away */
.mnav .billtop{flex:none;display:flex;align-items:center;gap:14px;margin:0 2px 10px}
.mnav .thumb{position:relative;flex:none;width:46px;height:60px;border:0;padding:0;border-radius:8px;background:#F4EFE6;overflow:hidden;cursor:pointer;
  box-shadow:0 8px 18px -10px rgba(0,0,0,.7)}
.mnav .thumb img,.mnav .thumb .sheet{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.mnav .billtop .t{min-width:0;display:flex;flex-direction:column;gap:1px}
.mnav .billtop .t b{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:30px;line-height:1.1;font-variant-numeric:lining-nums}
.mnav .billtop .t b span{font-size:20px;color:var(--clay-hi);margin-right:3px}
.mnav .billtop .t em{font-style:normal;font-size:13.5px;color:rgba(var(--cream),.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mnav .rowS .ring{flex:none;width:8px;height:8px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--clay-hi)}
.mnav .rowS.unsure .v{text-decoration:underline dotted rgba(212,99,62,.9);text-underline-offset:5px}
.mnav .pick .ok{margin-top:10px;height:36px;padding:0 14px;border-radius:18px;border:1px solid rgba(var(--cream),.18);background:none;cursor:pointer;
  color:rgba(var(--cream),.85);font:inherit;font-size:13.5px;font-weight:600}
.mnav .items{display:flex;flex-direction:column;gap:8px;padding:2px 6px 0}
.mnav .items div{display:flex;justify-content:space-between;gap:12px;font-size:13.5px;color:rgba(var(--cream),.8)}
.mnav .items div span:last-child{font-family:'DM Mono',ui-monospace,monospace;flex:none}

/* same bill — one shake, and the two side by side */
.mnav .dupe{flex:none;margin:0 0 10px;padding:12px;border-radius:18px;background:rgba(var(--cream),.05);
  box-shadow:inset 0 0 0 1.5px rgba(212,99,62,.7);animation:mnavno .42s ease-in-out 1}
.mnav .dupe h3{margin:0 0 4px;font-size:15.5px;font-weight:600}
.mnav .dupe p{margin:0 0 10px;font-size:13.5px;color:rgba(var(--cream),.65);text-wrap:pretty}
.mnav .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.mnav .pair div{padding:8px 10px;border-radius:14px;background:rgba(var(--cream),.06);display:flex;flex-direction:column;gap:2px;min-width:0}
.mnav .pair small{font-size:11.5px;color:rgba(var(--cream),.5)}
.mnav .pair b{font-family:'DM Mono',ui-monospace,monospace;font-weight:500;font-size:14.5px}
.mnav .pair span{font-size:12.5px;color:rgba(var(--cream),.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mnav .tx .file.two{flex-direction:row;gap:8px}
.mnav .tx .file.two .btnF{flex:1.3;width:auto}
.mnav .tx .file.two .ghostF{flex:1;height:54px;border:0;border-radius:16px;background:rgba(var(--cream),.08);color:rgba(var(--cream),.9);
  font:inherit;font-size:15px;font-weight:600;cursor:pointer}

/* unreadable — say so, and offer the two honest exits */
.mnav .sorry{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;padding:0 12px}
.mnav .sorry .hol{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 2px rgba(var(--cream),.6);margin-bottom:8px;
  animation:mnavno .42s ease-in-out 1}
.mnav .sorry h3{margin:0;font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:22px}
.mnav .sorry p{margin:0 0 12px;font-size:14.5px;color:rgba(var(--cream),.6);text-wrap:pretty}

/* you check a bill against the bill */
.mnav .viewer{position:absolute;inset:0;z-index:60;background:rgba(12,9,7,.94);display:grid;place-items:center;pointer-events:auto}
.mnav .viewer .big{position:relative;width:min(84%,340px);aspect-ratio:128/176;border-radius:14px;background:#F4EFE6;overflow:hidden}
.mnav .viewer .big img,.mnav .viewer .big .sheet{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.mnav .viewer > button{position:absolute;top:16px;right:16px;width:44px;height:44px;border:0;border-radius:22px;background:rgba(var(--cream),.12);
  color:rgb(var(--cream));display:grid;place-items:center;cursor:pointer}
.mnav .viewer > button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}
@media (prefers-reduced-motion:reduce){.mnav .paper .scan,.mnav .got i,.mnav .livedot{animation:none!important}}
`;
