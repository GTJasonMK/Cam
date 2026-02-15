// 卡片容器 - 带微妙渐变边框和深度

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
  glow?: string;
}

const PADDING = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export function Card({ children, className = '', padding = 'md', hover = false, glow }: CardProps) {
  return (
    <div
      className={`relative rounded-xl border border-border bg-card ${PADDING[padding]} ${
        hover ? 'transition-all duration-200 hover:border-border-light hover:bg-card-elevated' : ''
      } ${className}`}
      style={{
        boxShadow: glow
          ? glow
          : '0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)',
      }}
    >
      {children}
    </div>
  );
}
