// 按钮 - 带渐变和微妙光效

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'success' | 'ghost';
  size?: 'sm' | 'md';
}

const VARIANTS: Record<string, string> = {
  primary:
    'bg-gradient-to-b from-primary to-[#4f46e5] text-white shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] hover:brightness-110 active:brightness-95',
  secondary:
    'bg-muted text-muted-foreground border border-border hover:text-foreground hover:bg-card-elevated hover:border-border-light',
  destructive:
    'bg-gradient-to-b from-destructive to-[#e11d48] text-white shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] hover:brightness-110',
  success:
    'bg-gradient-to-b from-success to-[#059669] text-white shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] hover:brightness-110',
  ghost:
    'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted',
};

const SIZES: Record<string, string> = {
  sm: 'h-7 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
