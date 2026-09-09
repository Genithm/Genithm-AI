import type { ReactNode } from "react";

import { ResearchOsRouteTransition } from "./research-os-route-transition";

export function ResearchOsPageBoundary({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ResearchOsRouteTransition>
      {children}
    </ResearchOsRouteTransition>
  );
}
