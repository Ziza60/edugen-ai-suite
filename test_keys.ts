import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";
const pres = new PptxGenJS();
const slide = pres.addSlide();
slide.addText("test");
for (const key in slide) {
  // @ts-ignore
  if (Array.isArray(slide[key])) {
    console.log(`Key "${key}" is an array of length ${slide[key].length}`);
  }
}
