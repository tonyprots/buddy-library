# Rendering quality

The initial renderer fixes preserve the model, polygon count, render passes and
skinning method. They improve stable facial rendering across GPUs and isolate
multiple instances.

- Rig state is per instance: density, outline width, transparency, giant tint and
  occlusion capsules. Resizing one canvas must not alter another's outline.
- vendor.js exports THREE and Buddy3D as ESM without replacing window.THREE or
  application globals.
- Eye and mouth masks avoid reversed smoothstep edges, whose results are undefined
  by GLSL. Use the complement of a smoothstep with correctly ordered edges.
- Iris highlights fade at subpixel size while remaining visible in close-ups.
- Skin contact shadows use 76% of the former strength, retaining readable tones
  around hands, faces and white shoes.

Only scalar shader operations were added. No new textures, lights, shadow maps or
screen-space filters; the same eleven occlusion capsules use the existing pass.

Check full-slide and close-up views, front and both facings, blinking, smiling,
yawning, hands near the mouth, held props and enlarged bodies. Check two instances
with different scales and canvas sizes. render-quality.test.mjs checks real
Three.js state isolation and model loading, not every GPU's shader output.

Historical before/after frames showed preserved silhouettes and prop contacts with
lighter skin readability. Differences in gaze are scheduler state, not necessarily
shader differences. Those frames do not prove freedom from artifacts on all drivers
or at every intermediate pose. SVG was unchanged by these fixes; very small figures
remain limited by physical pixel count, not polygon count.
