# App Icon Setup

The Vertex Android app uses a circular icon that matches the web app's favicon.

## Icon Design

- **Design**: White circle with black "V" logo
- **Format**: Adaptive icon (Android 8.0+) with PNG fallbacks
- **Shape**: Circular (automatically masked by Android)

## Files

### Source
- `app-icon-circular.svg` - Master SVG source file

### Generated Icons
- `android/app/src/main/res/mipmap-*/ic_launcher.png` (5 sizes: mdpi to xxxhdpi)
- `android/app/src/main/res/mipmap-*/ic_launcher_round.png` (5 sizes: mdpi to xxxhdpi)

### Adaptive Icon (Android 8.0+)
- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`
- `android/app/src/main/res/drawable/ic_launcher_foreground.xml` (V logo vector)
- `android/app/src/main/res/values/colors.xml` (white background)

## Regenerate Icons

If you modify the icon design:

```bash
cd android/vertex

# Edit app-icon-circular.svg with your changes

# Regenerate all sizes
node generate-icons.js
```

Or use the shell script (requires ImageMagick):
```bash
./generate-icons.sh
```

## Requirements

- Node.js with `sharp` package (already installed)
- Or ImageMagick: `brew install imagemagick`

## Testing

After generating new icons:

```bash
cd android
./gradlew clean
cd ..
npm run android
```

The new icon will appear on your device home screen and in the app switcher.

## Icon Specifications

| Density | Size | Use |
|---------|------|-----|
| mdpi | 48x48 | Low-res screens |
| hdpi | 72x72 | Medium-res screens |
| xhdpi | 96x96 | High-res screens |
| xxhdpi | 144x144 | Extra high-res screens |
| xxxhdpi | 192x192 | Extra extra high-res screens |

## Adaptive Icon Safe Zone

The adaptive icon uses a 108x108dp canvas with a 66dp diameter safe zone.
This ensures the icon looks good across all device manufacturers' icon shapes:
- Circle
- Squircle
- Rounded square
- Teardrop (on some devices)

The V logo is centered and scaled to fit within the safe zone.
