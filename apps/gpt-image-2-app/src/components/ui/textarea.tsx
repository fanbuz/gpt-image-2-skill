import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import {
  useFieldDescribedBy,
  useFieldId,
  useFieldInvalid,
} from "@/lib/field-context";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  monospace?: boolean;
  minHeight?: number;
};

export const Textarea = forwardRef<HTMLTextAreaElement, Props>(
  (
    {
      className,
      monospace,
      minHeight = 80,
      style,
      id: idProp,
      "aria-describedby": ariaDescribedByProp,
      "aria-invalid": ariaInvalidProp,
      ...rest
    },
    ref
  ) => {
    const id = useFieldId(idProp);
    const describedBy = useFieldDescribedBy(
      typeof ariaDescribedByProp === "string" ? ariaDescribedByProp : undefined
    );
    const invalid = useFieldInvalid(
      ariaInvalidProp === true || ariaInvalidProp === "true"
        ? true
        : ariaInvalidProp === false || ariaInvalidProp === "false"
          ? false
          : undefined
    );

    return (
      <textarea
        ref={ref}
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        style={{ minHeight, ...style }}
        className={cn(
          "w-full px-3 py-2.5 bg-raised border border-border rounded-md text-[13.5px] leading-[1.55] outline-none transition-colors focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-faint)] resize-y",
          invalid && "border-status-err focus:border-status-err",
          monospace && "font-mono",
          className
        )}
        {...rest}
      />
    );
  }
);

Textarea.displayName = "Textarea";
