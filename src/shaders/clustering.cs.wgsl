@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;
@group(0) @binding(2) var<storage, read_write> clusterSet: ClusterSet;

fn viewPoint(pixel: vec2f, depth: f32) -> vec3f {
    // Canvas Y points down; projection Y points up. Visible view-space Z is negative.
    let ndc = vec2f(2 * pixel.x / camera.viewport.x - 1, 1 - 2 * pixel.y / camera.viewport.y);
    let point = camera.inverseProjMat * vec4f(ndc, 0, 1);
    return point.xyz * (depth / -point.z);
}

@compute @workgroup_size(${clusteringWorkgroupSize})
fn main(@builtin(global_invocation_id) globalIdx: vec3u) {
    let index = globalIdx.x;
    if (index >= ${clusterCountX}u * ${clusterCountY}u * ${clusterCountZ}u) {
        return;
    }

    let x = index % ${clusterCountX}u;
    let y = (index / ${clusterCountX}u) % ${clusterCountY}u;
    let z = index / (${clusterCountX}u * ${clusterCountY}u);
    let tileSize = camera.viewport / vec2f(${clusterCountX}, ${clusterCountY});
    let depthRatio = camera.farPlane / camera.nearPlane;
    let nearDepth = camera.nearPlane * pow(depthRatio, f32(z) / ${clusterCountZ}.0);
    let farDepth = camera.nearPlane * pow(depthRatio, f32(z + 1) / ${clusterCountZ}.0);

    var minBounds = vec3f(1e30);
    var maxBounds = vec3f(-1e30);
    for (var corner = 0u; corner < 8u; corner++) {
        let pixel = vec2f(f32(x + (corner & 1u)), f32(y + ((corner >> 1u) & 1u))) * tileSize;
        let depth = select(nearDepth, farDepth, (corner & 4u) != 0u);
        let point = viewPoint(pixel, depth);
        minBounds = min(minBounds, point);
        maxBounds = max(maxBounds, point);
    }

    // One invocation owns the whole list, so it needs neither atomics nor a clear pass.
    let cluster = &clusterSet.clusters[index];
    (*cluster).minBounds = minBounds;
    (*cluster).maxBounds = maxBounds;
    var count = 0u;
    for (var lightIdx = 0u; lightIdx < lightSet.numLights; lightIdx++) {
        let pos = (camera.viewMat * vec4f(lightSet.lights[lightIdx].pos, 1)).xyz;
        let closest = clamp(pos, minBounds, maxBounds);
        let delta = pos - closest;
        if (dot(delta, delta) <= ${lightRadius}.0 * ${lightRadius}.0) {
            (*cluster).lightIndices[count] = lightIdx;
            count++;
        }
    }
    (*cluster).numLights = count;
}
