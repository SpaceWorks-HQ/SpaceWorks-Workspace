"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CATEGORIES, human, type EstimateLine } from "@/lib/productOps/schema";
import { estimateTotals } from "@/lib/productOps/costs";
import { formatMoney, parseMoneyToMinor, currencyMinorDigits } from "@/lib/format/money";
const control = "block min-h-11 w-full min-w-0 rounded-control border border-line-strong bg-panel px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-primary";
export const blankLine = (): EstimateLine => ({ item: "", specification: "", category: "OTHER", quantityMilli: 1000, unit: "each", unitCostMinor: 0, supplier: "", quoteUrl: "", quoteFileId: "", gstBps: 0 });
export function CostEditor({ initial, currency, quotes, initialContingency }: { initial: EstimateLine[]; initialContingency: number; currency: string; quotes: Array<{ id: string; filename: string }> }) {
 const [lines, setLines] = useState(initial.length ? initial : [blankLine()]);
 const [prices, setPrices] = useState(() => (initial.length ? initial : [blankLine()]).map(line => String(line.unitCostMinor / 10 ** currencyMinorDigits(currency))));
 const [keys, setKeys] = useState(() => (initial.length ? initial : [blankLine()]).map((_, index) => index));
 const nextKey = useRef(keys.length);
 const [contingency, setContingency] = useState(initialContingency);
 function patch(index: number, key: keyof EstimateLine, value: string | number) { setLines(lines.map((line, i) => i === index ? { ...line, [key]: value } : line)); }
 let total = "Add line items to see the estimate total.";
 try { total = `Estimated total including tax and contingency: ${formatMoney(estimateTotals({ lines: lines.map((line, index) => ({ ...line, unitCostMinor: parseMoneyToMinor(prices[index], currency) ?? -1 })), contingencyBps: Math.round(contingency * 100), revisionNote: "Preview" }).totalMinor, currency)}`; } catch { /* The submitted form reports invalid fields. */ }
 return <fieldset className="min-w-0 space-y-4"><legend className="text-h3">Estimate line items</legend>
  {lines.map((line, index) => <fieldset className="min-w-0 space-y-3 rounded-xl border border-line p-3" key={keys[index]}><legend className="px-1 text-label">Item {index + 1}</legend><div className="grid min-w-0 gap-3 sm:grid-cols-2">
   {([['item','Item'],['specification','Specification'],['unit','Unit'],['supplier','Supplier name'],['quoteUrl','Quote link']] as const).map(([key,label]) => <label className="min-w-0 text-label" key={key}>{label}<input className={control} name={`line-${index}-${key}`} defaultValue={line[key]} required={key === 'item' || key === 'unit'} type={key === 'quoteUrl' ? 'url' : 'text'} maxLength={key === 'quoteUrl' ? 2000 : 250} onChange={e => patch(index,key,e.target.value)} /></label>)}
   <label className="text-label">Category<select className={control} name={`line-${index}-category`} value={line.category} onChange={e => patch(index,'category',e.target.value)}>{CATEGORIES.map(c => <option key={c} value={c}>{human(c)}</option>)}</select></label>
   <label className="text-label">Quantity<input className={control} name={`line-${index}-quantity`} type="number" min="0.001" step="0.001" required defaultValue={line.quantityMilli / 1000} onChange={e => patch(index,'quantityMilli', Math.round(Number(e.target.value) * 1000))} /></label>
   <label className="text-label">Unit cost ({currency})<input className={control} name={`line-${index}-cost`} type="number" min="0" step={10 ** -currencyMinorDigits(currency)} required defaultValue={prices[index]} onChange={e => setPrices(prices.map((price,i) => i === index ? e.target.value : price))} /></label>
   <label className="text-label">GST / tax %<input className={control} name={`line-${index}-gst`} type="number" min="0" max="100" step="0.01" defaultValue={line.gstBps / 100} onChange={e => patch(index,'gstBps',Math.round(Number(e.target.value) * 100))} /></label>
   <label className="text-label">Uploaded quote<select className={control} name={`line-${index}-quoteFileId`} value={line.quoteFileId} onChange={e => patch(index,'quoteFileId',e.target.value)}><option value="">No uploaded quote</option>{quotes.map(q => <option key={q.id} value={q.id}>{q.filename}</option>)}</select></label>
  </div><Button variant="quiet" type="button" disabled={lines.length === 1} onClick={() => { setLines(lines.filter((_,i) => i !== index)); setKeys(keys.filter((_,i) => i !== index)); setPrices(prices.filter((_,i) => i !== index)); }}>Remove item {index + 1}</Button></fieldset>)}
  <input type="hidden" name="lineCount" value={lines.length}/><Button variant="secondary" type="button" disabled={lines.length >= 200} onClick={() => { setLines([...lines,blankLine()]); setKeys([...keys,nextKey.current++]); setPrices([...prices,"0"]); }}>Add line item</Button>
  <label className="block text-label">Contingency %<input className={control} name="contingency" type="number" min="0" max="100" step="0.01" defaultValue={initialContingency} onChange={e => setContingency(Number(e.target.value))}/></label>
  <p className="text-caption text-ink-muted">Contingency is calculated on subtotal plus tax. Save first, then upload quotes and link them to line items.</p><p role="status" className="text-label">{total}</p>
 </fieldset>;
}
