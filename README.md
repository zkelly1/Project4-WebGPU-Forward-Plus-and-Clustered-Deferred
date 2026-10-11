# WebGPU Forward+ and Clustered Deferred Shading

**University of Pennsylvania, CIS 565: GPU Programming and Architecture — Project 4**

Zachary Kelly

The naive forward renderer is working. It draws the Sponza scene with animated
point lights and checks every light for each fragment. This will be the baseline
for comparing Forward+ and clustered deferred shading.

![Sponza with 500 point lights](img/naive.png)

## Build and run

Run from the repository root:

```powershell
npm install
npm run dev
```

The project needs Node.js and a browser with WebGPU support. The initial renderer
was checked on Windows in Chrome 155.0.8059.40 at 1280 × 720. The screenshot above
uses the default 500 lights. Performance measurements are still pending.

Keep the mode set to `naive` for now. Forward+ and clustered deferred are still
starter code, though both appear in the menu.

| Input | Action |
| --- | --- |
| W / S | Move forward / backward |
| A / D | Move left / right |
| Q / E | Move down / up |
| Hold left mouse button and drag | Look around |
| Shift | Move faster |
| Alt | Move slower |
| numLights | Change the active light count, from 1 to 5,000 |
| cluster counts | Show the number of lights assigned to each visible cluster |

## Naive forward rendering

The camera stores its view-projection matrix at the start of its uniform buffer.
Each frame updates the matrix after processing movement and copies it to the GPU.
The scene bind group exposes this buffer to the vertex shader at binding 0;
the light buffer stays at binding 1.

The vertex shader transforms each model-space position into world space, then
uses the camera matrix to place it on screen. World position, normal, and texture
coordinates pass through to the existing fragment shader. That shader samples
the material texture and adds the contribution from every active light.

The scene loader, camera controls, light animation, and lighting calculation
come from the starter. This stage fills in the missing camera buffer, bindings,
and vertex transformation. The full light loop is unchanged so later renderers
can be compared against it.

## Light clustering

The view is split into 16 columns, 9 rows, and 24 depth slices. Depth spacing is
logarithmic between the camera's near and far planes, so slices are thinner near
the camera. The camera buffer now also holds the view matrix, inverse projection,
viewport size, and clipping distances, for a total of 208 bytes.

Each compute invocation handles one cluster. It unprojects the eight corners,
finds their view-space bounding box, and tests every light against that box.
A light is included when the closest point on the box lies within its radius.
These boxes enclose the clusters, so they can include extra lights near the
corners. The lighting shader will still need to apply the distance falloff.

Each cluster stores two bounds, a light count, and the indices of its lights.
One thread owns the list and writes its count every frame. Old entries beyond
that count are ignored, so shrinking a list does not need a separate clearing
pass. Clustering runs after light movement and before the debug draw.

For now, each list has space for all 5,000 lights. That avoids dropping lights
when they crowd into one cluster, but the 3,456 clusters take about 66 MiB.
This is a simple starting point, not a compact allocation. Shorter lists with
an overflow fallback or packed lists would reduce the memory cost later.

![Cluster light counts with 500 lights](img/clusters.png)

Enable **cluster counts** while in `naive` mode to see the lists on the scene.
Blue means zero lights, green means 32, and red means 64 or more. Red only caps
the display color; it does not mean the list was truncated. The dark lines show
the screen tiles. Different depths within one tile can have different counts.
The view keeps the material's alpha cutoff, including holes in the foliage.

Turning this off returns to the original all-lights shader and skips the
clustering dispatch. Forward+ and deferred lighting are still unimplemented;
the shared lists and pixel-to-cluster lookup are ready for those stages.

### Checking the lists

With the development server running, open `/tests/clustering.html`. This page
compares GPU results against CPU bounds built from projection scales and a
separate sphere-box calculation. It checks every cluster's bounds and light
indices, rather than relying only on the debug colors.

The checks cover empty input, one light, 5,000 scattered lights, 5,000 overlapping
lights, and clearing the counts after a full list. They also cover exact tangency,
lights behind the camera and across the clipping planes, a moved and rotated
camera, and a portrait projection. Pixel/depth lookup is checked at 868 points
for each of the landscape and portrait projections. All checks pass in Chrome.
The page reports GPU validation errors as failures.

## Progress

- [x] Install dependencies and run the development server.
- [x] Complete the camera uniforms and naive renderer.
- [x] Check camera movement and light counts of 1, 500, and 5,000.
- [x] Build and debug the cluster light lists.
- [ ] Implement Forward+.
- [ ] Implement clustered deferred shading.
- [ ] Compare render times and record optimization results.
- [ ] Add the live demo and video.

The Vite production bundle builds. A separate TypeScript check still reports
unused declarations in the unfinished starter code and typed-array errors in
`scene.ts`. Those remain to be addressed; there are no performance results yet.

## Credits

- CIS 565 project starter and supplied Sponza scene
- [Vite](https://vitejs.dev/)
- [loaders.gl](https://loaders.gl/)
- [dat.GUI](https://github.com/dataarts/dat.gui)
- [stats.js](https://github.com/mrdoob/stats.js)
- [wgpu-matrix](https://github.com/greggman/wgpu-matrix)
