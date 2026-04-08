const potrace = require('potrace');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Jimp } = require('jimp');

/**
 * Hybrid Upscaler (v2)
 * Smart routing based on color analysis and file size.
 */
async function upscaleHybrid(inputPath, outputPath) {
    const handle = path.basename(inputPath, '.png');
    const svgPath = outputPath.replace('.png', '.svg');
    console.log(`Analyzing: ${handle}`);
    
    // 1. Load image for analysis
    const image = await Jimp.read(inputPath);
    
    // 2. Complexity Detection
    // We check unique colors on a thumbnail for speed
    const thumb = image.clone().resize({ w: 100 });
    const colors = new Set();
    thumb.scan(0, 0, thumb.bitmap.width, thumb.bitmap.height, function(x, y, idx) {
        const r = this.bitmap.data[idx];
        const g = this.bitmap.data[idx+1];
        const b = this.bitmap.data[idx+2];
        colors.add(`${r},${g},${b}`);
    });
    
    const uniqueColorCount = colors.size;
    const fileSize = fs.statSync(inputPath).size;
    
    // Thresholds:
    // - Most stickers are stylized graphics: favor Vector path if reasonably simple.
    // - We increase thresholds to capture more "instant" wins.
    const isSimple = uniqueColorCount < 2000 && fileSize < 600000;
    
    console.log(`-- Stats: Colors=${uniqueColorCount}, Size=${(fileSize/1024).toFixed(1)}KB`);
    
    if (isSimple) {
        return await upscaleVectorEnhanced(image, inputPath, outputPath, svgPath);
    } else {
        return await upscaleAI(inputPath, outputPath);
    }
}

/**
 * Route A: Vector-Enhanced Scaling (Instant / Full Vector)
 */
async function upscaleVectorEnhanced(jimpImage, inputPath, outputPath, svgPath) {
    console.log(">> Routing to Vector-Enhanced Scaling (INSTANT)");
    const start = Date.now();
    
    return new Promise((resolve, reject) => {
        potrace.trace(inputPath, { threshold: 128, turdsize: 2 }, async (err, svg) => {
            if (err) return reject(err);
            
            // 1. Export SVG (for the "Full Vector" requirement)
            fs.writeFileSync(svgPath, svg);
            
            // 2. High-Res Bitmap Scale (Jimp)
            const targetWidth = 3000;
            // Using HERMITE for better sharpness on vector-like graphics
            await jimpImage.resize({ w: targetWidth });
            await jimpImage.write(outputPath);
                
            console.log(`>> Completed in ${((Date.now() - start) / 1000).toFixed(2)}s`);
            resolve(outputPath);
        });
    });
}

/**
 * Route B: AI Upscaling (Optimized for UHD 630)
 */
async function upscaleAI(inputPath, outputPath) {
    const ESCAN_PATH = 'realesrgan/realesrgan-ncnn-vulkan.exe';
    console.log(">> Routing to AI Upscaling (DETAILED)");
    const start = Date.now();
    
    try {
        // -n realesrgan-x4plus-anime: Best balance for stickers
        // -t 128: Ensures stability on integrated graphics
        const cmd = `"${ESCAN_PATH}" -i "${inputPath}" -o "${outputPath}" -n realesrgan-x4plus-anime -s 4 -t 128`;
        execSync(cmd, { stdio: 'inherit' });
        console.log(`>> Completed in ${((Date.now() - start) / 1000).toFixed(2)}s`);
        return outputPath;
    } catch (err) {
        console.error("AI Upscale failed, falling back to Vector", err.message);
        const image = await Jimp.read(inputPath);
        return await upscaleVectorEnhanced(image, inputPath, outputPath, outputPath.replace('.png', '.svg'));
    }
}

module.exports = { upscaleHybrid };
