// Writes ART_CHECKLIST.md (the artist's to-do list) from the asset manifest.
//   npm run art
import { writeFileSync } from "node:fs";
import { checklist } from "../src/view/checklist";

writeFileSync(new URL("../ART_CHECKLIST.md", import.meta.url), checklist());
console.log("Wrote ART_CHECKLIST.md");
