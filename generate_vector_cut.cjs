const fs = require('fs');
const potrace = require('potrace');
const sharp = require('sharp');

const inputPath = process.argv[2];
const outputPrintPath = process.argv[3];
const outputCutPath = process.argv[4];
const GAP_PX = parseInt(process.argv[5], 10);

function extractOuterPath(svgPathData) {
    // Split the path by 'M' or 'm' commands
    // We add 'M' back to each part
    const subPaths = svgPathData.split(/(?=[Mm])/).map(s => s.trim()).filter(s => s.length > 0);
    
    let maxArea = -1;
    let outerPath = '';

    for (let p of subPaths) {
        // Approximate the bounding box
        const numbers = p.match(/[-+]?[0-9]*\.?[0-9]+/g);
        if (!numbers || numbers.length < 2) continue;
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        for (let i = 0; i < numbers.length; i += 2) {
            const x = parseFloat(numbers[i]);
            const y = parseFloat(numbers[i+1]);
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        
        const area = (maxX - minX) * (maxY - minY);
        if (area > maxArea) {
            maxArea = area;
            outerPath = p;
        }
    }
    
    return outerPath;
}

async function generate() {
    const rawBuffer = fs.readFileSync(inputPath);
    const metadata = await sharp(rawBuffer).metadata();
    
    // Create black silhouette for tracing
    const stickerSilhouette = await sharp(rawBuffer)
        .extractChannel('alpha')
        .negate()
        .png()
        .toBuffer();
        
    potrace.trace(stickerSilhouette, { 
        threshold: 128,
        turdSize: 100,
        optTolerance: 0.8,
        blackOnWhite: true,
    }, async (err, svgString) => {
        if (err) throw err;
        
        let expandedSvgBlack = svgString
            .replace(/stroke="none"/g, `stroke="black" stroke-width="${GAP_PX * 2}" stroke-linejoin="round" stroke-linecap="round"`)
            .replace(/fill="black"/g, `fill="black"`);
        
        const wMatch = expandedSvgBlack.match(/width="([\d.]+)"/);
        const hMatch = expandedSvgBlack.match(/height="([\d.]+)"/);
        const w = parseFloat(wMatch[1]);
        const h = parseFloat(hMatch[1]);
        const paddedW = Math.round(w + GAP_PX*4);
        const paddedH = Math.round(h + GAP_PX*4);
        
        let paddedSvgBlack = expandedSvgBlack
            .replace(`width="${w}"`, `width="${paddedW}"`)
            .replace(`height="${h}"`, `height="${paddedH}"`)
            .replace(/viewBox="[^"]+"/, `viewBox="-${GAP_PX*2} -${GAP_PX*2} ${paddedW} ${paddedH}"`);

        const outlineRasterBlack = await sharp(Buffer.from(paddedSvgBlack)).png().toBuffer();

        potrace.trace(outlineRasterBlack, { color: 'black', optTolerance: 0.2 }, async (err, finalCutSvg) => {
            if (err) throw err;
            
            // CLEAN HOLES: Only keep the outermost path
            const dMatch = finalCutSvg.match(/d="([^"]+)"/);
            if (dMatch) {
                const outerD = extractOuterPath(dMatch[1]);
                finalCutSvg = finalCutSvg.replace(`d="${dMatch[1]}"`, `d="${outerD}"`);
            }
            
            fs.writeFileSync(outputCutPath, finalCutSvg);
            
            await sharp({
                create: {
                    width: paddedW,
                    height: paddedH,
                    channels: 4,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                }
            })
            .composite([
                { input: rawBuffer, top: GAP_PX*2, left: GAP_PX*2 }
            ])
            .png()
            .toFile(outputPrintPath);
        });
    });
}

generate().catch(err => {
    console.error(err);
    process.exit(1);
});
