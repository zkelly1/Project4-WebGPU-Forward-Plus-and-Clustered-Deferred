// CHECKITOUT: code that you add here will be prepended to all shaders

struct Light {
    pos: vec3f,
    color: vec3f
}

struct LightSet {
    numLights: u32,
    lights: array<Light>
}

struct Cluster {
    minBounds: vec3f,
    numLights: u32,
    maxBounds: vec3f,
    padding: u32,
    lightIndices: array<u32, ${maxLights}>
}

struct ClusterSet {
    clusters: array<Cluster>
}

struct CameraUniforms {
    viewProjMat: mat4x4f,
    viewMat: mat4x4f,
    inverseProjMat: mat4x4f,
    viewport: vec2f,
    nearPlane: f32,
    farPlane: f32
}

fn clusterIndex(coords: vec3u) -> u32 {
    return coords.x + ${clusterCountX}u * (coords.y + ${clusterCountY}u * coords.z);
}

fn clusterAtPixel(pixel: vec2f, viewDepth: f32, camera: CameraUniforms) -> u32 {
    let gridSize = vec2f(${clusterCountX}, ${clusterCountY});
    let tile = vec2u(clamp(floor(pixel / camera.viewport * gridSize), vec2f(0), gridSize - 1));
    let depth = clamp(viewDepth, camera.nearPlane, camera.farPlane);
    let slice = log(depth / camera.nearPlane) / log(camera.farPlane / camera.nearPlane);
    let z = u32(clamp(floor(slice * ${clusterCountZ}.0), 0.0, ${clusterCountZ}.0 - 1));
    return clusterIndex(vec3u(tile, z));
}

// CHECKITOUT: this special attenuation function ensures lights don't affect geometry outside the maximum light radius
fn rangeAttenuation(distance: f32) -> f32 {
    return clamp(1.f - pow(distance / ${lightRadius}, 4.f), 0.f, 1.f) / (distance * distance);
}

fn calculateLightContrib(light: Light, posWorld: vec3f, nor: vec3f) -> vec3f {
    let vecToLight = light.pos - posWorld;
    let distToLight = length(vecToLight);

    let lambert = max(dot(nor, normalize(vecToLight)), 0.f);
    return light.color * lambert * rangeAttenuation(distToLight);
}
