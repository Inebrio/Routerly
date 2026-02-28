import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronDown } from 'lucide-react';

export interface Option {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function MultiSelect({ options, value, onChange, placeholder = 'Select...', disabled }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOptions = value.map(v => options.find(o => o.value === v) || { value: v, label: v });
  const unselectedOptions = options.filter(o => !value.includes(o.value));

  const toggleOption = (val: string) => {
    if (disabled) return;
    if (value.includes(val)) onChange(value.filter(v => v !== val));
    else onChange([...value, val]);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div
        className={`input ${disabled ? 'disabled' : ''}`}
        style={{
          minHeight: 38,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: '4px 8px',
          paddingRight: 32,
          position: 'relative'
        }}
        onClick={() => !disabled && setOpen(!open)}
      >
        {selectedOptions.length === 0 && <span style={{ color: 'var(--text-muted)' }}>{placeholder}</span>}
        {selectedOptions.map(opt => (
          <div
            key={opt.value}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--surface-active)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: '0.85rem',
            }}
            onClick={(e) => { e.stopPropagation(); toggleOption(opt.value); }}
          >
            {opt.label}
            <X size={14} style={{ cursor: 'pointer', opacity: 0.7 }} />
          </div>
        ))}
        <ChevronDown size={18} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          marginTop: 4,
          maxHeight: 250,
          overflowY: 'auto',
          zIndex: 50,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
        }}>
          {unselectedOptions.length === 0 ? (
            <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No remaining options</div>
          ) : (
            unselectedOptions.map(opt => (
              <div
                key={opt.value}
                style={{ padding: '10px 12px', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-active)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => toggleOption(opt.value)}
              >
                {opt.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
