import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";
const pres = new PptxGenJS();
pres.addSlide();
console.log("Pres keys:", Object.keys(pres));
// @ts-ignore
console.log("Pres slides length:", pres.slides?.length);
