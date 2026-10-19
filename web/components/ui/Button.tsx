import { cn } from "../../lib/cn";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-teal text-white hover:bg-[#14685f] disabled:bg-teal/50",
  secondary: "border border-line bg-surface text-ink hover:bg-canvas",
  ghost: "text-muted hover:bg-canvas hover:text-ink",
  danger: "bg-danger text-white hover:bg-[#841f1f]",
};

export function Button({ variant = "primary", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors duration-200 ease-soft disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
