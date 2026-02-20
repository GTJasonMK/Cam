// shadcn/ui Button — CVA variants + Radix Slot + loading 状态

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium leading-none transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050506] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4',
  {
    variants: {
      variant: {
        default: [
          'border border-primary/75 text-white',
          'bg-[linear-gradient(180deg,#6872D9_0%,#5E6AD2_56%,#4D58B8_100%)]',
          'shadow-[0_0_0_1px_rgba(94,106,210,0.5),0_4px_12px_rgba(94,106,210,0.34),inset_0_1px_0_0_rgba(255,255,255,0.24)]',
          'hover:-translate-y-[1px] hover:bg-[linear-gradient(180deg,#7480E2_0%,#6872D9_56%,#5561C4_100%)]',
          'hover:shadow-[0_0_0_1px_rgba(104,114,217,0.66),0_8px_24px_rgba(94,106,210,0.36),inset_0_1px_0_0_rgba(255,255,255,0.22)]',
          'active:translate-y-0 active:scale-[0.98]',
          'active:shadow-[0_0_0_1px_rgba(94,106,210,0.45),0_2px_8px_rgba(94,106,210,0.24),inset_0_1px_0_0_rgba(255,255,255,0.18)]',
        ].join(' '),
        secondary:
          'border border-white/10 bg-white/[0.05] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:-translate-y-[1px] hover:border-white/18 hover:bg-white/[0.09] hover:shadow-[0_6px_18px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.12)] active:translate-y-0 active:scale-[0.98]',
        destructive: [
          'border border-destructive/75 text-white',
          'bg-[linear-gradient(180deg,#F27690_0%,#EF5A7A_56%,#CF3E60_100%)]',
          'shadow-[0_0_0_1px_rgba(239,90,122,0.5),0_4px_12px_rgba(239,90,122,0.3),inset_0_1px_0_0_rgba(255,255,255,0.2)]',
          'hover:-translate-y-[1px] hover:bg-[linear-gradient(180deg,#F58AA1_0%,#F06A87_56%,#D74A69_100%)]',
          'hover:shadow-[0_0_0_1px_rgba(239,90,122,0.62),0_8px_24px_rgba(239,90,122,0.34),inset_0_1px_0_0_rgba(255,255,255,0.22)]',
          'active:translate-y-0 active:scale-[0.98] active:shadow-[0_0_0_1px_rgba(239,90,122,0.45),0_2px_8px_rgba(239,90,122,0.24)]',
        ].join(' '),
        success: [
          'border border-success/80 text-white',
          'bg-[linear-gradient(180deg,#3ED49A_0%,#26C281_56%,#149D63_100%)]',
          'shadow-[0_0_0_1px_rgba(38,194,129,0.45),0_4px_12px_rgba(38,194,129,0.3),inset_0_1px_0_0_rgba(255,255,255,0.2)]',
          'hover:-translate-y-[1px] hover:bg-[linear-gradient(180deg,#56D9A8_0%,#35CD90_56%,#1FAA71_100%)]',
          'hover:shadow-[0_0_0_1px_rgba(38,194,129,0.58),0_8px_22px_rgba(38,194,129,0.34),inset_0_1px_0_0_rgba(255,255,255,0.2)]',
          'active:translate-y-0 active:scale-[0.98] active:shadow-[0_0_0_1px_rgba(38,194,129,0.42),0_2px_8px_rgba(38,194,129,0.24)]',
        ].join(' '),
        outline:
          'border border-white/12 bg-transparent text-foreground/90 hover:border-white/22 hover:bg-white/[0.05]',
        ghost:
          'bg-transparent text-muted-foreground hover:bg-white/[0.05] hover:text-foreground active:scale-[0.98]',
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
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={asChild ? undefined : type}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
