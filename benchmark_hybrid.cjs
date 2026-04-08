const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// Configuration
const TEST_IMAGE = 'stickers/1-aura-sticker-2708.jpg'; // Real test image
const OUTPUT_DIR = 'benchmark_results';
const REAL_ESRGAN_PATH = 'realesrgan/realesrgan-ncnn-vulkan.exe';
const TARGET_WIDTH = 3000; // Target width for upscaling

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

async function runBenchmark() {
    console.log(`=== HYBRID UPSCALE BENCHMARK ===`);
    console.log(`Hardware: Intel UHD 630 / i5-9400`);
    console.log(`Target: 3000px Wide (Print Quality)\n`);

    // 1. COMPACT ANIME MODEL (animevideov3) - EXPECTED WINNER
    testAI('Fast-Anime-v3', 'realesr-animevideov3');

    // 3. HIGH-QUALITY ANIME MODEL (x4plus-anime)
    testAI('Ultra-Anime-Plus', 'realesrgan-x4plus-anime');

    console.log(`\nDONE! Check the '${OUTPUT_DIR}' folder for results and timings.`);
}

function testAI(label, modelName) {
    const output = path.join(OUTPUT_DIR, `upscale_${label}.png`);
    const start = Date.now();
    try {
        console.log(`Running [${label}] with model: ${modelName}...`);
        // -n specifies the model name (without extension) in the models folder
        execSync(`"${REAL_ESRGAN_PATH}" -i "${TEST_IMAGE}" -o "${output}" -n "${modelName}" -s 4`, { stdio: 'inherit' });
        const duration = ((Date.now() - start) / 1000).toFixed(2);
        console.log(`>> [${label}] took ${duration}s\n`);
    } catch (err) {
        console.error(`>> [${label}] FAILED: ${err.message}\n`);
    }
}

runBenchmark();
