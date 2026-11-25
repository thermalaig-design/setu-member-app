import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the input image file name from command line or use default
const inputImage = process.argv[2] || 'new_logo.png';
const inputPath = path.join(__dirname, inputImage);

// Check if file exists
if (!fs.existsSync(inputPath)) {
    console.error(`❌ Error: Image file '${inputImage}' not found!`);
    console.error(`\nUsage: node resize_icon.js <image_file.png>`);
    console.error(`Or place your logo image as 'new_logo.png' in the project root`);
    process.exit(1);
}

console.log(`📸 Opening image: ${inputImage}`);

// Get image metadata
const metadata = await sharp(inputPath).metadata();
console.log(`📐 Original size: ${metadata.width}x${metadata.height}`);

// Define the icon sizes for different densities
const sizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192
};

// Base path for Android resources
const basePath = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');

// Ensure base directory exists
if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true });
}

console.log('\n🔄 Generating Android icons...\n');

// Process each density
for (const [folder, size] of Object.entries(sizes)) {
    const folderPath = path.join(basePath, folder);
    
    // Ensure folder exists
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
    
    // Resize image to square with the specified size using high-quality resampling
    const resized = await sharp(inputPath)
        .resize(size, size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
        })
        .png({ quality: 100, compressionLevel: 9 })
        .toBuffer();
    
    // Save ic_launcher.png (main icon)
    fs.writeFileSync(path.join(folderPath, 'ic_launcher.png'), resized);
    console.log(`✓ Created ${folder}/ic_launcher.png (${size}x${size})`);
    
    // Save ic_launcher_round.png (rounded icon - same image)
    fs.writeFileSync(path.join(folderPath, 'ic_launcher_round.png'), resized);
    console.log(`✓ Created ${folder}/ic_launcher_round.png (${size}x${size})`);
    
    // Save ic_launcher_foreground.png (foreground icon)
    fs.writeFileSync(path.join(folderPath, 'ic_launcher_foreground.png'), resized);
    console.log(`✓ Created ${folder}/ic_launcher_foreground.png (${size}x${size})`);
}

// Also update the web logo
const webLogoPath = path.join(__dirname, 'src', 'assets', 'logo.png');
const webLogoDir = path.dirname(webLogoPath);

if (!fs.existsSync(webLogoDir)) {
    fs.mkdirSync(webLogoDir, { recursive: true });
}

// Create a 512x512 version for web (good size for favicon and PWA)
const webLogo = await sharp(inputPath)
    .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({ quality: 100, compressionLevel: 9 })
    .toBuffer();

fs.writeFileSync(webLogoPath, webLogo);
console.log(`\n✓ Updated web logo: src/assets/logo.png (512x512)`);

console.log('\n✅ All Android icons and web logo have been successfully created!');
console.log('\n📱 Next steps:');
console.log('   1. Rebuild your Android app to see the new icons');
console.log('   2. Clear app cache if icons don\'t update immediately');

