import React from "react";
import { cn } from "../../lib/utils";

export function Separator({ className, orientation = "horizontal", ...props }) {
  return <div className={cn("ui-separator", `ui-separator--${orientation}`, className)} {...props} />;
}
