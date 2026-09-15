import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[#76134b] text-[#ffe1ef]",
        secondary: "border-transparent bg-[#1b121a] text-[#d0b7c4]",
        destructive: "border-transparent bg-[#7f1d1d] text-[#fca5a5]",
        outline: "border-[#513343] text-[#d0b7c4]",
        success: "border-transparent bg-[#14532d] text-[#4ade80]",
        warning: "border-transparent bg-[#422006] text-[#facc15]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
