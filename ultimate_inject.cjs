const fs = require('fs');
const file = 'c:/Users/koppi/OneDrive/Desktop/Briklay Fly/src/pages/NewPurchaseOrder.tsx';
let content = fs.readFileSync(file, 'utf8');

const startTable = '{/* Line items table */}';
const endTable = '<button\r\n              onClick={addLine}';
let endIndex = content.indexOf(endTable);
if (endIndex === -1) endIndex = content.indexOf('<button\n              onClick={addLine}');

const cardsUI = `{/* Line items as Cards */}
            <div className="flex flex-col gap-3 mt-4">
              {lineItems.map((li, rowIdx) => {
                const needsReview = !li.sku_id && (li.validation_metrics || li.ai_suggested_name || li.needs_review);
                const isRedbox = needsReview || (li.validation_metrics && li.validation_metrics.passes_shop_floor_test === false);
                const isSuccess = aiJustMatchedIds.has(li.id);

                return (
                  <div 
                    key={li.id}
                    className={\`relative rounded-xl border bg-white overflow-hidden transition-all duration-500 shadow-[0_2px_10px_rgba(0,0,0,0.02)] \${
                      isRedbox 
                        ? 'border-red-200/60 shadow-[0_4px_16px_rgba(239,68,68,0.08)]' 
                        : isSuccess 
                          ? 'border-green-200 shadow-[0_4px_16px_rgba(34,197,94,0.08)]' 
                          : 'border-outline-variant/20 hover:border-outline-variant/40 hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)]'
                    }\`}
                  >
                    {/* Collapsed / Main Body */}
                    <div className={\`p-4 flex flex-col md:flex-row gap-4 md:items-start transition-colors \${isRedbox ? 'bg-red-50/20' : isSuccess ? 'bg-green-50/30' : ''}\`}>
                      
                      {/* Left side: Item Name, Spec, Chips */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-bold text-on-surface-variant/40 bg-surface-container/50 px-2 py-0.5 rounded-full tracking-wider">
                            #{li.line_number}
                          </span>
                          {/* Status pill */}
                          {li.sku_id ? (
                            <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded-full">
                              <span className="material-symbols-outlined text-[12px]">barcode_scanner</span>
                              <span className="font-mono text-[10px] font-bold tracking-wide">{li.sku_id}</span>
                              {isSuccess && <span className="text-[9px] font-bold text-amber-600 ml-1">✦ AI</span>}
                              <button type="button" onClick={() => clearSKU(li.id)} className="material-symbols-outlined text-[14px] text-green-400 hover:text-green-600 ml-1">close</button>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1 bg-surface-container-low border border-outline-variant/20 text-on-surface-variant/60 px-2 py-0.5 rounded-full text-[10px] font-medium">
                              <span className="material-symbols-outlined text-[12px]">search</span>
                              Unlinked
                            </span>
                          )}
                        </div>

                        {/* Name Input WITH DROPDOWN REFS */}
                        <div className="relative group/input mt-2" ref={el => { if (el) itemRefs.current.set(li.id, el); else itemRefs.current.delete(li.id); }}>
                          <input
                            className="w-full text-[14px] font-bold text-on-surface bg-transparent border-0 px-0 py-0 outline-none placeholder:text-on-surface-variant/30 transition-colors focus:ring-0"
                            placeholder="Type item name to search…"
                            value={li.item_name}
                            onChange={e => {
                              updateLine(li.id, { item_name: e.target.value, sku_id: null, ai_suggested_name: undefined, sku_alternatives: undefined });
                              searchSKUs(li.id, e.target.value);
                            }}
                            onBlur={() => {
                              setTimeout(() => updateLine(li.id, { showDropdown: false }), 200);
                              clearTimeout(aiMatchDebounceRef.current[li.id]);
                              if (!li.sku_id && li.item_name.trim().length >= 2) {
                                aiMatchDebounceRef.current[li.id] = setTimeout(() => runAIAutoMatch(li.id), 1500);
                              }
                            }}
                            onFocus={() => {
                              clearTimeout(aiMatchDebounceRef.current[li.id]);
                              if (li.searchResults && li.searchResults.length > 0) updateLine(li.id, { showDropdown: true });
                            }}
                          />
                          <div className="absolute left-0 bottom-[-2px] h-[1px] w-full bg-outline-variant/20 scale-x-0 group-focus-within/input:scale-x-100 group-hover/input:scale-x-100 transition-transform origin-left"></div>
                          
                          {(li.searching || aiMatchingIds.has(li.id)) && (
                            <span className="material-symbols-outlined animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-amber-600 pointer-events-none">
                              progress_activity
                            </span>
                          )}
                        </div>

                        {/* Inline AI name correction — appears between name input and spec line */}
                        {li.ai_suggested_name && !li.sku_id && !dictAddingIds.has(li.id) && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, padding: '2px 6px', background: '#eff6ff', border: '0.5px solid #bfdbfe', borderRadius: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 10, color: '#3b82f6', flexShrink: 0 }}>smart_toy</span>
                            <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>Did you mean</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#1d4ed8', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{li.ai_suggested_name}</span>
                            <button type="button"
                              onClick={() => {
                                const corrected = li.ai_suggested_name;
                                updateLine(li.id, { item_name: corrected, ai_suggested_name: undefined, sku_id: null });
                                setTimeout(() => autoAddItemToDictionary(li.id), 50);
                              }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px', color: '#2563eb', lineHeight: 1, flexShrink: 0 }}
                              title="Accept suggestion">
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>check</span>
                            </button>
                            <button type="button"
                              onClick={() => updateLine(li.id, { ai_suggested_name: undefined })}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 2px', color: '#93c5fd', lineHeight: 1, flexShrink: 0 }}
                              title="Keep what I typed">
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>close</span>
                            </button>
                          </div>
                        )}

                        {/* Spec line */}
                        <input
                          className="w-full text-[11px] italic text-on-surface-variant/50 bg-transparent border-0 px-0 py-0 mt-1 outline-none placeholder:text-on-surface-variant/20 focus:text-on-surface-variant/80 transition-colors"
                          placeholder="grade / size / spec…"
                          value={li.specification}
                          onChange={e => updateLine(li.id, { specification: e.target.value })}
                        />

                        {/* Smart Matches Chips (only shown if not redbox) */}
                        {!li.sku_id && !dictAddingIds.has(li.id) && !isRedbox && li.sku_alternatives && li.sku_alternatives.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5 items-center">
                             <span className="text-[9px] font-bold text-primary/60 mr-0.5 uppercase tracking-widest flex items-center gap-0.5">
                               <span className="material-symbols-outlined text-[11px]">auto_awesome</span> Smart Matches:
                             </span>
                             {li.sku_alternatives.slice(0, 5).map((sku) => (
                               <button
                                 key={sku.sku_id}
                                 type="button"
                                 onClick={() => {
                                    updateLine(li.id, { item_name: sku.item_name, sku_id: sku.sku_id, unit: sku.standard_unit || sku.unit, sku_alternatives: undefined, validation_metrics: undefined });
                                 }}
                                 className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-primary/5 text-primary/80 hover:bg-primary/15 hover:text-primary transition-colors border border-primary/10 text-left max-w-[250px] truncate shadow-sm"
                                 title={sku.item_name}
                               >
                                 {sku.item_name}
                               </button>
                             ))}
                          </div>
                        )}
                        
                        {/* SKU dropdown portal */}
                        {li.showDropdown && li.searchResults && li.searchResults.length > 0 && (() => {
                          const triggerEl = itemRefs.current.get(li.id);
                          if (!triggerEl) return null;
                          const rect = triggerEl.getBoundingClientRect();
                          return createPortal(
                            <div style={{
                              position: 'fixed', top: rect.bottom + 6, left: rect.left,
                              width: Math.max(rect.width, 280),
                              background: 'white', border: '0.5px solid rgba(0,0,0,0.1)',
                              borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
                              zIndex: 9999, overflow: 'hidden', maxHeight: 220, overflowY: 'auto',
                            }}>
                              <div style={{ padding: '6px 10px 4px', fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
                                SKU matches — click to select
                              </div>
                              {li.searchResults.map((sku, si) => (
                                <div key={sku.sku_id} onMouseDown={() => selectSKU(li.id, sku)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', cursor: 'pointer',
                                    borderBottom: si < li.searchResults.length - 1 ? '0.5px solid rgba(0,0,0,0.05)' : 'none',
                                    background: si === 0 ? 'rgba(22,163,74,0.03)' : 'transparent',
                                  }}
                                  onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = si === 0 ? 'rgba(22,163,74,0.03)' : 'transparent'; }}
                                >
                                  {si === 0 && (
                                    <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#16a34a', flexShrink: 0 }}>star</span>
                                  )}
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 12, fontWeight: si === 0 ? 600 : 400, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sku.item_name}</div>
                                    <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1, fontFamily: 'monospace' }}>{sku.sku_id} · {sku.unit}</div>
                                  </div>
                                  <span style={{
                                    fontSize: 10, padding: '1px 5px', borderRadius: 20, fontWeight: 600, flexShrink: 0,
                                    background: sku.similarity >= 0.75 ? '#dcfce7' : sku.similarity >= 0.5 ? '#dbeafe' : '#fef9c3',
                                    color: sku.similarity >= 0.75 ? '#16a34a' : sku.similarity >= 0.5 ? '#1d4ed8' : '#a16207',
                                  }}>
                                    {Math.round(sku.similarity * 100)}%
                                  </span>
                                </div>
                              ))}
                            </div>,
                            document.body
                          );
                        })()}
                      </div>

                      {/* Right side: Qty, Unit, Financials */}
                      <div className="flex items-start gap-4 shrink-0 mt-3 md:mt-0">
                        {/* Qty & Unit Group */}
                        <div className="flex flex-col gap-1 w-[110px]">
                          <label className="text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest pl-1">Qty & Unit</label>
                          <div className="flex items-center rounded-lg border border-outline-variant/30 bg-surface focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all overflow-hidden shadow-sm h-[32px]">
                            <input
                              type="number" min="1"
                              className="w-[50px] h-full text-[12px] font-semibold text-center border-0 bg-transparent px-1 focus:ring-0"
                              value={li.quantity_ordered}
                              onChange={e => updateLine(li.id, { quantity_ordered: parseFloat(e.target.value) || 0 })}
                            />
                            <div className="w-[1px] h-4 bg-outline-variant/20 mx-0.5"></div>
                            <input
                              className="flex-1 min-w-0 h-full text-[11px] text-center text-on-surface-variant bg-transparent border-0 px-1 focus:ring-0 uppercase tracking-wider placeholder:text-on-surface-variant/30"
                              placeholder="UOM"
                              value={li.unit}
                              onChange={e => updateLine(li.id, { unit: e.target.value.toUpperCase() })}
                            />
                          </div>
                        </div>

                        {/* Rate Group */}
                        <div className="flex flex-col gap-1 w-[90px]">
                          <label className="text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest pl-1">Rate (₹)</label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-on-surface-variant/40">₹</span>
                            <input
                              type="number" min="0" step="0.01"
                              className="w-full h-[32px] pl-6 pr-2 rounded-lg border border-outline-variant/30 bg-surface text-[12px] font-semibold focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all shadow-sm"
                              value={li.unit_rate || ''}
                              onChange={e => updateLine(li.id, { unit_rate: parseFloat(e.target.value) || 0 })}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-1 px-1">
                            <div className="flex items-center gap-0.5">
                              <input
                                type="number" min="0" max="100"
                                className="w-[28px] text-[9px] border-b border-outline-variant/30 bg-transparent px-0 py-0 text-center focus:border-primary focus:ring-0 text-on-surface-variant"
                                placeholder="0"
                                value={li.discount_percent || ''}
                                onChange={e => updateLine(li.id, { discount_percent: parseFloat(e.target.value) || 0 })}
                              />
                              <span className="text-[8px] text-on-surface-variant/40 uppercase">Disc</span>
                            </div>
                            <div className="flex items-center gap-0.5">
                              <input
                                type="number" min="0" max="100"
                                className="w-[28px] text-[9px] border-b border-outline-variant/30 bg-transparent px-0 py-0 text-center focus:border-primary focus:ring-0 text-on-surface-variant"
                                placeholder="0"
                                value={li.gst_rate || ''}
                                onChange={e => updateLine(li.id, { gst_rate: parseFloat(e.target.value) || 0 })}
                              />
                              <span className="text-[8px] text-on-surface-variant/40 uppercase">GST</span>
                            </div>
                          </div>
                        </div>

                        {/* Total */}
                        <div className="flex flex-col gap-1 w-[90px] items-end justify-center h-[32px] mt-4 mr-2">
                          {(() => {
                            const rate = li.unit_rate || 0;
                            const qty = li.quantity_ordered || 0;
                            const disc = li.discount_percent || 0;
                            const gst = li.gst_rate || 0;
                            const amtAfterDisc = rate * qty * (1 - disc / 100);
                            const total = amtAfterDisc * (1 + gst / 100);
                            return (
                              <>
                                <span className="text-[14px] font-black text-on-surface tracking-tight">₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                                {disc > 0 && <span className="text-[9px] text-green-600 font-medium tracking-wide">-{disc}%</span>}
                              </>
                            );
                          })()}
                        </div>

                        <button type="button" onClick={() => removeLine(li.id)} className="mt-5 material-symbols-outlined text-[16px] text-on-surface-variant/30 hover:text-red-500 transition-colors p-1" title="Remove Line">
                          delete
                        </button>
                      </div>
                    </div>

                    {/* REDBOX: Expanded UI state for issues */}
                    {isRedbox && (
                      <div className="border-t border-red-100 bg-red-50/10 p-4">
                        {/* Parametric review panel */}
                        {li.validation_metrics && li.validation_metrics.passes_shop_floor_test === false ? (
                          <ParametricReviewPanel
                            itemName={li.item_name}
                            payload={{
                              ai_suggested_name: li.ai_suggested_name || '',
                              extracted_attributes: li.extracted_attributes || {},
                              validation_metrics: li.validation_metrics
                            }}
                            onApprove={(finalSkuData) => {
                              const originalInput = li.item_name;
                              updateLine(li.id, {
                                item_name: finalSkuData.canonicalName,
                                validation_metrics: undefined,
                                ai_suggested_name: undefined,
                                needs_review: false,
                              });
                              setTimeout(() => autoAddItemToDictionary(li.id, true, { ...finalSkuData, originalName: originalInput }), 100);
                            }}
                          />
                        ) : li.ai_suggested_name ? (
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-violet-50/50 rounded-lg border border-violet-100/50 gap-4">
                            <div className="flex items-start gap-3">
                              <span className="material-symbols-outlined text-violet-500 text-[18px] mt-0.5">auto_awesome</span>
                              <div>
                                <p className="text-[12px] text-violet-900 font-medium">Categorized as: <span className="font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded ml-1">{li.ai_suggested_name}</span></p>
                                <p className="text-[11px] text-violet-600/70 mt-1">Please review the name and specification before confirming.</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                              <button
                                type="button"
                                onClick={() => {
                                  updateLine(li.id, { item_name: li.ai_suggested_name, ai_suggested_name: undefined, needs_review: false });
                                }}
                                className="w-full sm:w-auto px-4 py-2 bg-violet-600 text-white text-[11px] font-bold rounded-lg hover:bg-violet-700 shadow-sm transition-colors"
                              >
                                Accept & Link
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200">
                             <div className="flex items-center gap-3">
                               <span className="material-symbols-outlined text-amber-600 text-[18px]">warning</span>
                               <span className="text-[12px] text-amber-800 font-medium">Please review this item manually. No exact match found.</span>
                             </div>
                             <button type="button" onClick={() => updateLine(li.id, { needs_review: false })} className="text-[11px] font-bold text-amber-700 hover:text-amber-900">
                               Dismiss
                             </button>
                          </div>
                        )}
                        
                        {/* Insert as New SKU fallback inside Redbox */}
                        {(!li.sku_alternatives || li.sku_alternatives.length === 0) && (
                          <div className="mt-4 pt-3 border-t border-red-100/50 flex items-center justify-between">
                            <span className="text-[10px] text-red-800/60 font-medium">Still unable to match? Insert directly into the dictionary.</span>
                            <button type="button"
                              onClick={() => {
                                updateLine(li.id, { sku_alternatives: undefined });
                                setTimeout(() => autoAddItemToDictionary(li.id, true), 50);
                              }}
                              disabled={dictAddingIds.has(li.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-[10px] font-bold transition-colors disabled:opacity-50"
                            >
                              {dictAddingIds.has(li.id) ? (
                                <><span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span> Adding...</>
                              ) : (
                                <><span className="material-symbols-outlined text-[14px]">add_circle</span> Force Add SKU</>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            `;

if (content.indexOf(startTable) !== -1 && endIndex !== -1) {
    content = content.substring(0, content.indexOf(startTable)) + cardsUI + content.substring(endIndex);
}

// Ensure userConfirmed doesn't trigger TS error
content = content.replace(/async function autoAddItemToDictionary\\(itemId: string, userConfirmed = false, explicitSkuData\\?: any\\)/, 
  `async function autoAddItemToDictionary(itemId: string, _userConfirmed = false, explicitSkuData?: any)`);

fs.writeFileSync(file, content, 'utf8');
console.log('UI injected properly with onBlur and dropdowns intact.');
