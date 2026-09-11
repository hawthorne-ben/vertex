# Presentation assets — SpaceX onsite

Where things go while you collect them.

| Kind | Location | Notes |
|---|---|---|
| **Generated charts** | `analysis/figures/` | Written automatically by `save()` in `plot_style.py`. Do not copy them here — regenerate instead, so the deck always matches the code. |
| **Photos** | `presentation/photos/` | Device, bench, counterweights, enclosures, solder progression. |
| **Screenshots** | `presentation/screenshots/` | Dashboard, app, `make test` output, serial logs. |
| **CAD renders** | `presentation/renders/` | Exported from `assets/*.stl` and `v2_layout.fzz`. |

Source CAD stays in `assets/` — put only exported PNGs here.

## Naming

Prefix with the slide number so the directory sorts into deck order, matching
the convention `save()` already uses for charts:

```
photos/01_device_on_bike.jpg
photos/03_brass_counterweights.jpg
photos/03_solder_progression.jpg
photos/03_v1_enclosure.jpg
photos/05_v2_device_assembled.jpg
screenshots/08c_make_test_output.png
screenshots/09_dashboard.png
renders/05_v2_exploded.png
```

Unsure of the slide? Prefix `xx_` and rename later.

## Still needed

See the ASSET COLLECTION LIST in `notes/spacex-presentation-outline.md` for the
full slide-by-slide checklist. The high-value ones:

- [ ] Brass counterweights, laid out — the most memorable image in the deck
- [ ] V2 device mounted under the Garmin radar (title slide)
- [ ] V1 enclosure, for the V1/V2 comparison on slide 9
- [ ] Solder joint progression, early → late
- [ ] `make test` terminal output, 48/48 (slide 8c)
- [ ] Dashboard screenshot, one shot (slide 9)
- [ ] V2 exploded view from the STLs (slide 5)

## Before submitting

1. Regenerate every chart in one pass so styling is uniform.
2. Export with `transparent=True` for the final slide versions —
   `save()` defaults to opaque white, which is right for reviewing and wrong
   for dropping onto a slide background.
3. Re-run `bash analysis/scripts/count_loc.sh` and
   `web/scripts/presentation-stats.ts` so the numbers match the repo that day.
