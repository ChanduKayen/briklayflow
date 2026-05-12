import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Breadcrumb from '../components/Breadcrumb';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2, ArrowLeft, FileText, ArrowUpRight, ArrowDownRight, Download, Plus } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ProjectBudget } from '../components/ProjectBudget';
import { useUserProfile } from '../App';

export default function ProjectDetail({ session }: { session: Session }) {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { data: profile } = useUserProfile(session.user.id);
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'documents' | 'budget' | 'billing'>('transactions');

  // --- Sorting & Filtering ---
  const [sortKey, setSortKey] = useState<'date' | 'txn_id' | 'stakeholder' | 'category' | 'allocated_amount'>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [filterStakeholder, setFilterStakeholder] = useState<string[]>([]);
  const [filterCategory, setFilterCategory] = useState<string[]>([]);
  const [activeFilterDropdown, setActiveFilterDropdown] = useState<string | null>(null);

  // --- Cell Selection ---
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isDragging, setIsDragging] = useState(false);

  const filterRef = useRef<HTMLTableCellElement>(null);
  
  useEffect(() => { 
    const h = (e: MouseEvent) => { 
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setActiveFilterDropdown(null); 
    }; 
    document.addEventListener("mousedown", h); 
    return () => document.removeEventListener("mousedown", h); 
  }, []);

  useEffect(() => {
    const handleMouseUp = () => setIsDragging(false);
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-cell-select]')) {
        setSelectedRows(new Set());
      }
    };
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').eq('project_id', projectId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const { data: txnsData, isLoading: loadingTxns } = useQuery({
    queryKey: ['project_allocations', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('txn_allocations').select(`
          allocated_amount,
          transactions ( txn_id, date, category, status, bill_doc_url, payment_mode, total_amount, stakeholders ( name, type, category ) )
        `).eq('project_id', projectId);
      if (error) throw error;
      return data.filter((a: any) => a.transactions?.status === 'Active');
    },
    enabled: !!projectId,
  });

  const { data: workOrders, isLoading: loadingWOs } = useQuery({
    queryKey: ['project_wos', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_orders').select('wo_id, source_doc_url, date_issued, stakeholders(name)').eq('project_id', projectId);
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const isPrincipal = profile?.role === 'principal' || profile?.role === 'management';

  const { data: projectBills } = useQuery({
    queryKey: ['project_bills', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_invoices')
        .select('*, client_payments(*)')
        .eq('project_id', projectId as string)
        .neq('status', 'Void')
        .neq('status', 'Cancelled')
        .order('invoice_date', { ascending: true });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!projectId && isPrincipal,
  });

  if (loadingProject || loadingTxns || loadingWOs) {
    return <div className="flex justify-center items-center min-h-[50vh]"><Loader2 className="animate-spin text-secondary" size={48} /></div>;
  }

  if (!project) {
    return <div className="px-margin-mobile md:px-margin-desktop pt-6"><div className="bg-error-container text-on-error-container p-6 rounded-xl">Project not found.</div></div>;
  }

  let totalIn = 0; let totalOut = 0;
  const vendorPayments: Record<string, number> = {}; const workerPayments: Record<string, number> = {};
  const documents: { title: string; url: string; date: string; type: string }[] = [];

  txnsData?.forEach((alloc: any) => {
    const txn = alloc.transactions; if (!txn) return;
    const amount = Number(alloc.allocated_amount) || 0;
    const shType = txn.stakeholders?.type; const shName = txn.stakeholders?.name || 'Unknown';
    if (txn.category?.toLowerCase().includes('receipt') || txn.category?.toLowerCase().includes('funding')) {
      totalIn += amount;
    } else {
      totalOut += amount;
      if (shType === 'Vendor') vendorPayments[shName] = (vendorPayments[shName] || 0) + amount;
      else if (shType === 'Worker') workerPayments[shName] = (workerPayments[shName] || 0) + amount;
    }
    if (txn.bill_doc_url) documents.push({ title: `Bill - ${txn.txn_id}`, url: txn.bill_doc_url, date: txn.date, type: 'Transaction Bill' });
  });

  workOrders?.forEach((wo: any) => {
    if (wo.source_doc_url) documents.push({ title: `Work Order - ${wo.wo_id}`, url: wo.source_doc_url, date: wo.date_issued, type: 'Work Order Source' });
  });

  const sortedVendorPayments = Object.entries(vendorPayments).sort((a, b) => b[1] - a[1]);
  const sortedWorkerPayments = Object.entries(workerPayments).sort((a, b) => b[1] - a[1]);

  // --- Filtering & Sorting Data ---
  const uniqueStakeholders = Array.from(new Set(txnsData?.map((t: any) => t.transactions?.stakeholders?.name).filter(Boolean))) as string[];
  const uniqueCategories = Array.from(new Set(txnsData?.map((t: any) => t.transactions?.category).filter(Boolean))) as string[];

  const filteredTxns = (txnsData || []).filter((alloc: any) => {
    const txn = alloc.transactions;
    if (!txn) return false;
    const matchesStakeholder = filterStakeholder.length ? filterStakeholder.includes(txn.stakeholders?.name || '') : true;
    const matchesCategory = filterCategory.length ? filterCategory.includes(txn.category || '') : true;
    return matchesStakeholder && matchesCategory;
  });

  const sortedTxns = [...filteredTxns].sort((a: any, b: any) => {
    const txnA = a.transactions; const txnB = b.transactions;
    let aVal, bVal;
    if (sortKey === 'stakeholder') { aVal = txnA.stakeholders?.name || ''; bVal = txnB.stakeholders?.name || ''; }
    else if (sortKey === 'allocated_amount') { aVal = Number(a.allocated_amount); bVal = Number(b.allocated_amount); }
    else { aVal = txnA[sortKey]; bVal = txnB[sortKey]; }
    
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    return 0;
  });

  const toggleSort = (key: typeof sortKey) => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(true); } };
  const renderSortIcon = (key: string) => {
    if (sortKey !== key) return <span className="material-symbols-outlined text-[14px] opacity-30">unfold_more</span>;
    return <span className="material-symbols-outlined text-[14px] text-primary">{sortAsc ? 'arrow_upward' : 'arrow_downward'}</span>;
  };

  const toggleFilter = (opt: string, current: string[], setFilt: any) => {
    if (current.includes(opt)) setFilt(current.filter(c => c !== opt)); else setFilt([...current, opt]);
  };

  const renderMultiSelect = (filterKey: string, options: string[], currentFilter: string[], setFilter: any) => {
    const isOpen = activeFilterDropdown === filterKey;
    return (
      <div className="relative mt-2">
        <button onClick={(e) => { e.stopPropagation(); setActiveFilterDropdown(isOpen ? null : filterKey); }} className={`w-full flex items-center justify-between p-1.5 text-[12px] bg-surface-container-highest border rounded-md outline-none transition-colors ${isOpen ? 'border-primary text-primary' : 'border-outline-variant/30 text-on-surface-variant hover:border-primary/50'}`}>
          <span className="truncate">{currentFilter.length ? `${currentFilter.length} selected` : 'All'}</span>
          <span className="material-symbols-outlined text-[14px]">filter_list</span>
        </button>
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-48 bg-surface-container-lowest border border-outline-variant/50 rounded-lg shadow-card-lg z-50 max-h-60 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-2 border-b border-outline-variant/20 flex gap-2 shrink-0 bg-surface-container-low rounded-t-lg">
              <button className="text-[10px] font-bold text-primary hover:underline" onClick={() => setFilter([...options])}>Select All</button>
              <button className="text-[10px] font-bold text-on-surface-variant hover:underline" onClick={() => setFilter([])}>Clear</button>
            </div>
            <div className="p-2 space-y-1 overflow-y-auto">
              {options.map(opt => (
                <label key={opt} className="flex items-center gap-2 p-1.5 hover:bg-surface-container-low rounded cursor-pointer">
                  <input type="checkbox" className="rounded border-outline-variant/50 text-primary focus:ring-primary w-3.5 h-3.5" checked={currentFilter.includes(opt)} onChange={() => toggleFilter(opt, currentFilter, setFilter)} />
                  <span className="text-[12px] truncate select-none">{opt}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const selectedAmounts = Array.from(selectedRows).map(idx => Number(sortedTxns[idx].allocated_amount));
  const sum = selectedAmounts.reduce((a, b) => a + b, 0);
  const avg = selectedAmounts.length ? sum / selectedAmounts.length : 0;

  const handleDownloadPDF = () => {
    const doc = new jsPDF();
    doc.text(`Transactions - ${project.name}`, 14, 15);
    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 22);

    const tableData = sortedTxns.map((alloc: any) => {
      const txn = alloc.transactions;
      const isInflow = txn.category?.toLowerCase().includes('receipt') || txn.category?.toLowerCase().includes('funding');
      return [
        new Date(txn.date).toLocaleDateString(),
        txn.txn_id,
        txn.stakeholders?.name || '-',
        txn.category || 'General',
        `${isInflow ? '+' : '-'} Rs.${Number(alloc.allocated_amount).toLocaleString()}`
      ];
    });

    autoTable(doc, {
      startY: 28,
      head: [['Date', 'Txn ID', 'Stakeholder', 'Category', 'Allocated Amount']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185] },
    });

    doc.save(`${project.project_id}_Transactions.pdf`);
  };

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-12">
      <Breadcrumb items={[
        { label: 'Dashboard', href: '/' },
        { label: 'Projects', href: '/projects' },
        { label: project.name, ...(activeTab !== 'overview' ? { href: `/projects/${projectId}` } : {}) },
        ...(activeTab === 'transactions' ? [{ label: 'Transactions' }] : []),
        ...(activeTab === 'documents' ? [{ label: 'Documents' }] : []),
      ]} />
      {/* Header */}
      <div className="flex justify-between items-center mb-stack-lg">
        <button onClick={() => navigate('/projects')} className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-semibold">
          <ArrowLeft size={20} /> Back to Projects
        </button>
      </div>

      {/* Project Identity */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/30 p-8 mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full" />
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-display-sm font-display-sm font-black text-primary">{project.name}</h1>
              <span className={`px-3 py-1 text-label-caps font-label-caps rounded-full ${project.status === 'Active' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'}`}>
                {project.status?.toUpperCase()}
              </span>
            </div>
            <p className="text-body-lg text-on-surface-variant flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">location_on</span>
              {project.site_location}
            </p>
            <p className="text-body-sm text-on-surface-variant flex items-center gap-2 mt-1">
              <span className="material-symbols-outlined text-[18px]">calendar_today</span>
              Started on {new Date(project.start_date).toLocaleDateString()}
            </p>
          </div>
          <div className="text-left md:text-right">
            <p className="text-label-caps font-label-caps text-on-surface-variant">PROJECT ID</p>
            <p className="font-data-mono font-bold text-body-lg">{project.project_id}</p>
          </div>
        </div>
      </div>

      {/* High-Level Financials */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-surface-container-lowest p-6 rounded-2xl border border-secondary/20 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container">
            <ArrowDownRight size={28} />
          </div>
          <div>
            <p className="text-label-caps font-label-caps text-on-surface-variant">TOTAL INFLOW (RECEIPTS)</p>
            <p className="text-headline-lg font-data-mono font-bold text-secondary">₹{totalIn.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl border border-error/20 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-error-container flex items-center justify-center text-on-error-container">
            <ArrowUpRight size={28} />
          </div>
          <div>
            <p className="text-label-caps font-label-caps text-on-surface-variant">TOTAL OUTFLOW (PAYMENTS)</p>
            <p className="text-headline-lg font-data-mono font-bold text-error">₹{totalOut.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-outline-variant/30 mb-8 overflow-x-auto">
        {([
          { key: 'transactions', label: 'Transactions', show: true },
          { key: 'budget',       label: 'Budget',        show: true },
          { key: 'overview',     label: 'Overview',      show: true },
          { key: 'documents',    label: 'Documents',     show: true },
          { key: 'billing',      label: 'Financials',    show: isPrincipal },
        ] as const).filter(t => t.show).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-6 py-3 font-label-caps text-label-caps uppercase transition-colors whitespace-nowrap ${
              activeTab === key
                ? 'border-b-2 border-primary text-primary font-bold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content: Overview */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/30 shadow-sm">
            <h3 className="text-headline-sm font-headline-sm mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">local_shipping</span>
              Top Vendors
            </h3>
            {sortedVendorPayments.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant italic">No vendor payments recorded.</p>
            ) : (
              <div className="space-y-4">
                {sortedVendorPayments.slice(0, 10).map(([name, amount]) => (
                  <div key={name} className="flex justify-between items-center border-b border-outline-variant/10 pb-2">
                    <span className="font-semibold text-on-surface">{name}</span>
                    <span className="font-data-mono text-on-surface-variant">₹{amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/30 shadow-sm">
            <h3 className="text-headline-sm font-headline-sm mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">engineering</span>
              Top Workers
            </h3>
            {sortedWorkerPayments.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant italic">No worker payments recorded.</p>
            ) : (
              <div className="space-y-4">
                {sortedWorkerPayments.slice(0, 10).map(([name, amount]) => (
                  <div key={name} className="flex justify-between items-center border-b border-outline-variant/10 pb-2">
                    <span className="font-semibold text-on-surface">{name}</span>
                    <span className="font-data-mono text-on-surface-variant">₹{amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Content: Transactions */}
      {activeTab === 'transactions' && (
        <div className="space-y-stack-md">
          <div className="flex flex-col sm:flex-row justify-between items-end gap-4">
            <h3 className="text-headline-md font-headline-md">Project Ledger</h3>
            <div className="flex gap-3">
              <button onClick={handleDownloadPDF} className="bk-btn-ghost flex items-center gap-2">
                <Download size={18} /> Export PDF
              </button>
              <button onClick={() => navigate('/ledger', { state: { projectId: project.project_id } })} className="bk-btn flex items-center gap-2">
                <Plus size={18} /> New Transaction
              </button>
            </div>
          </div>
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm overflow-visible pb-16">
            <table className="w-full text-left border-collapse">
              <thead className="bg-surface-container-low border-b border-outline-variant/20">
                <tr>
                  <th className="p-3 align-top min-w-[120px]">
                    <div className="flex items-center justify-between cursor-pointer hover:text-primary transition-colors text-label-caps font-label-caps text-on-surface-variant" onClick={() => toggleSort('date')}>
                      <span>DATE</span> {renderSortIcon('date')}
                    </div>
                  </th>
                  <th className="p-3 align-top min-w-[120px] border-l border-outline-variant/20">
                    <div className="flex items-center justify-between cursor-pointer hover:text-primary transition-colors text-label-caps font-label-caps text-on-surface-variant" onClick={() => toggleSort('txn_id')}>
                      <span>TXN ID</span> {renderSortIcon('txn_id')}
                    </div>
                  </th>
                  <th className="p-3 align-top min-w-[160px] border-l border-outline-variant/20 relative" ref={activeFilterDropdown === 'stakeholder' ? filterRef : null}>
                    <div className="flex items-center justify-between cursor-pointer hover:text-primary transition-colors text-label-caps font-label-caps text-on-surface-variant mb-2" onClick={() => toggleSort('stakeholder')}>
                      <span>STAKEHOLDER</span> {renderSortIcon('stakeholder')}
                    </div>
                    {renderMultiSelect('stakeholder', uniqueStakeholders, filterStakeholder, setFilterStakeholder)}
                  </th>
                  <th className="p-3 align-top min-w-[140px] border-l border-outline-variant/20 relative" ref={activeFilterDropdown === 'category' ? filterRef : null}>
                    <div className="flex items-center justify-between cursor-pointer hover:text-primary transition-colors text-label-caps font-label-caps text-on-surface-variant mb-2" onClick={() => toggleSort('category')}>
                      <span>CATEGORY</span> {renderSortIcon('category')}
                    </div>
                    {renderMultiSelect('category', uniqueCategories, filterCategory, setFilterCategory)}
                  </th>
                  <th className="p-3 align-top min-w-[140px] border-l border-outline-variant/20 text-right">
                    <div className="flex items-center justify-end cursor-pointer hover:text-primary transition-colors text-label-caps font-label-caps text-on-surface-variant" onClick={() => toggleSort('allocated_amount')}>
                      <span>ALLOCATED (₹)</span> {renderSortIcon('allocated_amount')}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedTxns.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-on-surface-variant">No transactions found for this project.</td></tr>
                )}
                {sortedTxns.map((alloc: any, idx: number) => {
                  const txn = alloc.transactions;
                  if (!txn) return null;
                  const isInflow = txn.category?.toLowerCase().includes('receipt') || txn.category?.toLowerCase().includes('funding');
                  
                  return (
                    <tr key={`${txn.txn_id}-${idx}`} 
                        className="hover:bg-surface-container-low transition-colors cursor-pointer border-b border-outline-variant/10"
                        onClick={() => navigate(`/ledger/${txn.txn_id}`, { state: { from: 'project', projectId: project.project_id, projectName: project.name } })}>
                      <td className="p-4 text-body-sm">{new Date(txn.date).toLocaleDateString()}</td>
                      <td className="p-4 font-data-mono text-body-sm">{txn.txn_id}</td>
                      <td className="p-4 text-body-sm font-semibold">{txn.stakeholders?.name || '-'}</td>
                      <td className="p-4 text-body-sm">
                        <span className={`px-2 py-1 text-[10px] rounded-full font-bold uppercase ${isInflow ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface'}`}>
                            {txn.category || 'General'}
                        </span>
                      </td>
                      <td 
                        data-cell-select="true"
                        className={`p-4 text-right font-data-mono font-bold cursor-cell select-none ${selectedRows.has(idx) ? 'bg-primary/5 outline outline-1 outline-primary/30 text-primary z-10 relative' : (isInflow ? 'text-secondary' : 'text-on-surface')}`}
                        onMouseDown={(e) => { e.stopPropagation(); setIsDragging(true); setSelectedRows(new Set([idx])); }}
                        onMouseEnter={() => { if (isDragging) setSelectedRows(prev => new Set(prev).add(idx)); }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isInflow ? '+' : '-'}₹{Number(alloc.allocated_amount).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Excel-style Selection Stats */}
          {selectedRows.size > 1 && (
            <div className="fixed bottom-4 right-4 bg-white/95 backdrop-blur-sm border border-outline-variant/20 rounded-lg shadow-card p-3 flex gap-6 z-50 animate-in slide-in-from-bottom-4">
              <div className="flex flex-col"><span className="text-[10px] font-bold text-on-surface-variant">COUNT</span><span className="font-data-mono font-bold text-body-lg">{selectedRows.size}</span></div>
              <div className="flex flex-col"><span className="text-[10px] font-bold text-on-surface-variant">AVERAGE</span><span className="font-data-mono font-bold text-body-lg">₹{avg.toLocaleString(undefined, {maximumFractionDigits:2})}</span></div>
              <div className="flex flex-col"><span className="text-[10px] font-bold text-on-surface-variant">SUM</span><span className="font-data-mono font-bold text-body-lg text-primary">₹{sum.toLocaleString(undefined, {maximumFractionDigits:2})}</span></div>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Budget */}
      {activeTab === 'budget' && projectId && (
        <ProjectBudget
          projectId={projectId}
          canEdit={profile?.role === 'management' || profile?.role === 'principal' || profile?.role === 'accountant'}
        />
      )}

      {/* Tab Content: Documents */}
      {activeTab === 'documents' && (
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {documents.length === 0 ? (
              <p className="col-span-full text-on-surface-variant italic p-4 text-center">No documents have been uploaded for this project yet.</p>
            ) : (
              documents.map((doc, idx) => (
                <a key={idx} href={doc.url} target="_blank" rel="noreferrer" className="group block border border-outline-variant/20 rounded-xl p-4 hover:bg-surface-container-low hover:border-primary/30 transition-all text-center">
                  <div className="w-16 h-16 mx-auto bg-primary-container text-primary rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <FileText size={24} />
                  </div>
                  <h4 className="font-semibold text-body-md truncate" title={doc.title}>{doc.title}</h4>
                  <p className="text-label-caps text-on-surface-variant mt-1">{doc.type}</p>
                  <p className="text-label-caps text-on-surface-variant">{new Date(doc.date).toLocaleDateString()}</p>
                </a>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab Content: Financials (Billing) — Principal only */}
      {activeTab === 'billing' && (
        <div className="space-y-6">
          {!isPrincipal ? (
            <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-12 flex flex-col items-center text-center gap-3">
              <span className="material-symbols-outlined text-[48px] text-on-surface-variant/20">lock</span>
              <p className="text-[15px] font-semibold text-on-surface-variant/40">The Financials tab is visible to Principal only.</p>
            </div>
          ) : (
            <>
              {/* Contract Summary */}
              {(() => {
                const bills = projectBills ?? [];
                const totalBilled    = bills.reduce((s: number, b: any) => s + Number(b.total_amount ?? 0), 0);
                const totalReceived  = bills.reduce((s: number, b: any) => s + Number(b.paid_amount ?? 0), 0);
                const outstanding    = totalBilled - totalReceived;
                const retentionHeld  = bills.reduce((s: number, b: any) => s + Number(b.retention_amount ?? 0), 0);
                return (
                  <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6">
                    <p className="text-[11px] font-bold text-on-surface-variant/40 uppercase tracking-wider mb-4">Contract Summary</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-4 bg-surface-container-low/50 rounded-xl">
                        <p className="text-[10px] text-on-surface-variant/50 mb-1">Total Billed</p>
                        <p className="font-data-mono text-[16px] font-bold text-on-surface">₹{totalBilled.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="p-4 bg-secondary/[0.05] rounded-xl">
                        <p className="text-[10px] text-on-surface-variant/50 mb-1">Total Received</p>
                        <p className="font-data-mono text-[16px] font-bold text-secondary">₹{totalReceived.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="p-4 bg-amber-50 rounded-xl">
                        <p className="text-[10px] text-on-surface-variant/50 mb-1">Outstanding</p>
                        <p className="font-data-mono text-[16px] font-bold text-amber-600">₹{outstanding.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="p-4 bg-surface-container-low/50 rounded-xl">
                        <p className="text-[10px] text-on-surface-variant/50 mb-1">Retention Held</p>
                        <p className="font-data-mono text-[16px] font-bold text-on-surface">₹{retentionHeld.toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Billing Schedule */}
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-surface-container-low/40 border-b border-outline-variant/10 flex items-center justify-between">
                  <p className="text-[11px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Billing Schedule</p>
                  <button
                    onClick={() => navigate('/billing/new', { state: { projectId } })}
                    className="flex items-center gap-1 text-[12px] text-primary font-semibold hover:underline"
                  >
                    <span className="material-symbols-outlined text-[15px]">add</span>
                    Raise Bill
                  </button>
                </div>
                {(!projectBills || projectBills.length === 0) ? (
                  <p className="px-6 py-8 text-[13px] text-on-surface-variant/40 text-center">No bills raised for this project yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide border-b border-outline-variant/[0.07]">
                          <th className="px-5 py-2.5 text-left">Bill No</th>
                          <th className="px-4 py-2.5 text-left">Milestone</th>
                          <th className="px-4 py-2.5 text-left">Type</th>
                          <th className="px-4 py-2.5 text-left">Date</th>
                          <th className="px-4 py-2.5 text-right">Amount</th>
                          <th className="px-4 py-2.5 text-right">Received</th>
                          <th className="px-4 py-2.5 text-right">Outstanding</th>
                          <th className="px-5 py-2.5 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/[0.06]">
                        {projectBills.map((bill: any) => {
                          const outstanding = Math.max(0, Number(bill.total_amount) - Number(bill.paid_amount));
                          const statusStyles: Record<string, string> = {
                            Draft:     'bg-surface-container-highest text-on-surface-variant',
                            Sent:      'bg-blue-50 text-blue-700',
                            Partial:   'bg-amber-50 text-amber-700',
                            Paid:      'bg-secondary-container text-on-secondary-container',
                            Overdue:   'bg-error-container text-error',
                            Void:      'bg-surface-container text-on-surface-variant/40',
                            Cancelled: 'bg-surface-container text-on-surface-variant/40',
                          };
                          const typeLabels: Record<string, string> = {
                            progress: 'Progress', final: 'Final', advance: 'Advance',
                            invoice: 'Invoice', proforma: 'Proforma',
                          };
                          return (
                            <tr
                              key={bill.invoice_id}
                              onClick={() => navigate(`/billing/${bill.invoice_id}`)}
                              className="hover:bg-surface-container-low/40 transition-colors cursor-pointer"
                            >
                              <td className="px-5 py-3 font-data-mono font-bold text-on-surface">{bill.invoice_id}</td>
                              <td className="px-4 py-3 text-on-surface-variant/70 max-w-[140px] truncate">{bill.milestone_name || '—'}</td>
                              <td className="px-4 py-3 text-on-surface-variant/60">{typeLabels[bill.invoice_type] ?? bill.invoice_type}</td>
                              <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">
                                {new Date(bill.invoice_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </td>
                              <td className="px-4 py-3 text-right font-data-mono font-semibold text-on-surface">₹{Number(bill.total_amount).toLocaleString('en-IN')}</td>
                              <td className="px-4 py-3 text-right font-data-mono text-secondary">{Number(bill.paid_amount) > 0 ? `₹${Number(bill.paid_amount).toLocaleString('en-IN')}` : '—'}</td>
                              <td className="px-4 py-3 text-right font-data-mono font-semibold">
                                {outstanding > 0 ? <span className="text-amber-600">₹{outstanding.toLocaleString('en-IN')}</span> : <span className="text-on-surface-variant/25">—</span>}
                              </td>
                              <td className="px-5 py-3">
                                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${statusStyles[bill.status] ?? statusStyles.Draft}`}>
                                  {bill.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}
