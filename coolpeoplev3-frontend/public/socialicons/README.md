# Social icons

Brand marks are **simple-icons** v16.28.0 (CC0-1.0, public domain) pulled from
the jsDelivr CDN. `sms`, `email`, `copylink` and `share` aren't brands, so they're
hand-drawn here to match: same `0 0 24 24` viewBox, same single-path style.

Every file has **no `fill` attribute**, so the colour comes from CSS:

```css
.shareIcon { width: 20px; height: 20px; fill: currentColor; }
```

```jsx
<img src="/socialicons/whatsapp.svg" alt="Share on WhatsApp" />   /* fixed colour */
```

An `<img>` can't inherit `currentColor` — inline the SVG (or use a sprite) if the
icon needs to change colour on hover or with a theme.

## Files

| brand | | utility | |
|---|---|---|---|
| `x` | `instagram` | `sms` | speech bubble |
| `whatsapp` | `tiktok` | `email` | envelope |
| `facebook` | `threads` | `copylink` | chain |
| `youtube` | `snapchat` | `share` | three nodes |
| `linkedin` | `telegram` | | |
| `reddit` | `bluesky` | | |
| `pinterest` | `discord` | | |
| `twitch` | | | |

## Trademark note

CC0 covers simple-icons' **path data**, not the trademarks. Using these to link to
or share on a platform is normal; don't restyle a brand mark (recolour beyond
mono, distort, or combine it with your own logo) or imply endorsement. Each
company publishes brand guidelines if you need the exact rules.

## Re-download / update

```bash
for n in x instagram whatsapp tiktok facebook youtube linkedin reddit \
         threads telegram bluesky snapchat discord pinterest twitch; do
  curl -sS -o "$n.svg" "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/$n.svg"
done
```
