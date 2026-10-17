const paths: Record<string, string> = {
  chat: "M5 5h14v11H9l-4 4V5Z M8 9h8 M8 12h5",
  projects: "M3 6h7l2 2h9v12H3V6Z M3 10h18",
  data: "M4 5c0-4 16-4 16 0v14c0 4-16 4-16 0V5Z M4 5c0 4 16 4 16 0 M4 12c0 4 16 4 16 0",
  pipelines: "M9 3h6v5H9V3Z M3 16h6v5H3v-5Z M15 16h6v5h-6v-5Z M12 8v4 M6 16v-4h12v4",
  results: "M4 20V10h4v10 M10 20V4h4v16 M16 20v-8h4v8",
  tools: "M3 3h7v7H3V3Z M14 3h7v7h-7V3Z M3 14h7v7H3v-7Z M14 14h7v7h-7v-7Z",
  search: "M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  upload: "M12 16V3 M7 8l5-5 5 5 M3 15v6h18v-6",
  run: "m8 4 12 8-12 8V4Z",
  notebook: "M5 3h15v18H5V3Z M2 7h5 M2 12h5 M2 17h5 M9 7h7 M9 11h7",
  arrow: "M4 12h16 M14 6l6 6-6 6",
  plus: "M12 4v16 M4 12h16",
  menu: "M3 6h18 M3 12h18 M3 18h18",
};
export function GenithmIcon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.tools} /></svg>;
}
