import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("authenticated and public UI reuse the Pigmint logo component", () => {
  const shell = readFileSync("src/components/AppShell.tsx", "utf8");
  const landing = readFileSync("src/routes/Landing.tsx", "utf8");
  const logo = readFileSync("src/components/PigmintLogo.tsx", "utf8");

  assert.match(shell, /PigmintLogo/);
  assert.match(landing, /PigmintLogo/);
  assert.match(logo, /pig/);
  assert.match(logo, /mint/);
  assert.match(logo, /text-primary/);
  assert.doesNotMatch(logo, /aria-hidden/);
  assert.doesNotMatch(logo, /place-items-center/);
});

test("billing required errors open a paid dialog instead of moderation warning", () => {
  const form = readFileSync("src/components/GenerateForm.tsx", "utf8");
  const moderation = readFileSync("src/components/ModerationWarning.tsx", "utf8");

  assert.match(form, /BillingRequiredDialog/);
  assert.match(form, /paidRequired/);
  assert.match(form, /free_generation_credit_cap/);
  assert.match(form, /video_requires_paid_plan/);
  assert.match(form, /insufficient_credits/);
  assert.match(form, /moderation_blocked/);
  assert.match(moderation, /Prompt flagged/);
});

test("folders can receive new generations and existing generations can be moved", () => {
  const gallery = readFileSync("src/routes/Gallery.tsx", "utf8");
  const form = readFileSync("src/components/GenerateForm.tsx", "utf8");
  const folderTree = readFileSync("src/components/FolderTree.tsx", "utf8");
  const detail = readFileSync("src/routes/GenerationDetail.tsx", "utf8");
  const foldersRoute = readFileSync("worker/routes/folders.ts", "utf8");

  assert.match(gallery, /<GenerateForm[\s\S]*folderId=\{filters\.folderId\}/);
  assert.match(form, /folderId\?: string/);
  assert.match(form, /folderId: folderId \?\? null/);
  assert.match(folderTree, /setQueryData/);
  assert.match(folderTree, /onSelect\(data\.folder\.id\)/);
  assert.match(foldersRoute, /return c\.json\(\{ folder \}\)/);
  assert.match(detail, /queryKey: \["folders"\]/);
  assert.match(detail, /method: "PATCH"/);
  assert.match(detail, /folderId: value === "none" \? null : value/);
});

test("model previews use a stable thumbnail proxy route", () => {
  const combobox = readFileSync("src/components/ModelCombobox.tsx", "utf8");
  const modelsRoute = readFileSync("worker/routes/models.ts", "utf8");

  assert.match(combobox, /modelThumbnailSrc/);
  assert.match(combobox, /\/models\/thumb\?key=/);
  assert.doesNotMatch(combobox, /\/models\/\$\{encodeURIComponent\(m\.key\)\}\/thumb/);
  assert.match(modelsRoute, /modelsRoutes\.get\("\/thumb"/);
  assert.doesNotMatch(modelsRoute, /cf:\s*\{[\s\S]*image:/);
});
