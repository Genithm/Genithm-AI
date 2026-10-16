import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("branded research workspace is attached to the existing authenticated AI route", () => {
  const page = read("../app/dashboard/ai/page.tsx");
  assert.match(page, /createClient/);
  assert.match(page, /getClaims/);
  assert.match(page, /ResearchChatSidebar/);
  assert.match(page, /AiChatComposer/);
  assert.match(page, /GenithmToolDock/);
  assert.match(page, /scienceExecutionReady/);
  assert.match(page, /genithm-research-theme\.css/);
  assert.match(page, /genithm-research-fields\.css/);
});

test("brand image shipped and referenced from existing authenticated layout", () => {
  const asset = new URL("../public/genithm-logo.webp", import.meta.url);
  assert.ok(statSync(asset).size > 1000);
  assert.equal(readFileSync(asset).subarray(0, 4).toString(), "RIFF");
  assert.match(read("../app/dashboard/layout.tsx"), /genithm-logo\.webp/);
  assert.match(read("../components/research-chat-sidebar.tsx"), /genithm-logo\.webp/);
});

test("tool dock only navigates to existing scientific routes", () => {
  const toolDock = read("../components/genithm-tool-dock.tsx");
  const expected = [
    "/dashboard/tools",
    "/dashboard/pipelines",
    "/dashboard/ai/research",
    "/dashboard/workflows",
    "/dashboard/operations",
  ];
  for (const route of expected) assert.ok(toolDock.includes(route), route);
  assert.doesNotMatch(toolDock, /Math\.random|mockResult|fakeProgress/);
  assert.match(toolDock, /scienceReady/);
});

test("light brand theme remains limited to the AI homepage", () => {
  const theme = read("../components/genithm-research-theme.css");
  assert.match(theme, /body:has\(\.genithm-tool-dock\)/);
  assert.match(theme, /grid-template-columns:245px minmax\(0,1fr\) 280px/);
  assert.match(theme, /max-width:940px/);
});
