import * as Radix from "@radix-ui/react-dialog";
import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
};

export function Dialog({ open, onOpenChange, title, width = 520, children, footer }: Props) {
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 bg-black/25 backdrop-blur-sm z-40 animate-fade-in" />
        <Radix.Content
          style={{ width, maxWidth: "calc(100vw - 48px)" }}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "bg-raised border border-border rounded-xl shadow-lg animate-fade-up"
          )}
        >
          {title && (
            <div className="flex shrink-0 items-center justify-between px-[18px] py-3.5 border-b border-border-faint">
              <Radix.Title className="t-h2">{title}</Radix.Title>
              <Radix.Close asChild>
                <Button variant="ghost" size="iconSm" icon="x" />
              </Radix.Close>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-[18px]">{children}</div>
          {footer && (
            <div className="flex shrink-0 justify-end gap-2 border-t border-border-faint bg-raised px-[18px] py-3">
              {footer}
            </div>
          )}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
