const fs = require('fs');
const PDFDocument = require('pdfkit');
const { MaxRectsPacker } = require('maxrects-packer');
const { removeBackground } = require('@imgly/background-removal-node');
const { execSync } = require('child_process');

const A3_WIDTH_PT = 841.89;
const A3_HEIGHT_PT = 1190.55;
const PT_PER_INCH = 72;
const DPI = 300;
const SCALE_FACTOR = PT_PER_INCH / DPI;

const GAP_MM = 3;
const GAP_INCH = GAP_MM / 25.4;
const GAP_PX = Math.round(GAP_INCH * DPI);

async function processSticker(filePath, identifier) {
    console.log(`Processing [${identifier}] - Extracting background...`);
    const blob = await removeBackground(filePath);
    const rawBuffer = Buffer.from(await blob.arrayBuffer());
    
    const tmpTransparent = `${identifier}_tmp.png`;
    const tmpPrint = `${identifier}_print.png`;
    const tmpCut = `${identifier}_cut.svg`;
    fs.writeFileSync(tmpTransparent, rawBuffer);
    
    console.log(`[${identifier}] - Calling isolated vector math engine...`);
    execSync(`node generate_vector_cut.cjs "${tmpTransparent}" "${tmpPrint}" "${tmpCut}" ${GAP_PX}`);
    
    const cutSvg = fs.readFileSync(tmpCut, 'utf8');
    const dMatch = cutSvg.match(/d="([^"]+)"/);
    const svgPathData = dMatch ? dMatch[1] : null;

    const wMatch = cutSvg.match(/width="([\d.]+)"/);
    const hMatch = cutSvg.match(/height="([\d.]+)"/);
    const paddedW = parseFloat(wMatch[1]);
    const paddedH = parseFloat(hMatch[1]);

    const printBuffer = fs.readFileSync(tmpPrint);

    // Cleanup
    if (fs.existsSync(tmpTransparent)) fs.unlinkSync(tmpTransparent);
    if (fs.existsSync(tmpPrint)) fs.unlinkSync(tmpPrint);
    if (fs.existsSync(tmpCut)) fs.unlinkSync(tmpCut);

    return {
        id: identifier,
        width: paddedW,
        height: paddedH,
        printBuffer: printBuffer,
        svgPathData: svgPathData
    };
}

async function runBatch() {
    console.log("=== STARTING BATCH TEST WITH RECOVERY ENGINE ===");
    
    const testFiles = [
        'stickers/3-human-sticker.jpg',
        'stickers/404-error-sticker.jpg',
        'stickers/adobe-sticker.jpg'
    ];
    
    const assets = [];
    for (let i = 0; i < testFiles.length; i++) {
        if (!fs.existsSync(testFiles[i])) continue;
        const asset = await processSticker(testFiles[i], `Sticker-${i}`);
        assets.push(asset);
        assets.push(asset); 
    }
    
    console.log("=== PACKING ASSETS INTO A3 ===");
    const packer = new MaxRectsPacker(
        A3_WIDTH_PT / SCALE_FACTOR,
        A3_HEIGHT_PT / SCALE_FACTOR,
        15,
        { smart: true, pot: false, square: false, allowRotation: true }
    );
    
    packer.addArray(assets.map(a => ({ width: a.width, height: a.height, data: a })));
    const bin = packer.bins[0];
    
    console.log(`Packed ${bin.rects.length} stickers onto Page 1!`);
    
    const printPdf = new PDFDocument({ size: 'A3', margin: 0 });
    const cutPdf = new PDFDocument({ size: 'A3', margin: 0 });
    
    printPdf.pipe(fs.createWriteStream('BATCH_TEST_PRINT.pdf'));
    cutPdf.pipe(fs.createWriteStream('BATCH_TEST_CUT.pdf'));
    
    for (const rect of bin.rects) {
        const xPt = rect.x * SCALE_FACTOR;
        const yPt = rect.y * SCALE_FACTOR;
        const wPt = rect.width * SCALE_FACTOR;
        const hPt = rect.height * SCALE_FACTOR;
        
        printPdf.save();
        cutPdf.save();
        
        if (rect.rot) { 
            printPdf.translate(xPt, yPt + hPt).rotate(-90);
            cutPdf.translate(xPt, yPt + hPt).rotate(-90);
            printPdf.image(rect.data.printBuffer, 0, 0, { width: hPt, height: wPt });
            if (rect.data.svgPathData) {
                cutPdf.save().scale(SCALE_FACTOR).path(rect.data.svgPathData).lineWidth(2).stroke('black').restore();
            }
        } else {
            printPdf.translate(xPt, yPt);
            cutPdf.translate(xPt, yPt);
            printPdf.image(rect.data.printBuffer, 0, 0, { width: wPt, height: hPt });
            if (rect.data.svgPathData) {
                cutPdf.save().scale(SCALE_FACTOR).path(rect.data.svgPathData).lineWidth(2).stroke('black').restore();
            }
        }
        printPdf.restore();
        cutPdf.restore();
    }
    
    printPdf.end();
    cutPdf.end();
    console.log("DONE! PDFs generated and recovered.");
}

runBatch().catch(console.error);
