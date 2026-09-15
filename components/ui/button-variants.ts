import { cva, type VariantProps } from 'class-variance-authority'

/**
 * Button class variants, kept in a module with no `'use client'` directive.
 *
 * `components/ui/button.tsx` is a Client Component, and Next.js forbids
 * *calling* a client module's exports from the server — only rendering them as
 * components or passing them as props. A Server Component that wanted the class
 * string (the 404 page's `next/link` styled as a button) therefore could not
 * import it from there: the build failed with "Attempted to call
 * buttonVariants() from the server".
 *
 * Splitting the pure `cva` definition out lets both worlds share one source of
 * truth. Client Components keep importing from `@/components/ui/button`
 * (re-exported below the same name); Server Components import from here.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 has-[>svg]:gap-1.5 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 focus-visible:ring-destructive/40',
        outline: 'border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        success: 'bg-success text-success-foreground shadow-sm hover:bg-success/90',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 gap-1.5 rounded-md px-3 text-xs',
        xs: 'h-7 gap-1 rounded px-2 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-xs': 'size-7 rounded [&_svg:not([class*=size-])]:size-3.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
