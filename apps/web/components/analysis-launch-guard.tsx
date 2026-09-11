"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function projectPrefix(select: HTMLSelectElement) {
  const option = select.options[select.selectedIndex];
  return option ? `${option.text.trim()} · ` : "";
}

function restrictSequenceOptions(projectSelect: HTMLSelectElement, sequenceSelects: HTMLSelectElement[]) {
  const prefix = projectPrefix(projectSelect);
  if (!prefix) return;

  for (const sequenceSelect of sequenceSelects) {
    for (const option of Array.from(sequenceSelect.options)) {
      const allowed = option.text.startsWith(prefix);
      option.hidden = !allowed;
      option.disabled = !allowed;
      if (!allowed) option.selected = false;
    }

    if (!sequenceSelect.multiple) {
      const firstAllowed = Array.from(sequenceSelect.options).find((option) => !option.disabled);
      if (firstAllowed && sequenceSelect.selectedOptions.length === 0) firstAllowed.selected = true;
      if (sequenceSelect.selectedOptions[0]?.disabled && firstAllowed) firstAllowed.selected = true;
    }
  }
}

function enhanceAlignmentForms(root: ParentNode) {
  const heading = Array.from(root.querySelectorAll<HTMLElement>("h2")).find(
    (element) => element.textContent?.trim() === "Alignment workflows",
  );
  const section = heading?.closest("section");
  if (!section) return () => undefined;

  const forms = Array.from(section.querySelectorAll<HTMLFormElement>("form"));
  const cleanups: Array<() => void> = [];

  for (const form of forms) {
    const projectSelect = form.querySelector<HTMLSelectElement>('select[name="project_id"]');
    if (!projectSelect) continue;

    const sequenceSelects = Array.from(
      form.querySelectorAll<HTMLSelectElement>('select[name="sequence_a_id"], select[name="sequence_b_id"], select[name="sequence_upload_ids"]'),
    );
    if (!sequenceSelects.length) continue;

    const sync = () => restrictSequenceOptions(projectSelect, sequenceSelects);
    sync();
    projectSelect.addEventListener("change", sync);
    cleanups.push(() => projectSelect.removeEventListener("change", sync));
  }

  return () => cleanups.forEach((cleanup) => cleanup());
}

export function AnalysisLaunchGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/dashboard") return;
    return enhanceAlignmentForms(document);
  }, [pathname]);

  return null;
}
