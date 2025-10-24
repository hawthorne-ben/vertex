# Vertex Logo & Brand Assets Guide

## Logo Concept

The Vertex logo centers on a **geometric "V"** that represents multiple concepts:
- The apex of a corner (cycling dynamics)
- A vertex point where lines converge (geometry/data)
- An arrow pointing upward (performance)
- Precision and sophistication

### Design Philosophy
- **Minimalist & Architectural**: Clean lines, geometric precision
- **Editorial Aesthetic**: Pairs with serif typography
- **Scalable**: Works from 16px favicon to billboard
- **Timeless**: Avoids trends, focuses on fundamentals

## Current Assets

### Favicon (Implemented)
✅ `public/favicon.svg` - SVG favicon with geometric V
✅ `public/vertex-icon.svg` - Transparent version for use in UI

The current favicon is a simple, bold "V" that:
- Reads clearly at 16×16 pixels
- Uses sharp angles suggesting precision
- Black on white for maximum contrast

## Recommended Figma Workflow

### 1. **Setup Figma (Free)**
- Go to [figma.com](https://figma.com)
- Create free account
- Create new design file: "Vertex Brand Assets"

### 2. **Artboards to Create**

**Logo Variations:**
- Primary Mark: Geometric V (1000×1000px)
- Wordmark: "VERTEX" in serif (1000×300px)
- Combined: Icon + Wordmark horizontal (1500×500px)
- Combined: Icon + Wordmark stacked (800×1000px)
- Favicon: Simplified for 32×32px

**Color Variants for Each:**
- Black on white
- White on black
- Black on transparent
- Color accent version (if using)

### 3. **Design Refinements to Explore**

**V Shape Variations:**
```
Option A: Sharp Apex (current)
   /\
  /  \
 /____\

Option B: Open Vertex (more dynamic)
   / \
  /   \
 /     \

Option C: Geometric Grid (structured)
  ╱╲
 ╱  ╲
╱____╲

Option D: Converging Lines (data-focused)
  ←\
    ↓
  →/
```

**Typography Explorations:**
- Tiempos Text (elegant, modern serif)
- Lyon (strong editorial presence)
- Crimson Pro (current web font, good option)
- Custom letterspacing for "VERTEX"
- Try both all-caps and mixed case

### 4. **Color Palette Options**

**Option 1: Monochrome Sophistication** (Recommended)
- Primary: `#1a1a1a` (near black)
- Secondary: `#f5f5f5` (off white)
- Accent: `#666666` (mid gray)
- Pure editorial, timeless

**Option 2: Warm Accent**
- Primary: `#1a1a1a`
- Accent: `#8B4513` (terracotta/rust)
- Use accent sparingly for highlights

**Option 3: Deep Navy**
- Primary: `#1a2332` (deep navy)
- Accent: `#E8DCC4` (warm stone)
- Sophisticated, warmer than pure black

## Generating Production Assets from Figma

### Export Settings
1. Select your logo artboard
2. Add export settings (right panel):
   - **SVG** - for web use
   - **PNG** @ 1x, 2x, 3x - for various displays
   - **ICO** - 32×32 for favicon (export as PNG, convert)

### Favicon Generation

**From Figma:**
1. Export your simplified V icon as PNG:
   - 16×16px
   - 32×32px
   - 180×180px (for apple-touch-icon)
   - 512×512px (for PWA)

**Convert to .ico:**
- Use [favicon.io](https://favicon.io/favicon-converter/)
- Or [realfavicongenerator.net](https://realfavicongenerator.net/)
- Upload your PNG, download all formats
- Place files in `/public/` directory

### Required Favicon Files

```
public/
├── favicon.ico           # 32×32 ICO format
├── favicon.svg           # ✅ Already created
├── apple-touch-icon.png  # 180×180 PNG
├── icon-192.png          # 192×192 for PWA
└── icon-512.png          # 512×512 for PWA
```

## Quick Improvements to Current Favicon

The current SVG favicon is functional but basic. Consider:

1. **Add subtle refinements:**
   - Rounded inner corners for friendliness
   - Optical weight balancing
   - Perfect mathematical angles

2. **Explore negative space:**
   - Could the V create an interesting shape around it?
   - Inverted versions for dark mode

3. **Test at small sizes:**
   - Open your deployed site
   - Check how it looks in browser tabs
   - Ensure it's distinct from other tabs

## Design Inspiration

**Similar Editorial Aesthetics:**
- CoStar: Bold typography, muted earth tones
- Vacation: Warm palette, generous whitespace
- Stripe: Clean, geometric, monochrome
- Linear: Sharp angles, modern serif

**Cycling Tech (to differentiate from):**
- Strava: Bright orange, sporty
- Wahoo: Bright blue, techy
- Garmin: Teal, functional
→ Vertex should feel more *refined* and *editorial*

## Brand Guidelines (Future)

Once finalized in Figma, document:
- Logo clear space (minimum margins)
- Minimum sizes (e.g., never smaller than 24px)
- Incorrect usage examples
- Color codes (hex, RGB, CMYK)
- Typography pairings
- Grid system if applicable

## Next Steps

1. **Open Figma** and start with the V shape
2. **Experiment** with 3-5 variations
3. **Add typography** - try "VERTEX" in different serif fonts
4. **Pick a color palette** (recommend starting monochrome)
5. **Export assets** at all required sizes
6. **Generate ICO** using online tool
7. **Replace** `/public/favicon.svg` and add other formats
8. **Test** on deployed site

The current favicon is a solid starting point - functional and clean. But Figma will let you refine it into something truly distinctive that matches the editorial sophistication of the rest of the site.

---

**Pro Tip**: The best logos are often the simplest. Your "V" concept is strong - refinement is about perfecting proportions, not adding complexity.

