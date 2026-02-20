// shadcn/ui 风格表单控件 — Input / Textarea / Select
// 保持 label / error props 的便捷 API

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/* ---- 共享样式 ---- */

const fieldBase = [
  'w-full rounded-lg border border-white/10 bg-[#0f1014]/90 px-4 py-3',
  'text-[0.95rem] text-foreground placeholder:text-muted-foreground/65',
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_-1px_0_rgba(0,0,0,0.35)]',
  'transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
  'hover:border-white/18 hover:bg-[#11131a]',
  'focus:border-primary/70 focus:outline-none focus:ring-2 focus:ring-primary/36 focus:ring-offset-2 focus:ring-offset-[#050506]',
  'focus:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_0_1px_rgba(94,106,210,0.3),0_0_20px_rgba(94,106,210,0.2)]',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

const errorField = 'border-destructive hover:border-destructive focus:border-destructive focus:ring-destructive/20';

/* ---- 辅助组件 ---- */

function FieldLabel({ htmlFor, label, required }: { htmlFor: string; label: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-2.5 block text-[0.9rem] font-medium text-muted-foreground">
      {label}
      {required && <span className="ml-0.5 text-destructive">*</span>}
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-destructive">
      <span className="inline-block h-1 w-1 shrink-0 rounded-full bg-destructive" />
      {message}
    </p>
  );
}

/* ---- Input ---- */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id: propId, ...props }, ref) => {
    const autoId = React.useId();
    const id = propId || autoId;
    return (
      <div>
        {label && <FieldLabel htmlFor={id} label={label} required={props.required} />}
        <input
          ref={ref}
          id={id}
          className={cn(fieldBase, error && errorField, className)}
          {...props}
        />
        <FieldError message={error} />
      </div>
    );
  }
);
Input.displayName = 'Input';

/* ---- Textarea ---- */

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id: propId, ...props }, ref) => {
    const autoId = React.useId();
    const id = propId || autoId;
    return (
      <div>
        {label && <FieldLabel htmlFor={id} label={label} required={props.required} />}
        <textarea
          ref={ref}
          id={id}
          className={cn(fieldBase, 'resize-none', error && errorField, className)}
          {...props}
        />
        <FieldError message={error} />
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

/* ---- Select（原生，保留 options prop 的便捷用法） ---- */

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, id: propId, ...props }, ref) => {
    const autoId = React.useId();
    const id = propId || autoId;
    return (
      <div>
        {label && <FieldLabel htmlFor={id} label={label} required={props.required} />}
        <select
          ref={ref}
          id={id}
          className={cn(fieldBase, error && errorField, className)}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <FieldError message={error} />
      </div>
    );
  }
);
Select.displayName = 'Select';

export { Input, Textarea, Select };
