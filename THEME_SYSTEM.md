# Theme System Documentation

## Overview

This document describes the comprehensive theme system implemented for Vertex, providing consistent dark mode support across all components.

## CSS Variables

### Core Variables
- `--background`, `--foreground` - Main background and text colors
- `--card`, `--card-foreground` - Card backgrounds and text
- `--border`, `--input`, `--ring` - Border and form element colors
- `--muted`, `--muted-foreground` - Muted backgrounds and text

### Form Elements
- `--form-background` - Form input backgrounds
- `--form-border` - Form input borders
- `--form-text` - Form input text
- `--form-placeholder` - Placeholder text
- `--form-disabled` - Disabled form backgrounds
- `--form-disabled-text` - Disabled form text
- `--form-disabled-border` - Disabled form borders

### Status Colors
- `--success`, `--success-bg`, `--success-border` - Success states
- `--warning`, `--warning-bg`, `--warning-border` - Warning states
- `--error`, `--error-bg`, `--error-border` - Error states
- `--info`, `--info-bg`, `--info-border` - Info states

### Semantic Text
- `--text-primary` - Primary text (high contrast)
- `--text-secondary` - Secondary text (medium contrast)
- `--text-tertiary` - Tertiary text (low contrast)
- `--text-inverse` - Inverse text (for dark backgrounds)

### Interactive States
- `--hover-bg`, `--hover-border` - Hover states
- `--active-bg`, `--active-border` - Active states

## Utility Classes

### Text Colors
```css
.text-primary    /* High contrast text */
.text-secondary  /* Medium contrast text */
.text-tertiary   /* Low contrast text */
.text-inverse    /* Inverse text */
```

### Form Elements
```css
.form-input           /* Standard form input styling */
.form-input-disabled  /* Disabled form input styling */
.bg-form             /* Form background */
.border-form         /* Form border */
.text-form           /* Form text */
```

### Status Colors
```css
.status-badge-success  /* Success status badge */
.status-badge-warning  /* Warning status badge */
.status-badge-error    /* Error status badge */
.status-badge-info     /* Info status badge */
```

### Interactive Elements
```css
.card-interactive  /* Interactive card with hover states */
.hover-bg         /* Hover background */
.hover-border      /* Hover border */
```

## Tailwind Classes

### Form Elements
```css
bg-form-background     /* Form background */
border-form-border     /* Form border */
text-form-text         /* Form text */
text-form-placeholder  /* Placeholder text */
bg-form-disabled       /* Disabled background */
text-form-disabled-text /* Disabled text */
border-form-disabled   /* Disabled border */
```

### Status Colors
```css
bg-success-bg     /* Success background */
text-success       /* Success text */
border-success-border /* Success border */
bg-warning-bg     /* Warning background */
text-warning       /* Warning text */
border-warning-border /* Warning border */
bg-error-bg       /* Error background */
text-error        /* Error text */
border-error-border /* Error border */
bg-info-bg        /* Info background */
text-info         /* Info text */
border-info-border  /* Info border */
```

### Semantic Text
```css
text-text-primary    /* Primary text */
text-text-secondary  /* Secondary text */
text-text-tertiary   /* Tertiary text */
text-text-inverse    /* Inverse text */
```

## Migration Guide

### Before (Hardcoded Colors)
```tsx
// ❌ Don't do this
<div className="text-stone-600 bg-stone-50 border-stone-200">
  <input className="border-stone-300 bg-white" />
  <span className="bg-green-50 text-green-700">Success</span>
</div>
```

### After (Semantic Colors)
```tsx
// ✅ Do this instead
<div className="text-secondary bg-muted border-border">
  <input className="form-input" />
  <span className="status-badge-success">Success</span>
</div>
```

## Common Patterns

### Interactive Cards
```tsx
<div className="card-interactive p-4 rounded-lg">
  <h3 className="text-primary">Card Title</h3>
  <p className="text-secondary">Card content</p>
</div>
```

### Form Inputs
```tsx
<input 
  className="form-input px-3 py-2 rounded-md"
  placeholder="Enter text..."
/>
<input 
  className="form-input-disabled px-3 py-2 rounded-md"
  disabled
/>
```

### Status Badges
```tsx
<span className="status-badge-success px-2 py-1 rounded-full text-xs">
  Ready
</span>
<span className="status-badge-error px-2 py-1 rounded-full text-xs">
  Error
</span>
```

### Navigation Links
```tsx
<Link className="text-secondary hover:text-primary hover-bg px-3 py-2 rounded-md">
  Dashboard
</Link>
```

## Benefits

1. **Consistent**: All components use the same color system
2. **Maintainable**: Change themes by updating CSS variables
3. **Accessible**: Proper contrast ratios in both themes
4. **Future-proof**: Easy to add new themes or colors
5. **Performance**: No runtime theme switching overhead

## Testing

To test the theme system:

1. Toggle between light and dark modes using the theme toggle
2. Verify all text remains readable in both themes
3. Check that form elements are properly styled
4. Ensure status colors are visible and accessible
5. Test interactive states (hover, active) work correctly

## Future Enhancements

- Add more semantic color variations
- Implement theme-specific animations
- Add high contrast mode support
- Create theme-specific component variants
