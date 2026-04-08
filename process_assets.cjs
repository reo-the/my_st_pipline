const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { removeBackground } = require('@imgly/background-removal-node');
const { Jimp } = require('jimp');

const PROGRESS_FILE = 'progress.json';
const BATCH_LIMIT = 50;

const PRODUCTS_FILE = 'test_products.json';
const STICKERS_DIR = path.join(__dirname, 'stickers');
const TEMP_DIR = path.join(__dirname, 'temp_bg_removed');
const UPSCALED_DIR = path.join(__dirname, 'upscaled_stickers');
const ESCAN_PATH = path.join(__dirname, 'realesrgan', 'realesrgan-ncnn-vulkan.exe');

// Ensure directories exist
[STICKERS_DIR, TEMP_DIR, UPSCALED_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

async function processImage(handle, url) {
    const rawPath = path.join(STICKERS_DIR, `${handle}.jpg`);
    const bgRemovedPath = path.join(TEMP_DIR, `${handle}.png`);
    const upscaledPath = path.join(UPSCALED_DIR, `${handle}.png`);

    try {
        // 1. Download if not exists
        if (!fs.existsSync(rawPath)) {
            console.log(`[${handle}] Downloading...`);
            execSync(`curl -s -o "${rawPath}" "${url}"`);
        }

        // 2. Remove Background and Add Keyline
        if (!fs.existsSync(bgRemovedPath)) {
            console.log(`[${handle}] Removing background...`);
            const imageBuffer = fs.readFileSync(rawPath);
            const imageBlob = new Blob([imageBuffer], { type: 'image/jpeg' });
            const blob = await removeBackground(imageBlob);
            const buffer = Buffer.from(await blob.arrayBuffer());
            
            console.log(`[${handle}] Adding keyline (2-3mm, smoothed)...`);
            const outlineBuffer = await addKeyline(buffer);
            
            fs.writeFileSync(bgRemovedPath, outlineBuffer);
            console.log(`[${handle}] Background removed and keyline added.`);
        }

        // 3. Upscale using Real-ESRGAN
        if (!fs.existsSync(upscaledPath)) {
            console.log(`[${handle}] Upscaling 4x...`);
            const cmd = `"${ESCAN_PATH}" -i "${bgRemovedPath}" -o "${upscaledPath}" -n realesrgan-x4plus`;
            execSync(cmd, { stdio: 'inherit' });
            console.log(`[${handle}] Upscale complete.`);
        }

    } catch (err) {
        console.error(`Error processing ${handle}:`, err.message);
    }
}

async function addKeyline(inputBuffer) {
    const OUTLINE_WIDTH = 25; // Approx 2-3mm
    const SMOOTHNESS = 5;      // Blur level for smoothing

    const image = await Jimp.read(inputBuffer);
    const { width, height } = image.bitmap;

    const padded = new Jimp({
        width: width + (OUTLINE_WIDTH * 2) + 20,
        height: height + (OUTLINE_WIDTH * 2) + 20,
        color: 0x00000000
    });

    padded.composite(image, OUTLINE_WIDTH + 10, OUTLINE_WIDTH + 10);

    const outline = padded.clone();
    
    outline.scan(0, 0, outline.bitmap.width, outline.bitmap.height, function(x, y, idx) {
        if (this.bitmap.data[idx + 3] > 0) {
            this.bitmap.data[idx] = 0;   // R
            this.bitmap.data[idx + 1] = 0; // G
            this.bitmap.data[idx + 2] = 0; // B
            this.bitmap.data[idx + 3] = 255; // A
        }
    });

    outline.blur(OUTLINE_WIDTH / 2);
    
    outline.scan(0, 0, outline.bitmap.width, outline.bitmap.height, function(x, y, idx) {
        if (this.bitmap.data[idx + 3] > 128) {
            this.bitmap.data[idx + 3] = 255;
            this.bitmap.data[idx] = 0;   // R
            this.bitmap.data[idx + 1] = 0; // G
            this.bitmap.data[idx + 2] = 0; // B
        } else {
            this.bitmap.data[idx + 3] = 0;
        }
    });

    outline.blur(SMOOTHNESS);
    outline.composite(padded, 0, 0);

    return await outline.getBuffer("image/png");
}

async function main() {
    if (!fs.existsSync(PRODUCTS_FILE)) {
        console.error(`Error: ${PRODUCTS_FILE} not found. Please restore it first.`);
        return;
    }

    let startIndex = 0;
    if (fs.existsSync(PROGRESS_FILE)) {
        const progressData = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
        startIndex = progressData.lastIndex || 0;
    }

    const data = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
    const products = data.products || [];

    const endIndex = Math.min(startIndex + BATCH_LIMIT, products.length);

    console.log(`Resuming from index ${startIndex}...`);
    console.log(`Processing products ${startIndex + 1} to ${endIndex}...`);

    for (let i = startIndex; i < endIndex; i++) {
        const product = products[i];
        if (product.images && product.images.length > 0) {
            const url = product.images[0].src;
            console.log(`\n--- [${i + 1}/${products.length}] Processing: ${product.handle} ---`);
            await processImage(product.handle, url);
        }
        fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastIndex: i + 1 }, null, 2));
    }

    if (endIndex >= products.length) {
        console.log('\nAll products in file have been processed!');
    } else {
        console.log(`\nBatch complete. Next run will start from image ${endIndex + 1}.`);
    }
}

main().catch(console.error);
