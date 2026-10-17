import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";
const read = file => readFileSync(new URL(file,import.meta.url),"utf8");
test("branded research workspace is attached to the existing authenticated AI route",()=>{
  const page=read("../app/dashboard/ai/page.tsx");
  for(const token of ['createClient','getClaims','ResearchChatSidebar','AiChatComposer','GenithmToolDock','scienceExecutionReady','genithm-research-theme.css','genithm-research-fields.css'])assert.ok(page.includes(token),token);
});
test("supplied artwork is shipped and rendered by the shared authenticated brand",()=>{
  const asset=new URL("../public/genithm-logo.webp",import.meta.url);
  assert.ok(statSync(asset).size>1000);
  assert.equal(readFileSync(asset).subarray(0,4).toString(),"RIFF");
  assert.match(read("../app/dashboard/layout.tsx"),/GenithmWorkspaceFrame/);
  assert.match(read("../components/genithm-workspace-frame.tsx"),/<GenithmBrand/);
  assert.match(read("../components/genithm-brand.tsx"),/src="\/genithm-logo\.webp"/);
  assert.match(read("../app/dashboard/ai/page.tsx"),/genithm-logo\.webp/);
});
test("tool dock only navigates to existing scientific routes",()=>{
  const dock=read("../components/genithm-tool-dock.tsx");
  for(const route of ["/dashboard/tools","/dashboard/pipelines","/dashboard/ai/research","/dashboard/workflows","/dashboard/operations"])assert.ok(dock.includes(route),route);
  assert.doesNotMatch(dock,/Math\.random|mockResult|fakeProgress/);
  assert.match(dock,/scienceReady/);
});
test("V40 extends the light brand theme to all research surfaces, not only chat home",()=>{
  const theme=read("../app/genithm-light.css");
  const layout=read("../app/layout.tsx");
  assert.match(layout,/data-genithm-theme="light"/);
  assert.match(layout,/genithm-light\.css/);
  assert.match(theme,/color-scheme:light/);
  assert.match(theme,/--g-surface:#fff/);
  assert.match(theme,/prefers-reduced-motion/);
  assert.doesNotMatch(theme,/filter:\s*invert/);
  assert.match(read("../app/dashboard/ai/chat.module.css"),/grid-template-columns:220px minmax\(0,1fr\) 270px/);
  assert.match(read("../app/dashboard/results/results.module.css"),/var\(--g-/);
});
