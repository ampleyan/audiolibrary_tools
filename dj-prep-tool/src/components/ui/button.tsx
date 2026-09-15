import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#ff4fa3] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[#76134b] text-[#ffe1ef] shadow hover:bg-[#8f1d5c]",
        destructive: "bg-[#7f1d1d] text-[#fca5a5] shadow-sm hover:bg-[#991b1b]",
        outline: "border border-[#513343] bg-transparent text-[#d0b7c4] shadow-sm hover:bg-[#1b121a]",
        secondary: "bg-[#1b121a] text-[#d0b7c4] shadow-sm hover:bg-[#261522]",
        ghost: "text-[#a48e9b] hover:bg-[#1b121a] hover:text-[#f8f4f7]",
        link: "text-[#ff6fb5] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-7 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
