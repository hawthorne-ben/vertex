# Logo Update - November 2025

## New Logo Design

Updated from the simple geometric V to a refined serif V logo with better typographic details and elegant proportions.

## What Was Done

### 1. Asset Generation Script Created
**Location**: `scripts/generate-logo-assets.js`

Generates all required logo assets from source PNG:
- Black and white transparent versions
- All web favicon sizes (16px, 32px, 180px, 192px, 512px)
- Dark mode favicons (white logo for dark backgrounds)
- All Android launcher icon densities (mdpi through xxxhdpi)

### 2. Assets Generated

**Source**: `web/public/Vertex Logo.png` (AI-generated refined serif V)

**Web Assets** (`web/public/`):
- `vertex-logo-black.png` - Black logo, transparent background
- `vertex-logo-white.png` - White logo, transparent background
- `favicon-16x16.png` - 16×16 favicon (black)
- `favicon-32x32.png` - 32×32 favicon (black)
- `favicon-16x16-dark.png` - 16×16 favicon for dark mode (white)
- `favicon-32x32-dark.png` - 32×32 favicon for dark mode (white)
- `apple-touch-icon.png` - 180×180 for iOS
- `icon-192.png` - 192×192 for PWA
- `icon-512.png` - 512×512 for PWA
- `vertex-icon.png` - 512×512 general use

**Android Assets** (`android/app/src/main/res/`):
- `mipmap-mdpi/ic_launcher.png` (48×48)
- `mipmap-hdpi/ic_launcher.png` (72×72)
- `mipmap-xhdpi/ic_launcher.png` (96×96)
- `mipmap-xxhdpi/ic_launcher.png` (144×144)
- `mipmap-xxxhdpi/ic_launcher.png` (192×192)
- Plus `ic_launcher_round.png` for each density

### 3. Theme-Aware Favicons Implemented

**Updated**: `web/src/app/layout.tsx`

Now serves different favicons based on system color scheme:
- **Light mode**: Black logo on transparent background
- **Dark mode**: White logo on transparent background

This uses the `media="(prefers-color-scheme: dark)"` attribute on `<link>` tags, which is supported by all modern browsers.

## Usage

### Regenerate All Assets

If you update the source logo:

```bash
node scripts/generate-logo-assets.js
```

This will regenerate all sizes and versions automatically.

### Test the Favicons

**Web**:
1. Start dev server: `cd web && npm run dev`
2. Open `localhost:3000` in browser
3. Look at browser tab - should see the new V logo
4. Switch system dark mode on/off - favicon should update

**Android**:
1. Rebuild app: `cd android && ./gradlew clean && cd .. && npm run android`
2. Check launcher icon on device/emulator

## Next Steps (Optional Improvements)

### 1. Create True SVG Versions
Current SVG files (`vertex-logo-black.svg`, `vertex-logo-white.svg`) are placeholders using text. For best quality:

1. Open `Vertex Logo.png` in Adobe Illustrator or Inkscape
2. Use Image Trace / Vectorize to convert to paths
3. Export as SVG with proper paths
4. Replace the placeholder SVG files

Benefits:
- Infinitely scalable
- Smaller file size
- Sharper rendering
- Can be animated or styled with CSS

### 2. Update Android Adaptive Icon XML
Current file: `android/app/src/main/res/drawable/ic_launcher_foreground.xml`

Still uses the old geometric V path. To update:
1. Get SVG path data from vectorized logo
2. Convert to Android vector drawable format
3. Adjust positioning for safe zone (66dp circle)

Benefits:
- Native vector rendering on Android
- Better performance
- Consistent with Android design guidelines

### 3. Add Wordmark Versions
Create logo + "VERTEX" wordmark combinations:
- Horizontal layout (logo + text side by side)
- Stacked layout (logo above text)
- Various sizes for different use cases

### 4. Create Favicon.ico
For maximum browser compatibility, generate a multi-resolution `.ico` file:

```bash
# Using ImageMagick
magick convert favicon-16x16.png favicon-32x32.png favicon.ico
```

Or use online tools like favicon.io

## Technical Notes

### Browser Support
- **Theme-aware favicons**: Supported in Chrome 73+, Firefox 67+, Safari 12.1+
- Falls back gracefully to light mode favicon in older browsers

### PNG vs SVG
- **PNG**: Used for all favicons and app icons (guaranteed compatibility)
- **SVG**: Recommended for future versions (better scalability)

### Transparent Backgrounds
All generated assets have truly transparent backgrounds (alpha channel), not white backgrounds. This ensures they work on any color background.

## Files Added/Modified

**New Files**:
- `scripts/generate-logo-assets.js` - Asset generation script
- `scripts/README-LOGO-ASSETS.md` - Detailed documentation
- `web/public/Vertex Logo.png` - Source logo
- `web/public/vertex-logo-black.png` - Black transparent version
- `web/public/vertex-logo-white.png` - White transparent version
- `web/public/favicon-*-dark.png` - Dark mode favicons
- All generated icon sizes

**Modified Files**:
- `web/src/app/layout.tsx` - Updated favicon references, added theme-aware links
- All Android `ic_launcher.png` files updated with new logo

**Documentation**:
- `docs/LOGO_UPDATE_2024.md` (this file)
- `scripts/README-LOGO-ASSETS.md`

## References

- Original logo guide: `docs/LOGO_GUIDE.md`
- Asset generation: `scripts/generate-logo-assets.js`
- Asset documentation: `scripts/README-LOGO-ASSETS.md`
