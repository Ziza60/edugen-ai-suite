import PptxGenJS from "npm:pptxgenjs@3.12.0";
const pres = new PptxGenJS();
const slide = pres.addSlide();
slide.addText("Hello World", { x: 1, y: 1, w: 5, h: 1 });
console.log("Slide keys:", Object.keys(slide));
// @ts-ignore
console.log("Slide elements:", slide.elements);
// @ts-ignore
console.log("Slide _slideObjects:", slide._slideObjects);
