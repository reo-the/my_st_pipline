const fs = require('fs');
const https = require('https');
const path = require('path');

const FILES = [
    'products.json',
    'products_p2.json',
    'products_p3.json',
    'products_p4.json',
    'products_p5.json',
    'products_p6.json',
    'products_p7.json',
    'products_p8.json',
    'products_p9.json'
];

const TARGET_DIR = path.join(__dirname, 'stickers');

if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR);
}

async function downloadImage(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

async function main() {
    const imagesToDownload = [];
    
    for (const fileName of FILES) {
        if (!fs.existsSync(fileName)) {
            console.warn(`File ${fileName} not found, skipping.`);
            continue;
        }
        
        try {
            const data = JSON.parse(fs.readFileSync(fileName, 'utf8'));
            for (const product of data.products) {
                if (product.images && product.images.length > 0) {
                    const mainImage = product.images[0];
                    // Strip query params to get high-res original
                    const url = mainImage.src.split('?')[0];
                    const extension = path.extname(url) || '.jpg';
                    const fileName = `${product.handle}${extension}`;
                    const dest = path.join(TARGET_DIR, fileName);
                    
                    imagesToDownload.push({ url, dest, handle: product.handle });
                }
            }
        } catch (e) {
            console.error(`Error parsing ${fileName}:`, e.message);
        }
    }

    console.log(`Found ${imagesToDownload.length} unique items to download.`);

    // Concurrency control: process in batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < imagesToDownload.length; i += BATCH_SIZE) {
        const batch = imagesToDownload.slice(i, i + BATCH_SIZE);
        console.log(`Downloading batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(imagesToDownload.length / BATCH_SIZE)}...`);
        
        await Promise.all(batch.map(async (item) => {
            try {
                if (!fs.existsSync(item.dest)) {
                    await downloadImage(item.url, item.dest);
                } else {
                    // Skip if already exists
                }
            } catch (err) {
                console.error(`Failed to download ${item.handle}:`, err.message);
            }
        }));
    }

    console.log('Download complete!');
}

main();
