// 表单控件 - 带深度和焦点过渡

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}

const inputClass =
  'w-full rounded-lg bg-background border border-border px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 transition-all duration-150 hover:border-border-light';

export function Input({ label, className = '', ...props }: InputProps) {
  return (
    <div>
      {label && <label className="mb-2 block text-xs font-medium text-muted-foreground">{label}</label>}
      <input className={`${inputClass} ${className}`} {...props} />
    </div>
  );
}

export function Textarea({ label, className = '', ...props }: TextareaProps) {
  return (
    <div>
      {label && <label className="mb-2 block text-xs font-medium text-muted-foreground">{label}</label>}
      <textarea className={`${inputClass} resize-none ${className}`} {...props} />
    </div>
  );
}

export function Select({ label, options, className = '', ...props }: SelectProps) {
  return (
    <div>
      {label && <label className="mb-2 block text-xs font-medium text-muted-foreground">{label}</label>}
      <select className={`${inputClass} ${className}`} {...props}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
