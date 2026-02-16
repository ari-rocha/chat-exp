import React from "react";
import { cn } from "../../lib/utils";

export const Button = React.forwardRef(function Button(
  { className, variant = "default", size = "md", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn("ui-btn", `ui-btn--${variant}`, `ui-btn-size--${size}`, className)}
      {...props}
    />
  );
});
