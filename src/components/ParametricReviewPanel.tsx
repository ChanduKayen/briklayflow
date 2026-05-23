import React, { useState } from 'react';

interface ExtractedAttributes {
  sub_category: string;
  dimension: string | null;
  variant: string | null;
  grade: string | null;
}

interface ValidationMetrics {
  passes_shop_floor_test: boolean;
  missing_parameters: string[];
}

interface SkuMatchPayload {
  ai_suggested_name: string;
  extracted_attributes: ExtractedAttributes;
  validation_metrics: ValidationMetrics;
  aliases?: string[];
  p_embedding?: number[];
}

interface ParametricReviewPanelProps {
  payload: SkuMatchPayload;
  itemName: string;
  onApprove: (finalSkuData: {
    sub_category: string;
    dimension: string | null;
    variant: string | null;
    grade: string | null;
    canonicalName: string;
    aliases?: string[];
    p_embedding?: number[];
  }) => void;
}

export const ParametricReviewPanel: React.FC<ParametricReviewPanelProps> = ({ 
  payload, 
  itemName,
  onApprove 
}) => {
  // Safe instantiation of extraction fields, fall back to empty strings for inputs
  const [form, setForm] = useState<Record<string, string>>({
    sub_category: payload.extracted_attributes.sub_category || '',
    dimension: payload.extracted_attributes.dimension || '',
    variant: payload.extracted_attributes.variant || '',
    grade: payload.extracted_attributes.grade || '',
  });

  const missingFields = payload.validation_metrics.missing_parameters;

  // Visual Cue Engine: Highlights missing fields required by the shop floor test
  const getFieldStyle = (fieldName: string) => {
    const isMissing = missingFields.includes(fieldName) || !form[fieldName];
    return {
      border: isMissing ? '0.5px solid #fca5a5' : '0.5px solid #cbd5e1',
      backgroundColor: isMissing ? '#fef2f2' : '#ffffff',
      padding: '4px 8px',
      borderRadius: '4px',
      width: '100%',
      fontSize: '11px',
      color: '#334155',
      outline: 'none',
      boxSizing: 'border-box' as const,
    };
  };

  const handleFieldChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Enforce clean lookback concatenation metrics across candidate interfaces
    const buildCleanChipName = (attrs: {
      dimension: string | null;
      grade: string | null;
      sub_category: string;
      variant: string | null;
    }) => {
      const parts: string[] = [];

      // Prune down literal null text strings or raw spaces completely from index evaluation positions
      if (attrs.dimension && attrs.dimension.toLowerCase() !== 'null' && attrs.dimension.trim() !== '') {
        parts.push(attrs.dimension.trim());
      }
      if (attrs.grade && attrs.grade.toLowerCase() !== 'null' && attrs.grade.trim() !== '') {
        parts.push(attrs.grade.trim());
      }
      
      // Ingest clean translated ontological tree subcategory string
      if (attrs.sub_category && attrs.sub_category.toLowerCase() !== 'null' && attrs.sub_category.trim() !== '') {
        parts.push(attrs.sub_category.trim());
      }

      let baseName = parts.join(' ').toUpperCase();

      // Append variant manufacturer metrics dynamically inside bounds grouping indicators
      if (attrs.variant && attrs.variant.toLowerCase() !== 'null' && attrs.variant.trim() !== '') {
        baseName += ` (${attrs.variant.trim().toUpperCase()})`;
      }

      // Sanitize double spaces or layout drifts from structural display fields
      return baseName.replace(/\s+/g, ' ').trim();
    };

    const canonicalName = buildCleanChipName({
      dimension: form.dimension,
      grade: form.grade,
      sub_category: form.sub_category,
      variant: form.variant
    });
    
    onApprove({
      sub_category: form.sub_category.trim(),
      dimension: form.dimension.trim() || null,
      variant: form.variant.trim() || null,
      grade: form.grade.trim() || null,
      canonicalName: canonicalName,
      aliases: payload.aliases,
      p_embedding: payload.p_embedding
    });
  };

  return (
    <div className="mt-3 p-4 bg-red-50/50 rounded-xl border border-red-200 shadow-sm relative overflow-hidden transition-all">
      <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
      
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-[16px] text-red-500">error</span>
        <div>
          <h4 className="text-[12px] font-bold text-red-900 leading-tight">Missing Required Parameters</h4>
          <p className="text-[10px] text-red-700/80 mt-0.5">
            AI categorized "<span className="font-bold text-red-900">{itemName}</span>" as "<span className="font-bold text-red-900">{payload.extracted_attributes.sub_category}</span>". Please fill in missing details to link.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-4 gap-3 mb-4">
          {/* Category -> Item Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-bold text-red-900/60 uppercase tracking-widest pl-1">Item Name</label>
            <input 
              style={getFieldStyle('sub_category')} 
              className="transition-colors focus:ring-2 focus:ring-red-500/20"
              value={form.sub_category} 
              onChange={(e) => handleFieldChange('sub_category', e.target.value)}
              placeholder="e.g. Urinal Spider"
              required
            />
          </div>

          {/* Dimension */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-bold text-red-900/60 uppercase tracking-widest pl-1">Size / Dim</label>
            <input 
              style={getFieldStyle('dimension')} 
              className="transition-colors focus:ring-2 focus:ring-red-500/20"
              value={form.dimension} 
              onChange={(e) => handleFieldChange('dimension', e.target.value)}
              placeholder="e.g. 2 Inch"
            />
          </div>

          {/* Variant */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-bold text-red-900/60 uppercase tracking-widest pl-1">Variant / Type</label>
            <input 
              style={getFieldStyle('variant')} 
              className="transition-colors focus:ring-2 focus:ring-red-500/20"
              value={form.variant} 
              onChange={(e) => handleFieldChange('variant', e.target.value)}
              placeholder="e.g. Submersible"
            />
          </div>

          {/* Grade */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-bold text-red-900/60 uppercase tracking-widest pl-1">Material / Grade</label>
            <input 
              style={getFieldStyle('grade')} 
              className="transition-colors focus:ring-2 focus:ring-red-500/20"
              value={form.grade} 
              onChange={(e) => handleFieldChange('grade', e.target.value)}
              placeholder="e.g. Mild Steel"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button 
            type="submit"
            className="flex items-center gap-1.5 px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[11px] font-semibold transition-colors shadow-sm"
          >
            Save & Link SKU
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </button>
        </div>
      </form>
    </div>
  );
};
