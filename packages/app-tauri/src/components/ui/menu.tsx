import * as React from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { menuItemVariants } from './menu-variants';

export { MENU_CONTENT_PADDING, menuItemVariants } from './menu-variants';

export function MenuLabel({
  children,
  trailing,
  className,
}: { children: React.ReactNode; trailing?: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-[8px] pb-[4px] pt-[5px] text-micro font-bold uppercase tracking-wide text-mf-text-3',
        className,
      )}
    >
      <span>{children}</span>
      {trailing}
    </div>
  );
}

export function MenuDivider({ className, section }: { className?: string; section?: boolean }) {
  return (
    <div
      className={cn(
        section ? 'border-t border-border' : 'mx-1.5 my-[4px] border-t-[0.5px] border-border',
        className,
      )}
    />
  );
}

interface MenuRowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  label: React.ReactNode;
  note?: React.ReactNode;
  hint?: React.ReactNode;
  trailing?: React.ReactNode;
  danger?: boolean;
}
export const MenuRow = React.forwardRef<HTMLButtonElement, MenuRowProps>(
  ({ icon, label, note, hint, trailing, danger, className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(
        menuItemVariants({ tone: danger ? 'destructive' : 'default' }),
        'w-full text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-[0.45]',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note != null && <span className="shrink-0 text-caption text-mf-text-3">{note}</span>}
      {hint != null && <span className="shrink-0 text-caption text-mf-text-4">{hint}</span>}
      {trailing}
    </button>
  ),
);
MenuRow.displayName = 'MenuRow';

interface MenuSearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onValueChange: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}
export function MenuSearchField({ value, onValueChange, className, inputRef, ...props }: MenuSearchFieldProps) {
  return (
    <div className={cn('flex h-[30px] items-center gap-[7px] rounded-md border-[0.5px] border-border bg-mf-content2 px-2', className)}>
      <Search size={13} className="shrink-0 text-mf-text-3" aria-hidden />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-mf-text-4"
        {...props}
      />
    </div>
  );
}

interface MenuCheckRowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  checked: boolean;
  swatch?: React.ReactNode;
  label: React.ReactNode;
}
export const MenuCheckRow = React.forwardRef<HTMLButtonElement, MenuCheckRowProps>(
  ({ checked, swatch, label, className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      role="checkbox"
      aria-checked={checked}
      className={cn(menuItemVariants(), 'w-full text-left hover:bg-accent', className)}
      {...props}
    >
      <span
        className={cn(
          'inline-flex size-[15px] shrink-0 items-center justify-center rounded-xs',
          checked ? 'bg-primary' : 'border-[1.5px] border-border bg-transparent',
        )}
        aria-hidden
      >
        {checked && <Check size={9} className="text-primary-foreground" />}
      </span>
      {swatch}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  ),
);
MenuCheckRow.displayName = 'MenuCheckRow';

interface MenuSelectRowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected: boolean;
  dot?: React.ReactNode;
  label: React.ReactNode;
  meta?: React.ReactNode;
}
export const MenuSelectRow = React.forwardRef<HTMLButtonElement, MenuSelectRowProps>(
  ({ selected, dot, label, meta, className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-pressed={selected}
      className={cn(menuItemVariants(), 'w-full text-left hover:bg-accent', selected && 'bg-mf-selection', className)}
      {...props}
    >
      {dot}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta != null && <span className="shrink-0 text-caption text-mf-text-3">{meta}</span>}
      {selected && <Check size={13} className="shrink-0 text-primary" />}
    </button>
  ),
);
MenuSelectRow.displayName = 'MenuSelectRow';

export function MenuEmpty({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-1.5 px-2 py-4 text-caption text-mf-text-3', className)}>
      {children}
    </div>
  );
}
