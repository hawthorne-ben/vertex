#!/usr/bin/env node
/**
 * Generate Android app icons from SVG
 * Uses sharp for high-quality PNG generation
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SVG_SOURCE = path.join(__dirname, 'app-icon-circular.svg');
const BASE_DIR = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');

// Icon sizes for different densities
const SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

async function generateIcons() {
  console.log('🎨 Generating Android app icons...\n');

  // Check if SVG exists
  if (!fs.existsSync(SVG_SOURCE)) {
    console.error('❌ app-icon-circular.svg not found');
    process.exit(1);
  }

  // Read SVG
  const svgBuffer = fs.readFileSync(SVG_SOURCE);

  // Generate icons for each density
  for (const [density, size] of Object.entries(SIZES)) {
    const dir = path.join(BASE_DIR, density);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const outputPath = path.join(dir, 'ic_launcher.png');
    const roundOutputPath = path.join(dir, 'ic_launcher_round.png');

    console.log(`📱 Generating ${density} (${size}x${size})...`);

    // Generate regular icon
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);

    // Copy to round icon (Android handles the masking)
    fs.copyFileSync(outputPath, roundOutputPath);
  }

  console.log('\n✅ Icons generated successfully!\n');
  console.log('Files created:');

  // List created files
  for (const density of Object.keys(SIZES)) {
    const dir = path.join(BASE_DIR, density);
    console.log(`  ${density}/ic_launcher.png`);
    console.log(`  ${density}/ic_launcher_round.png`);
  }

  console.log('\n🔄 Rebuild your app to see the new icon:');
  console.log('   cd android && ./gradlew clean');
  console.log('   cd .. && npm run android');
}

generateIcons().catch(error => {
  console.error('❌ Error generating icons:', error);
  process.exit(1);
});
