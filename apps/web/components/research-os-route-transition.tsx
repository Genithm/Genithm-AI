import type { ReactNode } from "react";

export function ResearchOsRouteTransition({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="research-os-transition">
      {children}
    </div>
  );
}
