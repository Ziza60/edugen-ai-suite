import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";
const pres = new PptxGenJS();
const slide = pres.addSlide();
slide.addText("Hello World", { x: 1, y: 1, w: 5, h: 1, fontSize: 24 });
// @ts-ignore
const el = slide._slideObjects[0];
console.log("Element keys:", Object.keys(el));
console.log("Element type:", el.type);
console.log("Element text:", JSON.stringify(el.text));
console.log("Element options:", JSON.stringify(el.options));
