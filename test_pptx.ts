import PptxGenJS from "npm:pptxgenjs@3.12.0";
const pptx = new PptxGenJS();
pptx.addSlide();
console.log("Keys:", Object.keys(pptx));
console.log("Slides property (slides):", !!(pptx as any).slides);
console.log("Slides property (_slides):", !!(pptx as any)._slides);
if ((pptx as any).slides) console.log("slides length:", (pptx as any).slides.length);
if ((pptx as any)._slides) console.log("_slides length:", (pptx as any)._slides.length);
