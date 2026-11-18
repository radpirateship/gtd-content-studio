import { findAiTells, scrubAiTells } from "./lib/brandRules";
for (const t of ["This is supported consistently in exercise science research on trunk flexion.","The fork is a detail that matters more over time than it sounds."]) console.log(findAiTells(t).length ? "FLAG" : "MISS", t.slice(0,50));
console.log(scrubAiTells('<p class="ppwb-p">The honest answer is that it depends. A genuinely smart design - truly compact. Range 10 - 20 lb.</p>'));
console.log(scrubAiTells('[{"q":"Is it worth it?","a":"Genuinely useful - and 160 – 190 degrees."}]'));
console.log(scrubAiTells('<p>It is <a href="/blogs/wellness/genuinely-x - y">genuinely good</a> value.</p><p>Genuinely sturdy.</p>'));
console.log(scrubAiTells('Plain text. Honestly, it works.'));
