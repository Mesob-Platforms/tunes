const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE = path.join(__dirname, 'everywhere.png');
const RES = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');

// Standard launcher icon sizes
const LAUNCHER_SIZES = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
};

// Adaptive icon foreground sizes (108dp * density)
const FOREGROUND_SIZES = {
    'mipmap-mdpi': 108,
    'mipmap-hdpi': 162,
    'mipmap-xhdpi': 216,
    'mipmap-xxhdpi': 324,
    'mipmap-xxxhdpi': 432,
};

async function main() {
    const sourceBuffer = fs.readFileSync(SOURCE);

    // Generate standard launcher icons (ic_launcher.png)
    for (const [folder, size] of Object.entries(LAUNCHER_SIZES)) {
        const outDir = path.join(RES, folder);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        // Standard square icon with rounded corners
        await sharp(sourceBuffer)
            .resize(size, size, { fit: 'cover' })
            .png()
            .toFile(path.join(outDir, 'ic_launcher.png'));
        console.log(`  ic_launcher.png -> ${folder} (${size}x${size})`);

        // Round icon (circular mask)
        const roundMask = Buffer.from(
            `<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/></svg>`
        );
        await sharp(sourceBuffer)
            .resize(size, size, { fit: 'cover' })
            .composite([{ input: roundMask, blend: 'dest-in' }])
            .png()
            .toFile(path.join(outDir, 'ic_launcher_round.png'));
        console.log(`  ic_launcher_round.png -> ${folder} (${size}x${size})`);
    }

    // Generate adaptive icon foreground (ic_launcher_foreground.png)
    // The foreground has a safe zone of 66% (72dp out of 108dp).
    // We place the icon centered with padding to fill the safe zone.
    for (const [folder, size] of Object.entries(FOREGROUND_SIZES)) {
        const outDir = path.join(RES, folder);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        // The icon content should fit within the safe zone (66% of total)
        const iconSize = Math.round(size * 0.66);

        // Resize the source icon to the safe zone size, then extend with transparent padding
        const resized = await sharp(sourceBuffer)
            .resize(iconSize, iconSize, { fit: 'cover' })
            .toBuffer();

        const padding = Math.round((size - iconSize) / 2);

        await sharp(resized)
            .extend({
                top: padding,
                bottom: size - iconSize - padding,
                left: padding,
                right: size - iconSize - padding,
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png()
            .toFile(path.join(outDir, 'ic_launcher_foreground.png'));
        console.log(`  ic_launcher_foreground.png -> ${folder} (${size}x${size})`);
    }

    // Also copy to web favicon and public assets
    await sharp(sourceBuffer)
        .resize(192, 192, { fit: 'cover' })
        .png()
        .toFile(path.join(__dirname, 'public', 'favicon.png'));
    console.log('  favicon.png -> public/ (192x192)');

    // favicon at root
    await sharp(sourceBuffer)
        .resize(192, 192, { fit: 'cover' })
        .png()
        .toFile(path.join(__dirname, 'favicon.png'));
    console.log('  favicon.png -> root (192x192)');

    console.log('\nDone! All icons generated from everywhere.png');
}

main().catch(err => { console.error(err); process.exit(1); });

