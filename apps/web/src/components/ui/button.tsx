// shadcn/ui Button — CVA variants + loading 状态

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium leading-none transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4',
  {
    variants: {
      variant: {
        default:
          'border-primary/65 bg-primary text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.15),0_8px_20px_rgba(47,111,237,0.28)] hover:-translate-y-px hover:border-primary/80 hover:bg-[#3b78ef] hover:shadow-[0_1px_0_rgba(255,255,255,0.18),0_12px_24px_rgba(47,111,237,0.32)] active:translate-y-0 active:scale-[0.985]',
        secondary:
          'border-border bg-card text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:-translate-y-px hover:border-border-light hover:bg-card-elevated hover:shadow-[0_10px_22px_rgba(3,8,16,0.32)] active:translate-y-0 active:scale-[0.985]',
        destructive:
          'border-destructive/65 bg-destructive text-destructive-foreground shadow-[0_1px_0_rgba(255,255,255,0.14),0_8px_18px_rgba(227,93,106,0.26)] hover:-translate-y-px hover:border-destructive/80 hover:bg-[#d95562] active:translate-y-0 active:scale-[0.985]',
        success:
          'border-success/65 bg-success text-white shadow-[0_1px_0_rgba(255,255,255,0.12),0_8px_18px_rgba(34,160,107,0.26)] hover:-translate-y-px hover:border-success/80 hover:bg-[#1f9564] active:translate-y-0 active:scale-[0.985]',
        outline:
          'border-border bg-transparent text-foreground/90 hover:border-border-light hover:bg-card/60',
        ghost:
          'border-transparent bg-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground active:scale-[0.985]',
        link: 'text-primary underline-offset-4 hover:text-accent hover:underline',
      },
      size: {
        default: 'h-11 px-5 text-sm',
        sm: 'h-9 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-11 w-11',
        md: 'h-11 px-5 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, disabled, children, type = 'button', ...props }, ref) => {
    const isDisabled = disabled || loading;
    const showLoadingIcon = loading;

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={type}
        disabled={isDisabled}
        {...props}
      >
        {showLoadingIcon && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
